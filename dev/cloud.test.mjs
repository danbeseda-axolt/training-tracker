// Account mode tests against a fake Supabase: no network. node --test "tracker/dev/*.test.mjs"
// Every fixture here is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCloud, clientId, pendingView, routeSave, resolveStorage, claimStorage, promoteToGithub, adoptAfterPull, redactSecrets, explain, SUPABASE_URL, SUPABASE_KEY } from '../cloud.js';
import { makeSync } from '../sync.js';
import * as E from '../engine.js';

const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => { if (body === undefined) throw new Error('no body'); return body; } });
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = sub => 'h.' + b64u({ sub, role: 'authenticated' }) + '.sig';
const USER = '00000000-0000-4000-8000-00000000000a';
const T0 = Date.UTC(2026, 9, 7, 12, 0, 0);

function fakeSupabase({ user = USER, refreshDelay = 0, restStatus = 201, verifyStatus = 200, refreshStatus = 200, otpStatus = 200, rows = [], first401 = 0, delay = 0, refreshThrows = false } = {}) {
  const calls = [];
  const table = new Map(rows.map(r => [r.client_id, r]));
  let n401 = first401, nTok = 0;
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (delay) await new Promise(r => setTimeout(r, delay));
    const u = new URL(url), method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    if (u.pathname === '/auth/v1/otp') return res(otpStatus, otpStatus === 200 ? {} : { code: otpStatus, error_code: otpStatus === 429 ? 'over_email_send_rate_limit' : 'x', msg: 'nope' });
    if (u.pathname === '/auth/v1/verify') {
      if (verifyStatus !== 200) return res(verifyStatus, { code: verifyStatus, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
      return res(200, { access_token: jwt(user), refresh_token: 'rt-1', expires_in: 3600, expires_at: Math.floor(T0 / 1000) + 3600, token_type: 'bearer', user: { id: user, email: user === USER ? 'tester@example.com' : 'other@example.com' } });
    }
    if (u.pathname === '/auth/v1/token') {
      if (refreshThrows) throw new TypeError('Failed to fetch');
      if (refreshDelay) await new Promise(r => setTimeout(r, refreshDelay));
      if (refreshStatus !== 200) return res(refreshStatus, { code: refreshStatus, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      nTok++;
      return res(200, { access_token: jwt(USER) + nTok, refresh_token: 'rt-' + (nTok + 1), expires_in: 3600, expires_at: Math.floor(T0 / 1000) + 7200, user: { id: USER, email: 'tester@example.com' } });
    }
    if (u.pathname === '/rest/v1/sessions') {
      if (n401 > 0) { n401--; return res(401, { message: 'JWT expired' }); }
      if (method === 'GET') return res(200, [...table.values()].map(r => ({ client_id: r.client_id, body: r.body })));
      const st = typeof restStatus === 'function' ? restStatus(body) : restStatus;
      if (st >= 200 && st < 300) {
        if (method === 'DELETE') table.delete(decodeURIComponent(u.searchParams.get('client_id')).replace(/^eq\./, ''));
        else for (const r of body) table.set(r.client_id, r);
      }
      return res(st, st < 300 ? undefined : { message: 'fail', code: 'XX000' });
    }
    return res(404, { message: 'no route' });
  };
  return { fetch, calls, table, rest: () => calls.filter(c => c.url.includes('/rest/v1/')), tok: () => calls.filter(c => c.url.includes('/auth/v1/token')) };
}
function setup(sb, state = {}, { clock = T0, owns = true } = {}) {
  const S = { settings: {}, queue: [], bwQueue: [], history: [], bw: [], cloudQueue: [], cloud: null, ...state };
  const statuses = [];
  let t = clock;
  const cloud = makeCloud({ fetch: sb.fetch, getState: () => S, save: () => {}, onStatus: (c, m) => statuses.push([c, m]), now: () => t, ownsHistory: () => owns });
  return { S, cloud, statuses, tick: ms => { t += ms; } };
}
const signedIn = (over = {}) => ({ access_token: jwt(USER), refresh_token: 'rt-1', expires_at: Math.floor(T0 / 1000) + 3600, user: { id: USER, email: 'tester@example.com' }, ...over });
const sess = (date, key, more = {}) => ({ schemaVersion: 5, date, key, name: key, exercises: [], decisions: [], savedAt: date + 'T18:00:00Z', ...more });

test('verifyCode stores both tokens, the expiry and the user', async () => {
  const sb = fakeSupabase();
  const { S, cloud } = setup(sb);
  await cloud.requestCode(' tester@example.com ');
  const otp = sb.calls[0];
  assert.equal(otp.url, SUPABASE_URL + '/auth/v1/otp');
  assert.deepEqual(JSON.parse(otp.init.body), { email: 'tester@example.com', create_user: true });
  assert.equal(otp.init.headers.apikey, SUPABASE_KEY);
  const u = await cloud.verifyCode('tester@example.com', '123 456');
  assert.deepEqual(JSON.parse(sb.calls[1].init.body), { type: 'email', email: 'tester@example.com', token: '123456' });
  assert.equal(u.id, USER);
  assert.equal(S.cloud.access_token, jwt(USER));
  assert.equal(S.cloud.refresh_token, 'rt-1');
  assert.equal(S.cloud.expires_at, Math.floor(T0 / 1000) + 3600);
  assert.equal(S.cloud.user.email, 'tester@example.com');
  assert.ok(cloud.signedIn());
});

test('a wrong or expired code stores nothing and says so in plain words', async () => {
  const sb = fakeSupabase({ verifyStatus: 403 });
  const { S, cloud } = setup(sb);
  const e = await cloud.verifyCode('tester@example.com', '000000').catch(x => x);
  assert.equal(e.status, 403);
  assert.equal(S.cloud, null);
  assert.match(explain(e), /wrong or has expired/);
});

test('too many code requests and no network get their own messages', async () => {
  const e = await setup(fakeSupabase({ otpStatus: 429 })).cloud.requestCode('tester@example.com').catch(x => x);
  assert.match(explain(e), /Too many requests/);
  const off = await setup({ fetch: async () => { throw new TypeError('Failed to fetch'); } }).cloud.requestCode('a@example.com').catch(x => x);
  assert.match(explain(off), /No connection/);
});

test('a token within 60 s of expiry is refreshed before the call, and the new pair is kept', async () => {
  const sb = fakeSupabase();
  const { S, cloud, tick } = setup(sb, { cloud: signedIn() });
  tick(3600e3 - 30e3);                                    // 30 s left
  cloud.enqueue(sess('2026-10-06', 'upper-push'));
  await cloud.flushQueue();
  assert.equal(sb.tok().length, 1);
  assert.ok(sb.calls.indexOf(sb.tok()[0]) < sb.calls.indexOf(sb.rest()[0]), 'refresh came first');
  assert.deepEqual(JSON.parse(sb.tok()[0].init.body), { refresh_token: 'rt-1' });
  assert.equal(S.cloud.refresh_token, 'rt-2');
  assert.equal(sb.rest()[0].init.headers.Authorization, 'Bearer ' + S.cloud.access_token);
  assert.equal(S.cloudQueue.length, 0);
});

test('a token with time left is not refreshed', async () => {
  const sb = fakeSupabase();
  const { cloud } = setup(sb, { cloud: signedIn() });
  cloud.enqueue(sess('2026-10-06', 'upper-push'));
  await cloud.flushQueue();
  assert.equal(sb.tok().length, 0);
});

test('a 401 refreshes once and retries once', async () => {
  const sb = fakeSupabase({ first401: 1 });
  const { S, cloud } = setup(sb, { cloud: signedIn() });
  cloud.enqueue(sess('2026-10-06', 'upper-push'));
  await cloud.flushQueue();
  assert.equal(sb.tok().length, 1);
  assert.equal(sb.rest().length, 2);
  assert.equal(S.cloudQueue.length, 0);
});

test('a second 401 after the retry keeps the session queued, without a refresh loop', async () => {
  const sb = fakeSupabase({ first401: 5 });
  const { S, cloud } = setup(sb, { cloud: signedIn() });
  cloud.enqueue(sess('2026-10-06', 'upper-push'));
  await cloud.flushQueue();
  assert.equal(sb.tok().length, 1);
  assert.equal(sb.rest().length, 2);
  assert.equal(S.cloudQueue.length, 1);
});

test('a refused refresh signs out but keeps every queued session and history', async () => {
  const sb = fakeSupabase({ refreshStatus: 400 });
  const hist = [sess('2026-10-01', 'lower-a')];
  const { S, cloud, tick, statuses } = setup(sb, { cloud: signedIn(), history: hist.slice() });
  tick(2 * 3600e3);                                       // expired
  cloud.enqueue(sess('2026-10-06', 'upper-push'));
  cloud.enqueue(sess('2026-10-07', 'lower-b'));
  await cloud.flushQueue();
  assert.equal(cloud.signedIn(), false);
  assert.equal(S.cloudQueue.length, 2);
  assert.deepEqual(S.history, hist);
  assert.equal(sb.rest().length, 0);
  assert.equal(S.cloud.signedOutEmail, 'tester@example.com', 'the email is offered again');
  assert.equal(S.cloud.refresh_token, undefined);
  assert.match(statuses.at(-1)[1], /signed out · 2 held/);
});

test('no network during a refresh is not a sign-out', async () => {
  const sb = fakeSupabase({ refreshThrows: true });
  const { S, cloud, tick } = setup(sb, { cloud: signedIn() });
  tick(2 * 3600e3);
  cloud.enqueue(sess('2026-10-06', 'upper-push'));
  await cloud.flushQueue();
  assert.ok(cloud.signedIn(), 'tokens kept for when signal returns');
  assert.equal(S.cloud.refresh_token, 'rt-1');
  assert.equal(S.cloudQueue.length, 1);
  assert.ok(cloud.lastError().offline);
});

test('a confirmed push removes only its own item and upserts the right row', async () => {
  const sb = fakeSupabase({ delay: 5 });
  const { S, cloud } = setup(sb, { cloud: signedIn() });
  const a = sess('2026-10-06', 'upper-push', { file: 'training/log/2026-10-06-upper-push.json' });
  cloud.enqueue(a);
  const p = cloud.flushQueue();
  await new Promise(r => setTimeout(r, 1));               // a is in flight
  cloud.enqueue(sess('2026-10-07', 'lower-b'));           // queued meanwhile
  assert.equal(cloud.flushQueue(), p, 'joins the running flush');
  await p;
  assert.equal(S.cloudQueue.length, 0, 'the rerun took the second');
  const first = sb.rest()[0];
  assert.equal(first.url, SUPABASE_URL + '/rest/v1/sessions?on_conflict=user_id,client_id');
  assert.equal(first.init.method, 'POST');
  assert.equal(first.init.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
  assert.equal(first.init.headers.apikey, SUPABASE_KEY);
  const [row] = JSON.parse(first.init.body);
  assert.deepEqual(Object.keys(row).sort(), ['body', 'client_id', 'schema_version', 'session_date', 'template_key', 'user_id']);
  assert.equal(row.user_id, USER);
  assert.equal(row.client_id, '2026-10-06-upper-push.json');
  assert.equal(row.session_date, '2026-10-06');
  assert.equal(row.template_key, 'upper-push');
  assert.equal(row.schema_version, 5);
  assert.equal(row.body.qid, undefined, 'the qid never reaches the row');
  assert.deepEqual(row.body, a);
  assert.deepEqual(S.history.map(h => h.date), ['2026-10-07', '2026-10-06']);
});

test('only 200, 201 and 204 count: a 409, 500 or 403 keeps the item queued', async () => {
  for (const st of [409, 500, 403, 404, 202]) {
    const sb = fakeSupabase({ restStatus: st });
    const { S, cloud, statuses } = setup(sb, { cloud: signedIn() });
    cloud.enqueue(sess('2026-10-06', 'upper-push'));
    await cloud.flushQueue();
    assert.equal(S.cloudQueue.length, 1, String(st));
    assert.equal(S.history.length, 0, String(st));
    assert.equal(statuses.at(-1)[0], 'bad', String(st));
  }
});

test('one failure among several leaves exactly that one queued', async () => {
  const sb = fakeSupabase({ restStatus: rows => rows[0].client_id.includes('10-06') ? 500 : 201 });
  const { S, cloud } = setup(sb, { cloud: signedIn() });
  for (const d of ['2026-10-05', '2026-10-06', '2026-10-07']) cloud.enqueue(sess(d, 'upper-push'));
  await cloud.flushQueue();
  assert.deepEqual(S.cloudQueue.map(q => q.date), ['2026-10-06']);
});

test('two concurrent flushes send each queued session exactly once', async () => {
  const sb = fakeSupabase({ delay: 3 });
  const { S, cloud } = setup(sb, { cloud: signedIn() });
  for (const d of ['2026-10-05', '2026-10-06', '2026-10-07']) cloud.enqueue(sess(d, 'upper-push'));
  const a = cloud.flushQueue(), b = cloud.flushQueue();
  assert.equal(a, b);
  await a;
  assert.equal(sb.rest().length, 3);
  assert.equal(S.cloudQueue.length, 0);
});

test('a re-push of the same session uses the same client_id, so the row is updated, not duplicated', async () => {
  const sb = fakeSupabase();
  const { cloud } = setup(sb, { cloud: signedIn() });
  cloud.enqueue(sess('2026-10-06', 'upper-push', { notes: 'v1' }));
  await cloud.flushQueue();
  cloud.enqueue(sess('2026-10-06', 'upper-push', { notes: 'v2' }));
  await cloud.flushQueue();
  const ids = sb.rest().map(c => JSON.parse(c.init.body)[0].client_id);
  assert.deepEqual(ids, ['2026-10-06-upper-push.json', '2026-10-06-upper-push.json']);
  assert.equal(sb.table.size, 1);
  assert.equal(sb.table.get('2026-10-06-upper-push.json').body.notes, 'v2');
});

test('a second session on one day keeps its -2 name as its own row', () => {
  assert.equal(clientId(sess('2026-10-06', 'upper-push', { file: 'training/log/2026-10-06-upper-push-2.json' })), '2026-10-06-upper-push-2.json');
  assert.equal(clientId(sess('2026-10-06', 'upper-push')), '2026-10-06-upper-push.json');
});

test('enqueue replaces an older unsent version, never one in flight', async () => {
  const sb = fakeSupabase({ delay: 8 });
  const { S, cloud } = setup(sb, { cloud: signedIn() });
  cloud.enqueue(sess('2026-10-06', 'upper-push', { notes: 'v1' }));
  cloud.enqueue(sess('2026-10-06', 'upper-push', { notes: 'v2' }));
  assert.deepEqual(S.cloudQueue.map(q => q.notes), ['v2']);
  const p = cloud.flushQueue();
  await new Promise(r => setTimeout(r, 2));
  cloud.enqueue(sess('2026-10-06', 'upper-push', { notes: 'v3' }));
  assert.deepEqual(S.cloudQueue.map(q => q.notes), ['v2', 'v3']);
  cloud.flushQueue();
  await p;
  assert.equal(S.cloudQueue.length, 0);
  assert.equal(sb.table.get('2026-10-06-upper-push.json').body.notes, 'v3');
});

test('a deleted session deletes its own row', async () => {
  const sb = fakeSupabase({ rows: [{ client_id: '2026-10-01-lower-a.json', body: sess('2026-10-01', 'lower-a') }] });
  const { S, cloud } = setup(sb, { cloud: signedIn(), history: [sess('2026-10-01', 'lower-a')] });
  cloud.enqueue({ ...sess('2026-10-01', 'lower-a'), deleted: true });
  await cloud.flushQueue();
  const del = sb.rest()[0];
  assert.equal(del.init.method, 'DELETE');
  assert.equal(del.url, SUPABASE_URL + '/rest/v1/sessions?client_id=eq.2026-10-01-lower-a.json&user_id=eq.' + USER, 'RLS plus a user_id filter as a second guard');
  assert.equal(sb.table.size, 0);
  assert.equal(S.history.length, 0);
});

test('sign-out clears the tokens only: history and the queue stay', async () => {
  const sb = fakeSupabase();
  const hist = [sess('2026-10-01', 'lower-a')];
  const { S, cloud } = setup(sb, { cloud: signedIn(), history: hist.slice() });
  cloud.enqueue(sess('2026-10-06', 'upper-push'));
  cloud.signOut();
  assert.equal(cloud.signedIn(), false);
  assert.equal(S.cloud.access_token, undefined);
  assert.equal(S.cloudQueue.length, 1);
  assert.deepEqual(S.history, hist);
  await cloud.flushQueue();
  assert.equal(sb.calls.length, 0, 'nothing is sent while signed out');
  assert.equal(S.cloudQueue.length, 1);
  assert.equal(sb.calls.length, 0);
});

test('importHistory pushes every local session, reports counts, and is idempotent', async () => {
  const sb = fakeSupabase();
  const { cloud } = setup(sb, { cloud: signedIn() }, { owns: false });
  const local = [sess('2026-09-30', 'lower-a'), sess('2026-10-01', 'upper-push'), sess('2026-10-02', 'lower-b', { file: 'training/log/2026-10-02-lower-b-2.json' }), { date: '2026-09-01', key: 'x', deleted: true }];
  assert.deepEqual(await cloud.importHistory(local), { total: 3, saved: 3, held: 0 });
  assert.deepEqual(await cloud.importHistory(local), { total: 3, saved: 3, held: 0 });
  assert.equal(sb.rest().length, 6);
  assert.equal(sb.table.size, 3, 'a second run updates the same rows');
  assert.ok(sb.table.has('2026-10-02-lower-b-2.json'));
});

test('importHistory reports what is held when some writes fail', async () => {
  const sb = fakeSupabase({ restStatus: rows => rows[0].session_date === '2026-10-01' ? 503 : 201 });
  const { S, cloud } = setup(sb, { cloud: signedIn() });
  const r = await cloud.importHistory([sess('2026-09-30', 'lower-a'), sess('2026-10-01', 'upper-push')]);
  assert.deepEqual(r, { total: 2, saved: 1, held: 1 });
  assert.equal(S.cloudQueue.length, 1);
});

test('importHistory keeps a newer copy that is already queued', async () => {
  const sb = fakeSupabase({ delay: 0 });
  const { S, cloud } = setup(sb, { cloud: null });
  cloud.enqueue(sess('2026-10-01', 'upper-push', { notes: 'newer' }));   // saved while signed out
  S.cloud = signedIn();
  await cloud.importHistory([sess('2026-10-01', 'upper-push', { notes: 'older' })]);
  assert.equal(sb.table.get('2026-10-01-upper-push.json').body.notes, 'newer');
});

test('when GitHub owns history, a confirmed push or a pull does not touch it', async () => {
  const sb = fakeSupabase({ rows: [{ client_id: 'a.json', body: sess('2026-10-03', 'upper-pull') }] });
  const hist = [sess('2026-10-01', 'lower-a')];
  const { S, cloud } = setup(sb, { cloud: signedIn(), history: hist.slice() }, { owns: false });
  cloud.enqueue(sess('2026-10-06', 'upper-push'));
  await cloud.flushQueue();
  assert.equal(await cloud.pullHistory(), false);
  assert.deepEqual(S.history, hist);
});

test('pullHistory replaces history with the rows, leaves the queue alone', async () => {
  const sb = fakeSupabase({ rows: [
    { client_id: '2026-10-03-upper-pull.json', body: sess('2026-10-03', 'upper-pull') },
    { client_id: '2026-10-05-lower-b.json', body: sess('2026-10-05', 'lower-b') }] });
  const { S, cloud } = setup(sb, { cloud: signedIn(), history: [sess('2026-01-01', 'old')], cloudQueue: [{ ...sess('2026-10-07', 'lower-a'), qid: 'c_x' }] });
  sb.calls.length = 0;
  const bodies = await cloud.pullSessions();
  assert.equal(bodies.length, 2);
  assert.equal(sb.calls[0].init.cache, 'no-store');
  assert.match(sb.calls[0].url, /\/rest\/v1\/sessions\?select=client_id,body/);
  await cloud.pullHistory();
  assert.deepEqual(S.history.map(h => h.date), ['2026-10-05', '2026-10-03']);
  assert.equal(S.cloudQueue.length, 1);
});

test('pendingView: no GitHub, the account queue overlays history; with GitHub, it is ignored', () => {
  const h = [sess('2026-10-01', 'a')];
  const cq = [{ ...h[0], verified: true }, sess('2026-10-03', 'c')];
  assert.deepEqual(pendingView(h, [], cq, true).map(x => x.date), ['2026-10-01', '2026-10-03']);
  assert.equal(E.mergedHistory(h, pendingView(h, [], cq, true)).find(x => x.date === '2026-10-01').verified, true);
  const q = [sess('2026-10-02', 'b')];
  assert.deepEqual(pendingView(h, q, cq, false), q, 'GitHub owns history: exactly the GitHub queue');
});

test('cloud.js holds no secret key and imports nothing', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../cloud.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m);
  assert.doesNotMatch(src, /service_role|sb_secret_/);
  assert.doesNotMatch(src, /eyJ[A-Za-z0-9_-]{10,}/, 'no JWT literal');
});

/* ------------------------------------------------ regressions, QA 2026-10-07 */
/* Both queues on one state, the way index.html wires them: routeSave decides
   where a change goes, pendingView what the screens see. */
function both({ ghPut = 201, sb = fakeSupabase(), state = {} } = {}) {
  const ghStore = new Map();
  const ghFetch = async (url, init = {}) => {
    const path = decodeURIComponent((url.split('/contents/')[1] || '').split('?')[0]);
    if ((init.method || 'GET') === 'GET' && path === 'training/log') return ghStore.size
      ? res(200, [...ghStore.keys()].map(p => ({ type: 'file', name: p.split('/').pop(), path: p }))) : res(404, { message: 'Not Found' });
    if ((init.method || 'GET') === 'GET') return ghStore.has(path) ? res(200, { sha: 's', content: Buffer.from(JSON.stringify(ghStore.get(path))).toString('base64') }) : res(404, { message: 'Not Found' });
    if (ghPut < 300) ghStore.set(path, JSON.parse(Buffer.from(JSON.parse(init.body).content, 'base64').toString()));
    return res(ghPut, { content: {} });
  };
  const S = { settings: { token: 'TEST_TOKEN_NOT_REAL', owner: 'o', repo: 'r', branch: 'main', path: 'training/log' },
    queue: [], bwQueue: [], history: [], bw: [], cloudQueue: [], cloud: null, ...state };
  const sync = makeSync({ fetch: (u, i) => (ghFetch.offline ? Promise.reject(new TypeError('offline')) : ghFetch(u, i)), getState: () => S, save: () => {} });
  const mode = () => resolveStorage(S, sync.cfgOk());
  const cloud = makeCloud({ fetch: sb.fetch, getState: () => S, save: () => {}, now: () => T0, ownsHistory: () => mode() === 'account' });
  const queueItem = item => { const to = routeSave(mode(), cloud.inUse()); if (to.github) sync.enqueue(item); if (to.account) cloud.enqueue(item); };
  /* index.html's adoptGithubQueue, verbatim in behaviour */
  const adopt = () => { if (mode() !== 'account' || !S.queue.length) return; for (const q of S.queue.slice()) if (!S.cloudQueue.some(c => E.fileKey(c) === E.fileKey(q))) cloud.enqueue(q); S.queue = []; };
  const view = () => E.mergedHistory(S.history, pendingView(S.history, S.queue, S.cloudQueue, mode() === 'account'));
  return { S, sync, cloud, sb, ghStore, ghFetch, queueItem, adopt, view, mode };
}

test('QA1: with GitHub, a held account copy never brings back a session deleted while signed out', async () => {
  const sb = fakeSupabase({ restStatus: 500 });
  const X = sess('2026-10-05', 'upper-push', { file: 'training/log/2026-10-05-upper-push.json' });
  const t = both({ sb, state: { cloud: signedIn(), storage: 'github' } });
  t.queueItem(X);
  await t.sync.flushQueue(); await t.cloud.flushQueue();
  assert.equal(t.S.history.length, 1, 'X is on GitHub');
  assert.equal(t.S.cloudQueue.length, 1, 'the account copy is held');
  t.cloud.signOut();
  assert.equal(t.view().length, 1);
  t.queueItem({ ...X, deleted: true, savedAt: '2026-10-07T09:00:00Z' });   // Delete in History
  t.S.history = t.S.history.filter(h => E.fileKey(h) !== E.fileKey(X));
  await t.sync.flushQueue();
  assert.equal(t.ghStore.get('training/log/2026-10-05-upper-push.json').deleted, true, 'GitHub got the tombstone');
  assert.deepEqual(t.view(), [], 'the held copy does not resurrect X');
  assert.deepEqual(t.S.cloudQueue.map(q => !!q.deleted), [true], 'the held upsert was replaced by a held delete');
  t.S.cloud = signedIn();
  sb.calls.length = 0;
  const ok = fakeSupabase();
  const t2 = makeCloud({ fetch: ok.fetch, getState: () => t.S, save: () => {}, now: () => T0, ownsHistory: () => false });
  await t2.flushQueue();
  assert.deepEqual(ok.rest().map(c => c.init.method), ['DELETE'], 'next sign-in deletes the row, never upserts X');
});

test('QA1: with GitHub, Verify while an account copy is held shows verified and replaces the held copy', async () => {
  const sb = fakeSupabase({ restStatus: 500 });
  const X = sess('2026-10-05', 'upper-push');
  const t = both({ sb, state: { cloud: signedIn(), history: [X], storage: 'github' } });
  t.cloud.enqueue(X); await t.cloud.flushQueue();
  t.cloud.signOut();
  t.queueItem({ ...X, verified: true });
  assert.equal(t.view()[0].verified, true);
  assert.deepEqual(t.S.cloudQueue.map(q => q.verified), [true]);
});

test('QA2: no GitHub, signed out by a refused refresh: saves and deletes are held for the account, and sent after sign-in', async () => {
  const t = both({ sb: fakeSupabase({ refreshStatus: 400 }), state: { cloud: signedIn({ expires_at: Math.floor(T0 / 1000) - 10 }), storage: 'account' } });
  t.S.settings.token = '';
  t.queueItem(sess('2026-10-04', 'lower-a'));
  await t.cloud.flushQueue();
  assert.equal(t.cloud.signedIn(), false);
  const A = sess('2026-10-06', 'upper-push');
  t.queueItem(A);
  t.queueItem({ ...sess('2026-10-04', 'lower-a'), deleted: true, savedAt: '2026-10-06T19:00:00Z' });
  assert.equal(t.S.queue.length, 0, 'nothing goes to the GitHub queue');
  assert.equal(t.S.cloudQueue.length, 2);
  assert.deepEqual(t.view().map(s => s.date), ['2026-10-06'], 'the screens see the held saves');
  t.S.cloud = signedIn();
  const ok = fakeSupabase();
  const c2 = makeCloud({ fetch: ok.fetch, getState: () => t.S, save: () => {}, now: () => T0, ownsHistory: () => true });
  await c2.flushQueue();
  assert.deepEqual(ok.rest().map(c => c.init.method).sort(), ['DELETE', 'POST']);
  assert.equal(t.S.cloudQueue.length, 0);
  assert.deepEqual(t.S.history.map(s => s.date), ['2026-10-06']);
});

test('QA2: routeSave follows the storage mode, never the token', () => {
  assert.deepEqual(routeSave('github', false), { github: true, account: false }, 'Dan before the account: exactly as today');
  assert.deepEqual(routeSave('github', true), { github: true, account: true }, 'the account is a copy');
  assert.deepEqual(routeSave('account', true), { github: false, account: true }, 'account phone: the account only, signed in or not');
  assert.deepEqual(routeSave(null, false), { github: true, account: false }, 'fresh phone: held for GitHub as before');
});

test('QA2: a sign-out keeps the account in use, with no token left', () => {
  const { S, cloud } = setup(fakeSupabase(), { cloud: signedIn() });
  cloud.signOut();
  assert.ok(cloud.inUse());
  assert.deepEqual(S.cloud, { signedOut: true, signedOutEmail: 'tester@example.com', lastUserId: USER });
});

test('QA3: signing out while a refresh is in flight stays signed out', async () => {
  const sb = fakeSupabase({ refreshDelay: 10 });
  const { S, cloud } = setup(sb, { cloud: signedIn({ expires_at: Math.floor(T0 / 1000) - 10 }) });
  cloud.enqueue(sess('2026-10-06', 'upper-push'));
  const f = cloud.flushQueue();
  await new Promise(r => setTimeout(r, 2));
  assert.equal(sb.tok().length, 1, 'the refresh is in flight');
  cloud.signOut();
  await f;
  assert.equal(cloud.signedIn(), false);
  assert.equal(S.cloud.access_token, undefined);
  assert.equal(S.cloud.refresh_token, undefined);
  assert.equal(sb.rest().length, 0, 'nothing uploaded after the sign-out');
  assert.equal(S.cloudQueue.length, 1);
});

test('QA4: held sessions are never uploaded under a different account', async () => {
  const OTHER = '00000000-0000-4000-8000-00000000000b';
  const sb = fakeSupabase({ user: OTHER });
  const { S, cloud } = setup(sb, { cloud: { signedOut: true, signedOutEmail: 'tester@example.com' },
    cloudOwner: { id: USER, email: 'tester@example.com' }, cloudQueue: [{ ...sess('2026-10-06', 'upper-push'), qid: 'c_1' }], history: [sess('2026-10-01', 'lower-a')] });
  const who = await cloud.verifyCode('other@example.com', '123456');
  assert.equal(who.foreign, true);
  assert.equal(cloud.foreign(), true);
  await cloud.flushQueue();
  assert.equal(await cloud.pullHistory(), false);
  const e = await cloud.importHistory(S.history).catch(x => x);
  assert.equal(e.code, 'foreign');
  assert.match(explain(e), /another account \(tester@example\.com\)/);
  assert.equal(sb.rest().length, 0, 'no row written or read for the other account');
  assert.equal(S.cloudQueue.length, 1);
  assert.equal(S.history.length, 1);
  assert.equal(S.cloudOwner.id, USER, 'the owner is not taken over');
});

test('QA4: an empty phone adopts whoever signs in, and the first sign-in records the owner', async () => {
  const OTHER = '00000000-0000-4000-8000-00000000000b';
  const a = setup(fakeSupabase());
  await a.cloud.verifyCode('tester@example.com', '123456');
  assert.equal(a.S.cloudOwner.id, USER);
  const b = setup(fakeSupabase({ user: OTHER }), { cloudOwner: { id: USER, email: 'tester@example.com' } });
  const who = await b.cloud.verifyCode('other@example.com', '123456');
  assert.equal(who.foreign, false);
  assert.equal(b.S.cloudOwner.id, OTHER);
});

test('QA5: export redacts tokens inside raw corrupt copies', () => {
  const raw = JSON.stringify({ settings: { token: 'github_pat_TESTONLY_123' }, cloud: { access_token: jwt(USER), refresh_token: 'rt-secret' } }) + '{broken "token":"ghp_' + 'a'.repeat(30) + '"';
  const out = redactSecrets(raw);
  assert.doesNotMatch(out, /github_pat_|ghp_|rt-secret|TESTONLY/);
  assert.doesNotMatch(out, new RegExp(jwt(USER).replace(/\./g, '\\.')));
  assert.match(out, /"token":"\[removed\]"/);
});

test('QA5: the page redacts corrupt copies before Export, and routes saves through routeSave', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /out\[k\] = redactSecrets\(localStorage\.getItem\(k\)\)/);
  assert.match(html, /const to = routeSave\(mode\(\), cloud\.inUse\(\)\)/);
  assert.match(html, /function adoptGithubQueue\(\)\{\n  if\(mode\(\) !== 'account' \|\| !S\.queue\.length\) return;/, 'adoption only in account mode');
  assert.match(html, /const accountOwns = \(\) => mode\(\) === 'account';/);
  assert.match(html, /claimStorage\(S, sync\.cfgOk\(\)\); save\(\);/, 'a sign-in claims the mode');
  assert.match(html, /pendingView\(S\.history, S\.queue, cloudQ\(\), accountOwns\(\)\)/);
});

/* ------------------------------------------------ regressions, QA round 2 */
test('QA-R2: a token blanked and restored with the account in use: A and B stay in History and go to GitHub', async () => {
  const t = both({ state: { cloud: { signedOut: true, signedOutEmail: 'tester@example.com' } } });
  t.ghFetch.offline = true;                                   // in the gym, no signal
  assert.equal(t.mode(), 'github');
  const A = sess('2026-10-06', 'd1', { file: 'training/log/2026-10-06-d1.json' });
  const B = sess('2026-10-07', 'd2', { file: 'training/log/2026-10-07-d2.json' });
  t.queueItem(A);
  t.S.settings.token = '';                                    // expired token cleared before pasting a new one
  t.queueItem(B);
  t.adopt();                                                  // boot / flushAll
  assert.equal(t.mode(), 'github', 'a blank token does not change the mode');
  assert.deepEqual(t.S.queue.map(q => q.name), ['d1', 'd2'], 'both stay in the GitHub queue');
  assert.deepEqual(t.view().map(x => x.name), ['d2', 'd1'], 'and in History while the token is blank');
  t.S.settings.token = 'TEST_TOKEN_NOT_REAL_2';
  assert.deepEqual(t.view().map(x => x.name), ['d2', 'd1'], 'and once it is back');
  t.ghFetch.offline = false;
  await t.sync.flushQueue();
  assert.ok(t.ghStore.has('training/log/2026-10-06-d1.json') && t.ghStore.has('training/log/2026-10-07-d2.json'), 'both reach training/log/');
  assert.equal(t.S.queue.length, 0);
  assert.deepEqual(t.S.cloudQueue.map(q => q.name), ['d1', 'd2'], 'the account copies are held for the next sign-in');
});

test('QA-R2: state saved before the mode existed: Dan-like state becomes github, and stays github', () => {
  const dan = { settings: { token: 'TEST_TOKEN_NOT_REAL', owner: 'o', repo: 'r', path: 'training/log' }, history: [sess('2026-10-01', 'lower-a')], queue: [], bwQueue: [], bw: [] };
  assert.equal(resolveStorage(dan, true), 'github');
  const danBlank = { history: [sess('2026-10-01', 'lower-a')], queue: [], bwQueue: [], bw: [], cloud: { signedOut: true } };
  assert.equal(resolveStorage(danBlank, false), 'github', 'GitHub data, account used, token blank: still github');
  const danQueued = { history: [], queue: [sess('2026-10-02', 'x')], bwQueue: [], bw: [], cloud: signedIn() };
  assert.equal(resolveStorage(danQueued, false), 'github', 'a GitHub queue is GitHub data');
  assert.equal(claimStorage(danBlank, false), 'github', 'a sign-in on a GitHub phone keeps it github');
  danBlank.cloud = null;
  assert.equal(resolveStorage(danBlank, false), 'github', 'never flips back by itself');
});

test('QA-R2: a fresh phone is unset until GitHub is valid or someone signs in', () => {
  const fresh = { history: [], queue: [], bwQueue: [], bw: [] };
  assert.equal(resolveStorage(fresh, false), null);
  assert.equal(fresh.storage, null, 'recorded, so later sessions in the queue are not mistaken for GitHub data');
  fresh.queue.push(sess('2026-10-03', 'upper-push'));         // logged before signing in
  assert.equal(resolveStorage(fresh, false), null);
  assert.equal(claimStorage(fresh, false), 'account');
  assert.equal(resolveStorage(fresh, true), 'account', 'an account phone is not flipped by a token either');
  const fresh2 = { history: [], queue: [], bwQueue: [], bw: [] };
  resolveStorage(fresh2, false);
  assert.equal(resolveStorage(fresh2, true), 'github', 'GitHub valid for the first time');
  assert.equal(claimStorage(fresh2, false), 'github');
  const v56friend = { history: [], queue: [], bwQueue: [], bw: [], cloud: signedIn() };
  assert.equal(resolveStorage(v56friend, false), 'account', 'account used, no GitHub data at all');
});

test('QA-R2: queued account items carry their owner; only the signed-in user\'s are uploaded', async () => {
  const OTHER = '00000000-0000-4000-8000-00000000000b';
  const sb = fakeSupabase();
  const { S, cloud } = setup(sb, { cloud: signedIn(), cloudOwner: { id: USER, email: 'tester@example.com' } });
  cloud.enqueue(sess('2026-10-05', 'lower-a'));
  assert.equal(S.cloudQueue[0]._owner, USER);
  cloud.signOut();
  cloud.enqueue(sess('2026-10-06', 'upper-push'));            // while signed out: the last user's
  assert.equal(S.cloudQueue[1]._owner, USER);
  S.cloud = signedIn({ access_token: jwt(OTHER), user: { id: OTHER, email: 'other@example.com' } });
  cloud.enqueue(sess('2026-10-07', 'lower-b'));               // the other person's own session
  assert.equal(S.cloudQueue[2]._owner, OTHER);
  await cloud.flushQueue();
  assert.deepEqual(sb.rest().map(c => JSON.parse(c.init.body)[0].client_id), ['2026-10-07-lower-b.json']);
  assert.equal(JSON.parse(sb.rest()[0].init.body)[0].user_id, OTHER);
  assert.equal(JSON.parse(sb.rest()[0].init.body)[0].body._owner, undefined, 'the tag never reaches the row');
  assert.deepEqual(S.cloudQueue.map(q => q.date), ['2026-10-05', '2026-10-06'], 'the first user\'s stay held');
});

test('QA-R2: no user id: nothing is sent, no DELETE with an undefined filter, the item is held', async () => {
  const sb = fakeSupabase();
  const { S, cloud, statuses } = setup(sb, { cloud: { access_token: 'not-a-jwt', refresh_token: 'rt-1', expires_at: Math.floor(T0 / 1000) + 3600, user: {} } });
  cloud.enqueue({ ...sess('2026-10-01', 'lower-a'), deleted: true });
  await cloud.flushQueue();
  assert.equal(sb.calls.length, 0);
  assert.equal(S.cloudQueue.length, 1);
  assert.match(statuses.at(-1)[1], /sign in again/);
  assert.match(explain(cloud.lastError()), /sign-in is incomplete/);
  await assert.rejects(cloud.pushSession({ ...sess('2026-10-01', 'lower-a'), deleted: true }), e => e.code === 'no_user');
  assert.equal(sb.calls.length, 0);
});

test('QA-R2: redactSecrets blanks a refresh_token cut off by a truncated copy', () => {
  const out = redactSecrets('{"v":5,"cloud":{"access_token":"h.x.y","refresh_token":"rt-TESTONLY-cut');
  assert.doesNotMatch(out, /TESTONLY|h\.x\.y/);
  assert.match(out, /"refresh_token":"\[removed\]"$/);
  assert.doesNotMatch(redactSecrets('{"token":"abc\\'), /abc/, 'a trailing escape is removed too');
});

/* ------------------------------------------------ regressions, QA round 3 */
/* The page's mode(), pullGithub() and adoptGithubQueue(), in behaviour. */
function phone(state = {}, sbOpts = {}) {
  const t = both({ sb: fakeSupabase(sbOpts), state });
  let clock = T0;
  const mode = () => {
    let m = resolveStorage(t.S, t.sync.cfgOk());
    if (m === 'account' && t.sync.cfgOk() && promoteToGithub(t.S, t.cloud.ownerId(), clock)) m = t.S.storage;
    return m;
  };
  const queueItem = item => { const to = routeSave(mode(), t.cloud.inUse()); if (to.github) t.sync.enqueue(item); if (to.account) t.cloud.enqueue(item); };
  const pullGithub = async () => { clock += 1000; const ok = await t.sync.pullHistory(); for (const it of adoptAfterPull(t.S, ok)) t.sync.enqueue(it); return ok; };
  const adopt = () => { if (mode() !== 'account' || !t.S.queue.length) return; const placed = new Set(t.cloud.adoptItems(t.S.queue.slice())); t.S.queue = t.S.queue.filter(q => !placed.has(q)); };
  const view = () => E.mergedHistory(t.S.history, pendingView(t.S.history, t.S.queue, t.S.cloudQueue, mode() === 'account'));
  return { ...t, mode, queueItem, pullGithub, adopt, view };
}
const blankGh = () => ({ token: '', owner: 'o', repo: 'r', branch: 'main', path: 'training/log' });

test('QA-R3: reinstall: sign in first, then paste the token: the phone becomes github and C goes to the GitHub queue', async () => {
  const p = phone({ settings: blankGh() });
  assert.equal(p.mode(), null, 'DEFAULTS fill owner/repo/path; without a token it is not set');
  p.S.cloud = signedIn(); claimStorage(p.S, p.sync.cfgOk());
  assert.equal(p.mode(), 'account');
  const R1 = sess('2026-10-01', 'lower-a', { file: 'training/log/2026-10-01-lower-a.json' });
  const R2 = sess('2026-10-03', 'upper-pull', { file: 'training/log/2026-10-03-upper-pull.json' });
  p.S.history = [R1, R2];                                    // pulled from the account
  p.ghStore.set('training/log/2026-10-01-lower-a.json', R1);  // GitHub already has R1, not R2
  p.S.settings.token = 'TEST_TOKEN_NOT_REAL';
  assert.equal(p.mode(), 'github', 'account → github once GitHub is valid');
  const C = sess('2026-10-08', 'lower-b', { file: 'training/log/2026-10-08-lower-b.json' });
  p.queueItem(C);
  assert.deepEqual(p.S.queue.map(q => q.key), ['lower-b'], 'C is in the GitHub queue');
  assert.deepEqual(p.S.cloudQueue.map(q => q.key), ['lower-b'], 'and the account keeps a copy');
  assert.deepEqual(p.view().map(x => x.key), ['lower-b', 'upper-pull', 'lower-a'], 'nothing vanishes before the pull');
  await p.pullGithub();
  assert.deepEqual(p.S.queue.map(q => q.key).sort(), ['lower-b', 'upper-pull'], 'only what GitHub lacks is adopted');
  await p.sync.flushQueue();
  assert.ok(p.ghStore.has('training/log/2026-10-03-upper-pull.json') && p.ghStore.has('training/log/2026-10-08-lower-b.json'));
  assert.equal(p.S.adoptPending, undefined);
  p.S.settings.token = '';
  assert.equal(p.mode(), 'github', 'never back to account');
});

test('QA-R3: promotion adopts the owner\'s queued account changes, deletions only where GitHub has the file', async () => {
  const OTHER = '00000000-0000-4000-8000-00000000000b';
  const onGh = sess('2026-09-28', 'upper-push', { file: 'training/log/2026-09-28-upper-push.json' });
  const p = phone({ settings: blankGh(), storage: 'account', cloud: signedIn(), cloudOwner: { id: USER, email: 'tester@example.com' },
    history: [onGh, sess('2026-09-29', 'lower-a', { file: 'training/log/2026-09-29-lower-a.json' })],
    cloudQueue: [
      { ...onGh, deleted: true, savedAt: '2026-10-05T08:00:00Z', qid: 'c_1', _owner: USER },
      { ...sess('2026-09-29', 'lower-a', { file: 'training/log/2026-09-29-lower-a.json' }), deleted: true, savedAt: '2026-10-05T08:00:00Z', qid: 'c_2', _owner: USER },
      { ...sess('2026-10-04', 'upper-pull', { file: 'training/log/2026-10-04-upper-pull.json' }), qid: 'c_3', _owner: USER },
      { ...sess('2026-10-04', 'lower-b', { file: 'training/log/2026-10-04-lower-b.json' }), qid: 'c_4', _owner: OTHER }] });
  p.ghStore.set('training/log/2026-09-28-upper-push.json', onGh);
  p.S.settings.token = 'TEST_TOKEN_NOT_REAL';
  assert.equal(p.mode(), 'github');
  assert.deepEqual(p.view(), [], 'rows deleted by a queued change do not come back');
  await p.pullGithub();
  const q = p.S.queue.map(x => x.key + (x.deleted ? ':deleted' : '')).sort();
  assert.deepEqual(q, ['upper-pull', 'upper-push:deleted'], 'own new session adopted, delete sent only for a file GitHub has, nobody else\'s');
  assert.ok(p.S.queue.every(x => x.qid && x._owner === undefined), 'GitHub items carry no account tags');
  await p.sync.flushQueue();
  assert.equal(p.ghStore.get('training/log/2026-09-28-upper-push.json').deleted, true);
  assert.ok(!p.ghStore.has('training/log/2026-09-29-lower-a.json'), 'no deleted:true file where no file was');
  assert.equal(p.S.cloudQueue.length, 4, 'the account copies stay queued for the account');
});

test('QA-R3: a pull that fails keeps the set-aside sessions for the next pull; no log folder adopts everything', async () => {
  const S = { storage: 'account', history: [sess('2026-10-01', 'a')], queue: [], cloudQueue: [], historyFetched: 0 };
  promoteToGithub(S, USER, 5000);
  assert.deepEqual(adoptAfterPull(S, false), []);
  assert.equal(S.adoptPending.items.length, 1, 'kept after a failed pull');
  assert.deepEqual(adoptAfterPull(S, true).map(x => x.key), ['a'], 'pull ok but history not replaced: GitHub had no log yet');
  assert.equal(S.adoptPending, undefined);
});

test('QA-R3: adoption never drops a session because a same-named copy exists', () => {
  const OTHER = '00000000-0000-4000-8000-00000000000b';
  const { S, cloud } = setup(fakeSupabase(), { cloud: signedIn(), storage: 'account', cloudOwner: { id: USER, email: 'tester@example.com' } });
  const k = (d, more) => sess(d, 'upper-push', more);
  S.cloudQueue.push({ ...k('2026-10-01', { notes: 'older in account', savedAt: '2026-10-01T09:00:00Z' }), qid: 'c_a', _owner: USER });
  S.cloudQueue.push({ ...k('2026-10-02', { notes: 'newer in account', savedAt: '2026-10-02T12:00:00Z' }), qid: 'c_b', _owner: USER });
  S.cloudQueue.push({ ...k('2026-10-03', { notes: 'someone else', savedAt: '2026-10-03T09:00:00Z' }), qid: 'c_c', _owner: OTHER });
  S.queue = [
    { ...k('2026-10-01', { notes: 'newer on phone', savedAt: '2026-10-01T18:00:00Z' }), qid: 'q_1' },
    { ...k('2026-10-02', { notes: 'older on phone', savedAt: '2026-10-02T08:00:00Z' }), qid: 'q_2' },
    { ...k('2026-10-03', { notes: 'mine, same name as theirs', savedAt: '2026-10-03T08:00:00Z' }), qid: 'q_3' }];
  const placed = new Set(cloud.adoptItems(S.queue.slice()));
  S.queue = S.queue.filter(q => !placed.has(q));
  assert.equal(S.queue.length, 0, 'the source is emptied only of placed items');
  const byDate = d => S.cloudQueue.filter(q => q.date === d).map(q => q.notes).sort();
  assert.deepEqual(byDate('2026-10-01'), ['newer on phone']);
  assert.deepEqual(byDate('2026-10-02'), ['newer in account']);
  assert.deepEqual(byDate('2026-10-03'), ['mine, same name as theirs', 'someone else'], 'nobody\'s copy is dropped');
});

test('QA-R3: a fresh phone before sign-in shows neutral copy, not "No GitHub token"', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /if\(mode\(\) === null\) return '<div class="banner warn">Not saved anywhere yet\. Sign in under Settings → Account to keep your sessions\.<\/div>';/);
  assert.match(html, /GitHub is set up\. From now on sessions go to GitHub and your account keeps a copy\./);
  assert.doesNotMatch(html.replace(/function pullGithub\(\)\{[\s\S]*?\n\}/, ''), /sync\.pullHistory\(\)/, 'every GitHub pull runs the adoption step');
});
