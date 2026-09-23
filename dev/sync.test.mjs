// Sync tests against a fake GitHub: no network. node --test "tracker/dev/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSync } from '../sync.js';
import * as E from '../engine.js';

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64');
const unb64 = s => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

function fakeGitHub({ putStatus = 201, delay = 0, files = {} } = {}) {
  const calls = [];
  const store = new Map(Object.entries(files));
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (delay) await new Promise(r => setTimeout(r, delay));
    const method = init.method || 'GET';
    const m = url.match(/\/repos\/o\/r(?:\/contents\/([^?]*))?/);
    const path = m && m[1] ? decodeURIComponent(m[1]) : '';
    if (method === 'GET') {
      if (!m[1]) return res(200, { full_name: 'o/r', private: true, permissions: { push: true } });
      if (path === 'training/log') return res(200, [...store.keys()].map(p => ({ type: 'file', name: p.split('/').pop(), path: p })));
      return store.has(path) ? res(200, { sha: 'sha-' + path, content: b64(store.get(path)) }) : res(404, { message: 'Not Found' });
    }
    const st = typeof putStatus === 'function' ? putStatus(path) : putStatus;
    if (st === 200 || st === 201) store.set(path, unb64(JSON.parse(init.body).content));
    return res(st, st < 300 ? { content: {} } : { message: 'Not Found' });
  };
  return { fetch, calls, store, puts: () => calls.filter(c => c.init.method === 'PUT') };
}
function setup(gh, state = {}) {
  const S = { settings: { token: 'TEST_TOKEN_NOT_REAL', owner: 'o', repo: 'r', branch: 'main', path: 'training/log' },
    queue: [], bwQueue: [], history: [], bw: [], ...state };
  const statuses = [];
  let saves = 0;
  const sync = makeSync({ fetch: gh.fetch, getState: () => S, save: () => { saves++; }, onStatus: (c, m) => statuses.push([c, m]) });
  return { S, sync, statuses, saves: () => saves };
}
const sess = (date, key, more = {}) => ({ schemaVersion: 5, date, key, name: key, exercises: [], decisions: [], ...more });

test('a PUT answered 404 leaves the session queued and reports bad', async () => {
  const gh = fakeGitHub({ putStatus: 404 });
  const { S, sync, statuses } = setup(gh);
  sync.enqueue(sess('2026-09-23', 'upper-push'));
  await sync.flushQueue();
  assert.equal(S.queue.length, 1);
  assert.equal(S.history.length, 0);
  assert.ok(statuses.some(([c]) => c === 'bad'));
});

test('a PUT answered 201 removes the item and merges it into history without its qid', async () => {
  const gh = fakeGitHub();
  const { S, sync, statuses } = setup(gh);
  sync.enqueue(sess('2026-09-23', 'upper-push'));
  await sync.flushQueue();
  assert.equal(S.queue.length, 0);
  assert.equal(S.history.length, 1);
  assert.equal(S.history[0].qid, undefined);
  assert.deepEqual(statuses.at(-1), ['ok', 'synced']);
  assert.equal(gh.store.get('training/log/2026-09-23-upper-push.json').qid, undefined, 'the qid never reaches the file');
});

test('two concurrent flushes make exactly one PUT per queued item', async () => {
  const gh = fakeGitHub({ delay: 5 });
  const { S, sync } = setup(gh);
  for (const d of ['2026-09-20', '2026-09-21', '2026-09-22']) sync.enqueue(sess(d, 'upper-push'));
  const a = sync.flushQueue(), b = sync.flushQueue();
  assert.equal(a, b, 'the second call joins the first');
  await Promise.all([a, b]);
  assert.equal(gh.puts().length, 3);
  assert.equal(S.queue.length, 0);
});

test('every GET is sent with cache: no-store', async () => {
  const gh = fakeGitHub({ files: { 'training/log/2026-09-22-upper-push.json': sess('2026-09-22', 'upper-push') } });
  const { sync } = setup(gh);
  sync.enqueue(sess('2026-09-22', 'upper-push', { notes: 'edited' }));
  await sync.flushQueue();
  await sync.pullHistory();
  await sync.testRepo();
  const gets = gh.calls.filter(c => (c.init.method || 'GET') === 'GET');
  assert.ok(gets.length >= 4);
  for (const g of gets) assert.equal(g.init.cache, 'no-store', g.url);
});

