// Regression tests for the 2026-09-23 review findings. One test per bug, named
// after what went wrong. Synthetic fixtures only: tracker/ is public.
// node --test "tracker/dev/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as E from '../engine.js';

const ROOT = path.dirname(fileURLToPath(new URL('../index.html', import.meta.url)));
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const T = (key, name) => E.TEMPLATES[key].ex.find(e => e.n === name);
const W = (kg, reps, rir = null) => ({ kg, reps, rir, warmup: false, state: 'done', doneAt: '2026-09-01T10:00:00Z', via: 'tick', target: null });
const DIR = 'training/log';

/* A pre-v5 file in the 17 Sep pattern: 11 seconds, every set = rec, no RIR. */
const suspect = () => ({
  date: '2026-09-17', key: 'upper-push', name: 'Upper Push', startedAt: '2026-09-17T13:57:09Z', endedAt: '2026-09-17T13:57:20Z',
  exercises: [{ n: 'Overhead press', kind: 'weight', targetSets: 3, rec: { rule: 'R1', kg: 32.5, reps: 6, why: 'w' },
    sets: [1, 2, 3].map(() => ({ kg: 32.5, reps: 6, rir: null, done: false, warmup: false })) }],
  decisions: [{ ex: 'Overhead press', rule: 'R1', recKg: 32.5, actualKg: 32.5, why: 'w', outcome: 'accepted' }]
});

/* ------------------------------------------------ the unverified session */
test('Edit then Save on a suspect session keeps it out of the rules', () => {
  const raw = suspect();
  const d = E.editDraft(raw, DIR);
  assert.equal(E.isStaleDraft(d, Date.parse('2026-09-23T10:00:00Z')), false, 'an edit never gets the Unfinished banner');
  const { session } = E.finishSession(d, '2026-09-23T10:00:00Z');
  assert.equal(session.schemaVersion, 5);
  assert.equal(session.unverified, true);
  assert.equal(E.isSuspectPrefill(session), true);
  assert.equal(E.analysisHistory([session], []).length, 0);
  assert.equal(E.planSave(d, session, [raw], [], DIR, 'x').session.file, DIR + '/2026-09-17-upper-push.json');
  // A second edit of the saved edit still carries the flag.
  const again = E.finishSession(E.editDraft(session, DIR), '2026-09-24T10:00:00Z').session;
  assert.equal(E.analysisHistory([again], []).length, 0);
  // 'It happened as recorded' drops unverified and writes verified:true.
  const { unverified, ...body } = again;
  assert.equal(E.analysisHistory([{ ...body, verified: true }], []).length, 1);
  // Editing a verified session does not mark it unverified again.
  const v = E.finishSession(E.editDraft({ ...raw, verified: true }, DIR), '2026-09-24T10:00:00Z').session;
  assert.ok(!('unverified' in v));
  assert.equal(E.analysisHistory([v], []).length, 1);
});

/* ----------------------------------------------------- phone storage */
const v4blob = () => ({
  settings: { token: 'TEST_TOKEN_NOT_REAL', owner: 'o', repo: 'r', branch: 'main', path: 'training/log' },
  draft: { date: '2026-09-19', key: 'lower-a', name: 'Lower A', exercises: [] },
  queue: [{ date: '2026-09-19', key: 'lower-a', name: 'old copy' }],
  bwQueue: [{ type: 'bw', date: '2026-09-19', kg: 70.1 }],
  history: [{ date: '2026-09-08', key: 'upper-push' }]
});
test('an unreadable ledger_v5 never brings back the frozen v4 queue, bwQueue or draft', () => {
  const store = { ledger_v5: '{"v":5,"settings":{"tok', ledger_v4: JSON.stringify(v4blob()) };
  const r = E.loadState(k => store[k] ?? null);
  assert.equal(r.state.settings.token, 'TEST_TOKEN_NOT_REAL', 'the token is kept');
  assert.deepEqual([r.state.queue, r.state.bwQueue, r.state.history, r.state.draft], [[], [], [], null]);
  assert.equal(r.notice, 'v5-unreadable');
  assert.deepEqual(r.backups, [{ key: 'ledger_v5', raw: store.ledger_v5 }]);
  // First run after the upgrade (no ledger_v5 yet): v4 is migrated in full.
  const first = E.loadState(k => (k === 'ledger_v4' ? store.ledger_v4 : null));
  assert.equal(first.state.queue.length, 1);
  assert.equal(first.notice, null);
  // A readable ledger_v5 wins and v4 is not read at all.
  const ok = E.loadState(k => (k === 'ledger_v5' ? JSON.stringify({ v: 5, settings: { token: 'b' }, queue: [] }) : store[k]));
  assert.deepEqual([ok.state.settings.token, ok.state.queue], ['b', []]);
});

test('a malformed but parseable draft is set aside without losing the token, queue or history', () => {
  for (const draft of [{ exercises: { a: 1 } }, { exercises: [{ n: 'x', kind: 'weight', sets: [null] }] }]) {
    const s = E.migrateState({ ...v4blob(), draft });
    assert.equal(s.settings.token, 'TEST_TOKEN_NOT_REAL');
    assert.equal(s.queue.length, 1); assert.equal(s.history.length, 1);
    assert.equal(s.draft, null);
    const r = E.loadState(k => (k === 'ledger_v4' ? JSON.stringify({ ...v4blob(), draft }) : null));
    assert.equal(r.state.settings.token, 'TEST_TOKEN_NOT_REAL');
    assert.equal(r.notice, 'draft-unreadable');
    assert.deepEqual(r.backups, [{ key: 'draft', raw: JSON.stringify(draft) }]);
    // The same inside ledger_v5.
    const r5 = E.loadState(k => (k === 'ledger_v5' ? JSON.stringify({ v: 5, settings: { token: 't' }, queue: [{ date: 'd', key: 'k' }], draft }) : null));
    assert.deepEqual([r5.state.settings.token, r5.state.queue.length, r5.state.draft, r5.notice], ['t', 1, null, 'draft-unreadable']);
  }
});

/* ------------------------------------------------------- v4 drafts */
test('a set ticked in a v4 draft (done:true) survives migration and "I didn\'t do them"', () => {
  const rec = { rule: 'R2', kg: 75, reps: 5, why: 'w' };
  const s = E.migrateState({ settings: { token: 'x' }, draft: { date: '2026-09-22', key: 'upper-push', name: 'Upper Push', exercises: [
    { n: 'Bench press (heavy)', kind: 'weight', rec, sets: [
      { kg: 75, reps: 5, rir: null, done: true, warmup: false },
      { kg: 75, reps: 5, rir: null, done: true, warmup: false },
      { kg: 75, reps: 5, rir: null, done: true, warmup: false },
      { kg: 75, reps: 5, rir: null, done: false, warmup: false }] }] } });
  const sets = s.draft.exercises[0].sets;
  assert.deepEqual(sets.map(x => [x.state, x.kg]), [['legacy', 75], ['legacy', 75], ['legacy', 75], ['planned', null]]);
  const { session } = E.finishSession(s.draft, '2026-09-22T11:00:00Z', 'drop');
  assert.equal(session.exercises[0].sets.length, 3);
});