test('a tombstone and the edited copy sharing one id are both pushed', async () => {
  const orig = sess('2026-09-15', 'lower-a', { id: 's_same', file: 'training/log/2026-09-15-lower-a.json' });
  const gh = fakeGitHub({ files: { 'training/log/2026-09-15-lower-a.json': orig } });
  const { S, sync } = setup(gh, { history: [orig] });
  sync.enqueue({ ...orig, deleted: true, savedAt: 'x' });
  sync.enqueue({ ...orig, date: '2026-09-16', file: 'training/log/2026-09-16-lower-a.json' });
  await sync.flushQueue();
  assert.deepEqual(gh.puts().map(c => c.url.split('/contents/')[1]).sort(),
    ['training/log/2026-09-15-lower-a.json', 'training/log/2026-09-16-lower-a.json']);
  assert.equal(S.queue.length, 0);
  assert.equal(gh.store.get('training/log/2026-09-15-lower-a.json').deleted, true);
  assert.deepEqual(S.history.map(h => h.date), ['2026-09-16']);
});

test('enqueue replaces an older unsent version of the same file, but never one in flight', async () => {
  const gh = fakeGitHub({ delay: 10 });
  const { S, sync } = setup(gh);
  sync.enqueue(sess('2026-09-23', 'upper-push', { notes: 'v1' }));
  sync.enqueue(sess('2026-09-23', 'upper-push', { notes: 'v2' }));
  assert.deepEqual(S.queue.map(q => q.notes), ['v2']);
  const p = sync.flushQueue();
  await new Promise(r => setTimeout(r, 2));          // v2 is now in flight
  sync.enqueue(sess('2026-09-23', 'upper-push', { notes: 'v3' }));
  assert.deepEqual(S.queue.map(q => q.notes), ['v2', 'v3']);
  sync.flushQueue();
  await p;
  assert.equal(S.queue.length, 0);
  assert.equal(gh.store.get('training/log/2026-09-23-upper-push.json').notes, 'v3');
});

test('an item queued by v4 (no qid) is pushed exactly as stored', async () => {
  const gh = fakeGitHub();
  const legacy = { date: '2026-09-17', key: 'upper-push', name: 'Upper Push', exercises: [{ n: 'a', sets: [{ kg: 75, reps: 5, rir: null, done: false, warmup: false }] }], decisions: [] };
  const { S, sync } = setup(gh, { queue: [E.clone(legacy)] });
  await sync.flushQueue();
  const put = gh.puts()[0];
  assert.equal(Buffer.from(JSON.parse(put.init.body).content, 'base64').toString('utf8'), JSON.stringify(legacy, null, 2));
  assert.equal(S.queue.length, 0);
});

test('pullHistory replaces history, leaves the queue alone, and records a -2 path', async () => {
  const gh = fakeGitHub({ files: {
    'training/log/2026-09-23-upper-push.json': sess('2026-09-23', 'upper-push'),
    'training/log/2026-09-23-upper-push-2.json': sess('2026-09-23', 'upper-push', { notes: 'second' }),
    'training/log/2026-09-20-lower-a.json': sess('2026-09-20', 'lower-a', { deleted: true }),
    'training/log/bw-2026-09.json': { month: '2026-09', entries: [{ type: 'bw', date: '2026-09-22', kg: 72.4 }] } } });
  const { S, sync } = setup(gh, { history: [sess('2026-01-01', 'old')] });
  sync.enqueue(sess('2026-09-24', 'lower-b'));
  gh.calls.length = 0;
  await sync.pullHistory();
  assert.equal(S.history.length, 2, 'deleted files are skipped');
  assert.equal(S.history.find(h => h.notes === 'second').file, 'training/log/2026-09-23-upper-push-2.json');
  assert.equal(S.queue.length, 1);
  assert.equal(S.bw[0].kg, 72.4);
  assert.equal(E.mergedHistory(S.history, S.queue).length, 3, 'the queued session is still in the analysis view');
});