test('a v4 draft open at upgrade is re-shaped: Pallof is a band, carries get metres, bodyweight goes to bw-*.json', () => {
  const s = E.migrateState({ settings: { token: 'x' }, bwQueue: [], draft: {
    date: '2026-09-22', key: 'lower-a', name: 'Lower A', startedAt: '2026-09-22T09:00:00Z', bodyweight: 70.3, exercises: [
      { n: 'Pallof press', kind: 'weight', rec: { rule: 'R3', kg: 0, reps: 10, why: 'w' }, sets: [
        { kg: 0, reps: 10, rir: null, done: false, warmup: false }, { kg: 0, reps: 10, rir: null, done: false, warmup: false }] },
      { n: 'Farmer’s carry', kind: 'distance', rec: null, sets: [
        { kg: 24, metres: null, done: true, warmup: false }, { kg: null, metres: null, done: false, warmup: false }] }] } });
  const [pallof, farmer] = s.draft.exercises;
  assert.equal(pallof.kind, 'band'); assert.equal(pallof.rec, null);
  assert.deepEqual(pallof.sets[0].target, { band: null, reps: 10 });
  assert.equal(E.confirmSet(pallof, pallof.sets[0], 'tick', 'x'), false, 'no band on record: ✓ must open the sheet, never log 0 kg');
  assert.equal(farmer.dist, 40);
  assert.equal(farmer.sets[0].state, 'legacy');
  assert.deepEqual(farmer.sets[1].target, { kg: null, metres: 40 });
  assert.ok(!('bodyweight' in s.draft));
  assert.deepEqual(s.bwQueue, [{ type: 'bw', date: '2026-09-22', kg: 70.3, loggedAt: '2026-09-22T09:00:00Z' }]);
  const { session } = E.finishSession(s.draft, '2026-09-22T10:00:00Z', 'drop');
  assert.ok(!('bodyweight' in session));
  assert.ok(!session.decisions.some(x => x.ex === 'Pallof press' && x.outcome === 'accepted'));
});

/* ------------------------------------------------------ editing */
test('✓ on a legacy set while editing cannot un-tick it, so "I didn\'t do them" never deletes history', () => {
  const raw = { date: '2026-09-08', key: 'upper-push', name: 'Upper Push', startedAt: '2026-09-08T10:00:00Z', endedAt: '2026-09-08T11:00:00Z',
    exercises: [{ n: 'Bench press (heavy)', kind: 'weight', targetSets: 4, sets: [1, 2, 3, 4].map(() => ({ kg: 75, reps: 5, rir: 2, done: false, warmup: false })) }], decisions: [] };
  const d = E.editDraft(raw, DIR);
  const st = d.exercises[0].sets[3];
  assert.equal(E.unconfirmSet(st), false);
  assert.equal(st.state, 'legacy');
  const { session } = E.finishSession(d, '2026-09-23T10:00:00Z', 'drop');
  assert.equal(session.exercises[0].sets.length, 4);
  // The page routes a legacy ✓ to the sheet instead of un-ticking it.
  assert.match(html, /if\(st\.state === 'legacy'\)\{ openSetSheet\(i, j\); return; \}/);
});

test('a skipped exercise keeps its note and its shape, so an edit asks for the right fields', () => {
  const d = E.newSession('upper-push', [], '2026-09-23', '2026-09-23T10:00:00Z');
  d.exercises[2].note = 'left shoulder twinge, skipped dips';
  Object.assign(d.exercises[0].sets[0], { kg: 75, reps: 5, rir: 2, state: 'done', via: 'sheet', doneAt: '2026-09-23T10:05:00Z' });
  const { session } = E.finishSession(d, '2026-09-23T11:00:00Z', 'drop');
  const dip = session.exercises.find(e => e.n === 'Weighted dip');
  assert.deepEqual([dip.skipped, dip.note, dip.load, dip.rep, dip.tplRir, dip.inc], [true, 'left shoulder twinge, skipped dips', 'bw+', [6, 8], 2, 2.5]);

  const lo = E.newSession('lower-a', [], '2026-09-25', '2026-09-25T10:00:00Z');
  Object.assign(lo.exercises[0].sets[0], { kg: 80, reps: 5, rir: 2, state: 'done', via: 'sheet', doneAt: '2026-09-25T10:05:00Z' });
  const saved = E.finishSession(lo, '2026-09-25T11:00:00Z', 'drop').session;
  const wheel = E.editDraft(saved, DIR).exercises.find(e => e.n === 'Ab wheel rollout');
  assert.deepEqual(E.fieldsOf(wheel), ['reps']);
  assert.equal(wheel.sets.length, 1);
  assert.ok(!('kg' in wheel.sets[0]));
  const legacyStub = E.editDraft({ date: '2026-09-15', key: 'lower-a', exercises: [{ n: 'Weighted dip', kind: 'weight', rec: null, targetSets: 3, sets: [], skipped: true }] }, DIR);
  assert.equal(legacyStub.exercises[0].load, 'bw+', 'a pre-v5 stub takes its load type from the template');
});

test('an edit is never flagged Unfinished; an unfinished new session older than 12 h is', () => {
  const now = Date.parse('2026-09-23T10:00:00Z');
  const old = { startedAt: '2026-09-17T13:57:09Z' };
  assert.equal(E.isStaleDraft(old, now), true);
  assert.equal(E.isStaleDraft({ ...old, editing: true }, now), false);
  assert.equal(E.isStaleDraft({ startedAt: '2026-09-23T08:00:00Z' }, now), false);
});

test('moving an edited session to a later date keeps its rules and logMode and never reads its own copy', () => {
  const ohp = T('upper-push', 'Overhead press');
  const prior = { schemaVersion: 5, date: '2026-09-22', key: 'upper-push', name: 'Upper Push', isDeload: false, decisions: [],
    exercises: [{ n: ohp.n, kind: 'weight', load: 'kg', targetSets: 3, sets: [W(30, 8, 2), W(30, 8, 2), W(30, 8, 2)] }] };
  const d = E.newSession('upper-push', [prior], '2026-09-29', '2026-09-29T09:00:00Z');
  const ex = d.exercises.find(e => e.n === ohp.n);
  assert.equal(ex.rec.rule, 'R1');
  ex.sets.forEach((s, k) => E.confirmSet(ex, s, 'tick', '2026-09-29T09:' + String(10 + k * 10) + ':00Z'));
  const live = E.finishSession(d, '2026-09-29T10:00:00Z', 'drop').session;
  assert.equal(live.logMode, 'live');
  const saved = E.planSave(d, live, [prior], [], DIR, 'x').session;

  const ed = E.editDraft(saved, DIR);
  ed.date = '2026-09-30';
  E.retarget(ed, E.analysisHistory([prior, saved], []));
  assert.equal(ed.exercises.find(e => e.n === ohp.n).rec.rule, 'R1', 'the rule shown at the time is kept');
  const moved = E.finishSession(ed, '2026-09-30T08:00:00Z', 'drop').session;
  assert.equal(moved.logMode, 'live');
  assert.deepEqual(moved.decisions, live.decisions);
  // Even with the copy in history, a planned set's new target never comes from itself.
  const ed2 = E.editDraft(saved, DIR);
  ed2.exercises.find(e => e.n === ohp.n).sets.push(E.blankSet({ kind: 'weight' }, null));
  ed2.date = '2026-09-30';
  E.retarget(ed2, E.analysisHistory([prior, saved], []));
  assert.deepEqual(ed2.exercises.find(e => e.n === ohp.n).sets[3].target, { kg: 32.5, reps: 6 }, 'from 22 Sep, not from 29 Sep itself');
});

/* ------------------------------------------------------ bands, warm-ups */
test('a band exercise with no band on record records "no-rec", not "accepted"', () => {
  const pallof = T('upper-push', 'Pallof press');
  const legacy = E.migrateSession({ date: '2026-09-17', key: 'upper-push', exercises: [{ n: pallof.n, kind: 'weight', targetSets: 3,
    sets: [1, 2, 3].map(() => ({ kg: null, reps: 10, rir: 2, done: false, warmup: false })) }] });
  const d = E.newSession('upper-push', [legacy], '2026-09-22', '2026-09-22T10:00:00Z');
  const ex = d.exercises.find(e => e.n === pallof.n);
  assert.equal(ex.rec.band, null);
  for (const s of ex.sets) Object.assign(s, { band: 'red+green', reps: 10, rir: 2, state: 'done', via: 'sheet', doneAt: '2026-09-22T10:30:00Z' });
  const dec = E.finishSession(d, '2026-09-22T11:00:00Z', 'drop').session.decisions.find(x => x.ex === pallof.n);
  assert.equal(dec.outcome, 'no-rec');
  assert.equal(dec.actualBand, 'red+green');
});