test('a bodyweight entry is merged into its month file', async () => {
  const gh = fakeGitHub({ files: { 'training/log/bw-2026-09.json': { month: '2026-09', entries: [{ type: 'bw', date: '2026-09-20', kg: 72.8 }] } } });
  const { S, sync } = setup(gh);
  sync.enqueueBw({ type: 'bw', date: '2026-09-23', kg: 72.4, loggedAt: '2026-09-23T06:30:00Z' });
  await sync.flushQueue();
  assert.deepEqual(gh.store.get('training/log/bw-2026-09.json').entries.map(e => e.kg), [72.4, 72.8]);
  assert.equal(S.bwQueue.length, 0);
  assert.equal(S.bw[0].qid, undefined);
});

test('no token: nothing is sent and the queue is kept', async () => {
  const gh = fakeGitHub();
  const { S, sync, statuses } = setup(gh);
  S.settings.token = '';
  sync.enqueue(sess('2026-09-23', 'upper-push'));
  await sync.flushQueue();
  assert.equal(gh.calls.length, 0);
  assert.equal(S.queue.length, 1);
  assert.deepEqual(statuses.at(-1), ['bad', 'no token']);
});

/* ------------------------------------------------ regressions, 2026-09-23 */
test('a Reload started while a session is uploading keeps that session in history', async () => {
  const gh = fakeGitHub({ delay: 5, files: { 'training/log/2026-09-15-lower-a.json': sess('2026-09-15', 'lower-a') } });
  const { S, sync } = setup(gh, { history: [sess('2026-09-15', 'lower-a')] });
  sync.enqueue(sess('2026-09-23', 'upper-pull'));
  const f = sync.flushQueue();
  const p = sync.pullHistory();                 // the listing would land before the PUT
  await Promise.all([f, p]);
  assert.equal(S.queue.length, 0);
  assert.deepEqual(S.history.map(h => h.date).sort(), ['2026-09-15', '2026-09-23']);
});

test('an upload started while a Reload runs waits for it, and its session survives', async () => {
  const gh = fakeGitHub({ delay: 5, files: { 'training/log/2026-09-15-lower-a.json': sess('2026-09-15', 'lower-a') } });
  const { S, sync } = setup(gh);
  const p = sync.pullHistory();
  sync.enqueue(sess('2026-09-23', 'upper-pull'));
  const f = sync.flushQueue();
  await Promise.all([p, f]);
  assert.equal(S.queue.length, 0);
  assert.deepEqual(S.history.map(h => h.date).sort(), ['2026-09-15', '2026-09-23']);
});

test('a tombstone for a file that never reached GitHub only cancels the queued copy', async () => {
  const gh = fakeGitHub();
  const { S, sync } = setup(gh);
  const orig = sess('2026-09-15', 'lower-a', { id: 's_a', file: 'training/log/2026-09-15-lower-a.json' });
  sync.enqueue(orig);                                                   // logged offline, never sent
  assert.equal(sync.enqueue({ ...orig, deleted: true, savedAt: 'x' }), null);
  sync.enqueue({ ...orig, date: '2026-09-16', file: 'training/log/2026-09-16-lower-a.json' });
  assert.equal(S.queue.length, 1);
  await sync.flushQueue();
  assert.deepEqual(gh.puts().map(c => c.url.split('/contents/')[1]), ['training/log/2026-09-16-lower-a.json']);
  assert.ok(!gh.store.has('training/log/2026-09-15-lower-a.json'), 'no deleted:true file where no file was');
});

test('a tombstone for a file whose upload is in flight is still queued', async () => {
  const gh = fakeGitHub({ delay: 10 });
  const { S, sync } = setup(gh);
  const orig = sess('2026-09-15', 'lower-a', { file: 'training/log/2026-09-15-lower-a.json' });
  sync.enqueue(orig);
  const f = sync.flushQueue();
  await new Promise(r => setTimeout(r, 2));
  assert.notEqual(sync.enqueue({ ...orig, deleted: true, savedAt: 'x' }), null);
  await f; await sync.flushQueue();
  assert.equal(gh.store.get('training/log/2026-09-15-lower-a.json').deleted, true);
  assert.equal(S.queue.length, 0);
});