test('+ Warm-up puts a warm-up row before the working sets, and its ✓ records a warm-up', () => {
  const ohp = T('upper-push', 'Overhead press');
  const prior = { schemaVersion: 5, date: '2026-09-15', key: 'upper-push', decisions: [],
    exercises: [{ n: ohp.n, kind: 'weight', load: 'kg', targetSets: 3, sets: [W(30, 7, 2), W(30, 7, 2), W(30, 6, 2)] }] };
  const d = E.newSession('upper-push', [prior], '2026-09-22', 'x');
  const ex = d.exercises.find(e => e.n === ohp.n);
  ex.sets.splice(E.warmupIndex(ex), 0, E.warmupSet(ex));
  assert.equal(ex.sets[0].warmup, true);
  assert.deepEqual(ex.sets[0].target, { kg: 20, reps: 8, src: 'warmup' }, '50% of 30 is under the bar: the empty bar');
  ex.sets.splice(E.warmupIndex(ex), 0, E.warmupSet(ex));
  assert.equal(E.warmupIndex(ex), 2);
  assert.ok(E.confirmSet(ex, ex.sets[0], 'tick', 'y'));
  assert.equal(E.working(ex).length, 0, 'a warm-up is never a working set');
  assert.equal(ex.sets.filter(s => !s.warmup).length, 3);
});

/* ------------------------------------------------------ the page */
test('set-sheet input values are escaped', () => {
  assert.match(html, /data-f="shval" data-k="' \+ key \+ '" value="' \+ esc\(val \?\? ''\) \+ '"/);
});
test('a page whose module never loads says so instead of staying blank', () => {
  assert.match(html, /<main id="view"><div class="empty" id="bootmsg">[^<]*did not start/);
});
test('the deload banner promises nothing the engine does not do', () => {
  assert.doesNotMatch(html, /resume at 95/);
});
test('the next set\'s ✓, bulk undo, re-rating from Finish and "It happened" are wired', () => {
  for (const act of ['tickNext', 'bulk', 'rateLast', 'verify', 'warm'])
    assert.match(html, new RegExp('data-act="' + act + '"'), act);
  assert.match(html, /toast\(n \+ ' set' [^\n]*, \(\) => \{/, 'All as shown ✓ offers undo');
});

/* ------------------------------------------------------ privacy */
test('no health history ships in the public tracker; the pinch count comes from Settings', () => {
  const pub = readdirSync(ROOT).filter(f => /\.(js|html|md|json)$/.test(f)).map(f => path.join(ROOT, f))
    .concat(readdirSync(path.join(ROOT, 'dev')).map(f => path.join(ROOT, 'dev', f)));
  for (const f of pub) {
    if (f.endsWith('regressions.test.mjs')) continue;
    assert.doesNotMatch(readFileSync(f, 'utf8'), /30 Aug is unresolved|lumbar|two are on record|PRIOR_PINCHES|two one-sided/i, f);
  }
  assert.equal(E.DEFAULTS.settings.priorPinches, null);
  const pinch = { schemaVersion: 5, date: '2026-09-15', key: 'lower-b', symptoms: [{ area: 'low-back', type: 'pinch', side: 'L' }] };
  assert.deepEqual(E.pinchCount(null, []), { inApp: 1, total: null, physio: false });
  assert.deepEqual(E.pinchCount(2, []), { inApp: 1, total: 3, physio: true });
  assert.deepEqual(E.pinchCount(0, [pinch]), { inApp: 2, total: 2, physio: false });
  assert.equal(E.normaliseState({ v: 5, settings: { priorPinches: 2 } }).settings.priorPinches, 2);
});

/* ------------------------------------------------------ contrast */
test('light-mode small text on chips passes WCAG AA (4.5:1)', () => {
  const root = html.match(/:root\{([\s\S]*?)\}/)[1];
  const v = n => root.match(new RegExp('--' + n + ':(#[0-9a-f]{6})'))[1];
  const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mix = (fg, a, bg) => '#' + [1, 3, 5].map(i => Math.round(parseInt(fg.substr(i, 2), 16) * a + parseInt(bg.substr(i, 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('');
  for (const fg of ['dim', 'warn', 'ok', 'bad']) assert.ok(cr(v(fg), v('chip')) >= 4.5, fg + ' on chip: ' + cr(v(fg), v('chip')).toFixed(2));
  assert.ok(cr(v('warn'), mix('#b8860b', 0.15, '#ffffff')) >= 4.5, 'amber date chip');
});
