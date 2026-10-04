// The winter strength plan (2026-10-05 block): templates, legacy sessions, the
// pre-session block, phases, week-1 calibration, deloads. Plain Node.
// Fixtures are synthetic; the real files are read from training/log at test
// time and never copied here (tracker/ is published).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as E from '../engine.js';

const W = (kg, reps, rir = null, more = {}) => ({ kg, reps, rir, warmup: false, state: 'done', doneAt: '2026-10-06T10:00:00Z', via: 'tick', target: null, ...more });
const X = (n, sets, more = {}) => ({ n, kind: 'weight', load: 'kg', targetSets: sets.length, sets, ...more });
const S5 = (date, key, exercises, more = {}) => ({ schemaVersion: 5, date, key, name: key, isDeload: false, exercises, decisions: [], ...more });
const hist = (...s) => s.sort((a, b) => (a.date < b.date ? 1 : -1));
const ex = (s, n) => s.exercises.find(e => e.n === n);
const NEW = ['d1', 'd2', 'd3', 'd4'], LEGACY = ['upper-push', 'lower-a', 'lower-b', 'upper-pull', 'floor'];

/* ------------------------------------------------------------ templates */
test('the four new sessions exist, in order, on Tue / Thu / Sat / Sun, and are not legacy', () => {
  assert.deepEqual(E.weekPlan([], '2026-10-06').map(p => [p.key, p.day]), [['d1', 'Tue'], ['d2', 'Thu'], ['d3', 'Sat'], ['d4', 'Sun']]);
  for (const k of NEW) assert.ok(!E.TEMPLATES[k].legacy, k);
  assert.equal(E.TEMPLATES.d1.name.split(' — ')[0], 'Day 1');
  assert.deepEqual(['d1', 'd2', 'd3', 'd4'].map(k => E.TEMPLATES[k].pre), ['lower', 'lower', 'lower', 'upper']);
});

test('new templates carry the spec’s exercises, sets, reps, RIR, increments and rests', () => {
  const want = {
    d1: [['High-bar back squat (volume)', 3, [8, 8], 2, 2.5, 180], ['Bench press (volume)', 3, [8, 8], 2, 2.5, 150], ['Chin-up', 3, [5, 8], 2, 2.5, 150],
         ['Single-arm DB row', 3, [10, 10], 2, 2, 120], ['Hammer curl', 3, [10, 10], 1, 2, 75], ['Seated compression lift-offs', 3, [5, 5]]],
    d2: [['Bench press (heavy)', 3, [5, 5], 2, 2.5, 180], ['Trap-bar / conventional DL', 3, [5, 5], 2, 2.5, 210], ['Weighted dip', 3, [6, 8], 2, 2.5, 150],
         ['Overhead triceps extension', 3, [12, 12], 1, 2, 75], ['Hip thrust (paused top)', 3, [8, 12], 2, 5, 120], ['L-sit tuck-to-extend', 3, [8, 10]]],
    d3: [['High-bar back squat', 3, [5, 5], 2, 2.5, 210], ['Overhead press', 3, [5, 5], 2, 2.5, 150], ['Pull-up grease-the-groove', 3, [3, 3]], ['Bulgarian split squat', 3, [8, 8], 2, 2, 120],
         ['Curl (superset)', 3, [10, 12], 1, 2], ['Triceps pushdown (superset)', 3, [10, 12], 1, 2.5, 75], ['Hanging knee/leg raise', 3, [8, 12], 1, 2, 90]],
    d4: [['Pull-up max test (strict)', 1], ['Pull-up (EMOM 10×3)', 1, [30, 30]], ['Dumbbell bench press', 3, [8, 10], 2, 2, 120], ['Single-arm DB row', 4, [10, 10], 2, 2, 90],
         ['Seated incline curl', 3, [12, 12], 1, 2, 75], ['Triceps (cable or skull crusher)', 3, [12, 12], 1, 2.5, 75], ['Dead hang', 2]]
  };
  for (const [k, list] of Object.entries(want)) {
    assert.deepEqual(E.TEMPLATES[k].ex.map(e => e.n), list.map(x => x[0]), k);
    list.forEach(([n, sets, rep, rir, inc, rest], i) => {
      const e = E.TEMPLATES[k].ex[i];
      assert.equal(e.sets, sets, n);
      if (rep) assert.deepEqual(e.rep, rep, n);
      if (rir != null) assert.equal(e.rir, rir, n);
      if (inc != null) assert.equal(e.inc, inc, n);
      if (rest != null) assert.equal(e.rest, rest, n);
    });
  }
});

test('every new exercise is well-formed and nothing from the old plan leaks in', () => {
  const kinds = ['weight', 'band', 'reps', 'time', 'distance', 'rounds'];
  const banned = /pallof|mcgill|ab wheel|farmer|suitcase|face pull/i;
  for (const k of NEW) for (const e of E.TEMPLATES[k].ex) {
    assert.ok(kinds.includes(e.kind), e.n);
    assert.ok(e.sets >= 1, e.n);
    assert.doesNotMatch(e.n, banned, e.n);
    assert.doesNotMatch(e.note || '', /hold, don.t chase/i, e.n);
    assert.equal(e.hold, undefined, e.n + ': the bench hold rule is removed');
    if (e.kind === 'weight') { assert.ok(e.rep && e.rep.length === 2 && e.rep[0] <= e.rep[1], e.n); assert.ok(e.rir != null && e.inc > 0 && e.rest >= 0, e.n); }
    if (e.kind !== 'weight' && e.kind !== 'time' && e.kind !== 'rounds' && e.rep) assert.ok(e.rep[0] <= e.rep[1], e.n);
  }
  const names = k => E.TEMPLATES[k].ex.map(e => e.n);
  assert.ok(names('d2').includes('Trap-bar / conventional DL') && /one-sided pinch/.test(E.TEMPLATES.d2.ex[1].note), 'the deadlift slot keeps its pinch-stop note');
  assert.equal(E.TEMPLATES.d2.ex[1].rir, 2, 'deadlift variant at RIR 2 or more');
  assert.ok(!E.TEMPLATES.d3.ex.some(e => e.hold) && E.TEMPLATES.d3.ex[0].n === 'High-bar back squat');
});

test('exercises that are the same lift as before keep their names, so history carries', () => {
  const all = new Set(NEW.flatMap(k => E.TEMPLATES[k].ex.map(e => e.n)));
  for (const n of ['Bench press (heavy)', 'Overhead press', 'Weighted dip', 'High-bar back squat', 'Bulgarian split squat', 'Single-arm DB row', 'Hammer curl', 'Chin-up',
    'Hanging knee/leg raise', 'Trap-bar / conventional DL', 'Dead hang', 'Pull-up (EMOM 10×3)']) assert.ok(all.has(n), n);
  for (const n of ['Hip thrust (paused top)', 'Overhead triceps extension', 'Triceps pushdown (superset)', 'Curl (superset)', 'Dumbbell bench press', 'Pull-up grease-the-groove',
    'Seated compression lift-offs', 'L-sit tuck-to-extend', 'Triceps (cable or skull crusher)']) assert.ok(all.has(n), n + ' new');
});

test('the new incline curl does not collide with the "Incline DB curl" alias of the preacher curl', () => {
  assert.deepEqual(E.ALIASES, { 'Preacher curl (one DB, two hands)': ['Incline DB curl'] });
  const old = S5('2026-09-17', 'upper-push', [X('Incline DB curl', [W(20, 11, 1), W(20, 11, 1), W(20, 11, 1)])]);
  assert.equal(E.lastFor('Seated incline curl', [old], '2026-10-11'), null);
  assert.equal(E.lastFor('Preacher curl (one DB, two hands)', [old], '2026-10-11').date, '2026-09-17');
  assert.ok(!E.sameEx('Incline DB curl', 'Seated incline curl'));
});

test('volume and heavy versions of a lift keep separate histories', () => {
  const h = hist(S5('2026-10-08', 'd2', [X('Bench press (heavy)', [W(80, 5, 2)])]));
  assert.equal(E.lastFor('Bench press (volume)', h, '2026-10-13'), null);
  assert.equal(E.lastFor('High-bar back squat (volume)', hist(S5('2026-10-10', 'd3', [X('High-bar back squat', [W(90, 5, 2)])])), '2026-10-13'), null);
});

/* --------------------------------------------------------------- legacy */
test('legacy keys still resolve, are never offered, and never count as one of the new four', () => {
  for (const k of LEGACY) { assert.ok(E.TEMPLATES[k], k); assert.equal(E.isLegacyKey(k), true, k); assert.ok(E.TEMPLATES[k].name, k); }
  for (const k of [...NEW, 'skill', 'custom']) assert.equal(E.isLegacyKey(k), false, k);
  for (const k of LEGACY) assert.doesNotThrow(() => E.newSession(k, [], '2026-09-29', 'x'), k);
  for (const d of ['2026-09-29', '2026-10-06', '2026-10-13']) assert.ok(E.weekPlan([], d).every(p => NEW.includes(p.key)), d);
  const plan = E.weekPlan([S5('2026-10-06', 'upper-push', []), S5('2026-10-08', 'lower-a', [])], '2026-10-09');
  assert.ok(plan.every(p => p.state !== 'done'), 'a legacy session in the block week does not tick a new day');
});

test('legacy lift sessions before the block start count for their own weeks; in or after it they do not', () => {
  const h = [S5('2026-09-27', 'lower-a', []), S5('2026-09-25', 'lower-b', []), S5('2026-10-06', 'upper-push', []), S5('2026-10-08', 'd2', [])];
  assert.equal(E.sessionsInWeek(h, '2026-09-21').length, 2);
  assert.deepEqual(E.sessionsInWeek(h, '2026-10-05').map(s => s.key), ['d2']);
});

test('legacy sessions keep their old tpl rules when edited (hold stays with upper-push only)', () => {
  const e = { n: 'Bench press (heavy)', kind: 'weight', rep: [5, 5], tplRir: 2, inc: 2.5 };
  assert.equal(E.tplOf(e, 'upper-push').hold, true);
  assert.equal(E.tplOf(e, 'd2').hold, false);
  assert.equal(E.tplOf(e, 'd2').heavy, true);
  assert.equal(!!E.tplOf(e, 'upper-push').heavy, false);
});

const LOG = fileURLToPath(new URL('../../training/log/', import.meta.url));
test('the real session files load, list in History, keep their names and read as last time', t => {
  if (!existsSync(LOG)) { t.skip('training/log not present'); return; }
  const files = readdirSync(LOG).filter(f => /^\d{4}-\d{2}-\d{2}-.+\.json$/.test(f));
  assert.ok(files.length >= 7, 'the seven sessions logged 2026-09-08 to 09-27');
  const raw = files.map(f => JSON.parse(readFileSync(path.join(LOG, f), 'utf8')));
  const merged = E.mergedHistory(raw, []);
  assert.equal(merged.length, files.length, 'History lists every file');
  for (const s of merged) { assert.ok(s.name && s.date && s.key, s.date); assert.ok(E.TEMPLATES[s.key], 'key ' + s.key + ' resolves'); }
  for (const k of ['upper-push', 'lower-a', 'lower-b', 'upper-pull', 'floor']) assert.ok(merged.some(s => s.key === k), k + ' is in the log');
  assert.ok(merged.filter(s => E.isLegacyKey(s.key)).length === merged.length, 'every real file is a legacy-key session');
  const aH = E.analysisHistory(raw, []);
  // History carries: the new Day 3 squat, Day 2 deadlift and Day 4 chin-up read their September sessions as last time.
  assert.ok(E.lastFor('High-bar back squat', aH, '2026-10-10'));
  assert.ok(E.lastFor('Trap-bar / conventional DL', aH, '2026-10-08'));
  assert.ok(E.lastFor('Chin-up', aH, '2026-10-06'));
  // The new plan still builds from them with no throw, and none of the September files are in the block.
  for (const k of NEW) assert.doesNotThrow(() => E.newSession(k, aH, '2026-10-06', 'x'), k);
  assert.ok(E.sessionsInWeek(aH, '2026-10-05').length === 0);
  // Week 1 is a calibration: the September weights are NOT used as a target for the main lifts.
  const d3 = E.newSession('d3', aH, '2026-10-10', 'x');
  assert.equal(ex(d3, 'High-bar back squat').sets[0].target.kg, null);
});

/* ---------------------------------------------------------------- phases */
test('block week and phase derive from the date', () => {
  const at = d => { const b = E.blockInfo(d); return b && [b.week, b.phase, b.deload]; };
  assert.equal(E.blockInfo('2026-10-04'), null, 'the day before the block');
  assert.deepEqual(at('2026-10-05'), [1, 1, false]);
  assert.deepEqual(at('2026-10-11'), [1, 1, false]);
  assert.deepEqual(at('2026-10-12'), [2, 1, false]);
  assert.deepEqual(at('2026-11-08'), [5, 1, false]);
  assert.deepEqual(at('2026-11-09'), [6, 1, true], 'week 6 deload starts 11-09');
  assert.deepEqual(at('2026-11-15'), [6, 1, true]);
  assert.deepEqual(at('2026-11-16'), [7, 2, false], 'phase 2 starts 11-16');
  assert.deepEqual(at('2026-12-20'), [11, 2, false]);
  assert.deepEqual(at('2026-12-21'), [12, 2, true], 'week 12 deload starts 12-21');
  assert.deepEqual(at('2026-12-27'), [12, 2, true]);
  assert.deepEqual(at('2026-12-28'), [13, 3, false], 'phase 3 starts 12-28');
  assert.deepEqual(at('2027-01-31'), [17, 3, false]);
  assert.deepEqual(at('2027-02-01'), [18, 3, true], 'week 18 deload starts 02-01');
  assert.deepEqual(at('2027-02-07'), [18, 3, true]);
  assert.deepEqual(at('2027-02-08'), [19, 4, false], 'phase 4 starts 02-08');
  assert.deepEqual(at('2027-02-21'), [20, 4, false]);
  assert.equal(E.blockInfo('2027-02-22').over, true);
  assert.equal(E.blockInfo('2027-02-22').phase, null);
  assert.equal(E.PHASES.length, 4);
  assert.equal(E.BLOCK.start, '2026-10-05');
});

test('a session started in the block records blockWeek and phase; before it, neither; the schema is unchanged', () => {
  assert.equal(E.SCHEMA_VERSION, 5);
  assert.equal(E.APP_VERSION, 'v5');
  const s = E.newSession('d1', [], '2026-11-17', '2026-11-17T09:00:00Z');
  assert.deepEqual([s.blockWeek, s.phase, s.schemaVersion], [7, 2, 5]);
  const old = E.newSession('lower-a', [], '2026-09-29', 'x');
  assert.ok(!('blockWeek' in old) && !('phase' in old));
  s.exercises = [];
  s.notes = 'x';
  const fin = E.finishSession(s, '2026-11-17T10:00:00Z');
  assert.equal(fin.session.blockWeek, 7);
  // editing a September session and saving it adds nothing
  const sep = S5('2026-09-27', 'lower-a', [X('High-bar back squat', [W(75, 5, 4)])], { name: 'Lower A — squat', week: '2026-09-21' });
  const out = E.finishSession(E.editDraft(sep, 'training/log'), '2026-10-04T10:00:00Z').session;
  assert.ok(!('blockWeek' in out) && !('phase' in out));
});

/* -------------------------------------------------------- week-1 ramp */
test('week 1: main lifts have no kg target, one top set at RIR 2, and ✓ opens the sheet', () => {
  const sept = hist(S5('2026-09-27', 'lower-a', [X('High-bar back squat', [W(75, 5, 4), W(75, 5, 4), W(75, 5, 4), W(75, 5, 4)])]),
    S5('2026-09-08', 'upper-push', [X('Bench press (heavy)', [W(75, 5, 1.5), W(75, 5, 1.5)]), X('Overhead press', [W(32.5, 6, 2)])]));
  const expect = [['d1', 'High-bar back squat (volume)', 8], ['d1', 'Bench press (volume)', 8], ['d2', 'Bench press (heavy)', 5],
    ['d2', 'Trap-bar / conventional DL', 5], ['d3', 'High-bar back squat', 5], ['d3', 'Overhead press', 5]];
  for (const [k, n, reps] of expect) {
    const s = E.newSession(k, sept, '2026-10-08', 'x'), e = ex(s, n);
    assert.equal(e.cal, 'ramp', n);
    assert.equal(e.sets.length, 1, n + ': one top set');
    assert.equal(e.targetSets, 1, n);
    assert.deepEqual(e.sets[0].target, { kg: null, reps }, n + ': reps, never a kg');
    assert.equal(E.canConfirm(e, e.sets[0]), false, n + ': ✓ cannot invent a weight');
    assert.equal(e.rec, null, n + ': no recommendation, so no decision');
    assert.equal(e.tplRir, 2, n);
    assert.match(e.tplNote, /^Calibration: work up to ONE top set of \d at RIR 2/, n);
  }
  // accessories are untouched by the ramp
  const d2 = E.newSession('d2', sept, '2026-10-08', 'x');
  assert.equal(ex(d2, 'Weighted dip').sets.length, 3);
  assert.equal(ex(d2, 'Weighted dip').cal, undefined);
  // ✓ opens the sheet; Save with a weight records it, and finishing makes no decision for the ramp
  const bench = ex(d2, 'Bench press (heavy)');
  Object.assign(bench.sets[0], { kg: 80, reps: 5, rir: 2 });
  E.confirmSet(bench, bench.sets[0], 'sheet', '2026-10-08T10:00:00Z');
  assert.equal(E.rirIdx(bench), 0);
  for (const e of d2.exercises) if (e !== bench) e.sets = [];
  const r = E.finishSession(d2, '2026-10-08T10:30:00Z');
  assert.equal(r.session.decisions.length, 0);
  assert.equal(r.session.exercises.find(e => e.n === 'Bench press (heavy)').cal, 'ramp');
});

test('week 1 also adds the strict pull-up max test on Day 4, and only then', () => {
  assert.ok(ex(E.newSession('d4', [], '2026-10-11', 'x'), 'Pull-up max test (strict)'));
  assert.equal(ex(E.newSession('d4', [], '2026-10-18', 'x'), 'Pull-up max test (strict)'), undefined);
  const t = ex(E.newSession('d4', [], '2026-10-11', 'x'), 'Pull-up max test (strict)');
  assert.equal(t.sets[0].target, null, 'no invented number');
});

test('week 2 starts from the week-1 top set: the ramp weight, no increase', () => {
  const ramp = hist(
    S5('2026-10-06', 'd1', [X('High-bar back squat (volume)', [W(90, 8, 2)], { cal: 'ramp' }), X('Bench press (volume)', [W(70, 8, 2)], { cal: 'ramp' })]),
    S5('2026-10-08', 'd2', [X('Bench press (heavy)', [W(77.5, 5, 2)], { cal: 'ramp' }), X('Trap-bar / conventional DL', [W(105, 5, 2)], { cal: 'ramp' })]),
    S5('2026-10-10', 'd3', [X('High-bar back squat', [W(95, 5, 2)], { cal: 'ramp' }), X('Overhead press', [W(32.5, 5, 2)], { cal: 'ramp' })]));
  const s1 = E.newSession('d1', ramp, '2026-10-13', 'x'), s2 = E.newSession('d2', ramp, '2026-10-15', 'x'), s3 = E.newSession('d3', ramp, '2026-10-17', 'x');
  const chk = (s, n, kg, reps) => {
    const e = ex(s, n);
    assert.equal(e.rec.rule, 'RC', n);
    assert.deepEqual(e.sets.map(x => x.target), [{ kg, reps }, { kg, reps }, { kg, reps }], n);
    assert.equal(e.cal, undefined, n);
  };
  chk(s1, 'High-bar back squat (volume)', 90, 8); chk(s1, 'Bench press (volume)', 70, 8);
  chk(s2, 'Bench press (heavy)', 77.5, 5); chk(s2, 'Trap-bar / conventional DL', 105, 5);
  chk(s3, 'High-bar back squat', 95, 5); chk(s3, 'Overhead press', 32.5, 5);
  assert.equal(E.newSession('d2', ramp, '2026-10-15', 'x').key, 'd2');
});

test('phase 1 heavy days progress +2.5 when every set is clean at RIR 2, and hold otherwise', () => {
  const wk2 = hist(S5('2026-10-15', 'd2', [X('Bench press (heavy)', [W(77.5, 5, 2), W(77.5, 5, 2), W(77.5, 5, 2)])]));
  const up = ex(E.newSession('d2', wk2, '2026-10-22', 'x'), 'Bench press (heavy)');
  assert.deepEqual([up.rec.rule, up.sets[0].target.kg], ['R1', 80]);
  assert.equal(up.sets.length, 3);
  const hard = hist(S5('2026-10-15', 'd2', [X('Bench press (heavy)', [W(77.5, 5, 2), W(77.5, 5, 2), W(77.5, 5, 1)])]));
  assert.equal(ex(E.newSession('d2', hard, '2026-10-22', 'x'), 'Bench press (heavy)').rec.rule, 'R2');
});

test('a lift not done in week 1 is still a ramp the first time it appears in the block', () => {
  const sept = hist(S5('2026-09-27', 'lower-a', [X('High-bar back squat', [W(75, 5, 4)])]));
  const s = E.newSession('d3', sept, '2026-10-17', 'x');
  assert.equal(ex(s, 'High-bar back squat').cal, 'ramp');
  assert.equal(ex(s, 'High-bar back squat').sets[0].target.kg, null);
});

/* --------------------------------------------------- phases 2, 3 and 4 */
const p1 = hist(S5('2026-11-12', 'd2', [X('Bench press (heavy)', [W(80, 5, 2), W(80, 5, 2), W(80, 5, 2)]), X('Trap-bar / conventional DL', [W(110, 5, 2), W(110, 5, 2), W(110, 5, 2)])]),
  S5('2026-11-14', 'd3', [X('High-bar back squat', [W(100, 5, 2), W(100, 5, 2), W(100, 5, 2)])]));

test('phase 2: 3×4, one top set at RIR 1, two back-offs at −7%; the deadlift variant stays at RIR 2', () => {
  const s = E.newSession('d2', p1, '2026-11-19', 'x');
  const b = ex(s, 'Bench press (heavy)');
  assert.equal(b.rec.rule, 'RP');
  assert.deepEqual(b.sets.map(x => x.target), [{ kg: 80, reps: 4 }, { kg: 75, reps: 4 }, { kg: 75, reps: 4 }]);
  assert.deepEqual([b.rep, b.tplRir, b.backoff], [[4, 4], 1, 0.07]);
  const dl = ex(s, 'Trap-bar / conventional DL');
  assert.deepEqual(dl.sets.map(x => x.target.kg), [110, 102.5, 102.5]);
  assert.equal(dl.tplRir, 2);
  const sq = ex(E.newSession('d3', p1, '2026-11-21', 'x'), 'High-bar back squat');
  assert.deepEqual(sq.sets.map(x => x.target), [{ kg: 100, reps: 4 }, { kg: 92.5, reps: 4 }, { kg: 92.5, reps: 4 }]);
});

test('phase 2 steady state: only the top set is judged, by its own RIR', () => {
  const done = S5('2026-11-19', 'd2', [X('Bench press (heavy)', [W(80, 4, 1), W(75, 4, 3), W(75, 4, 3)], { backoff: 0.07, rep: [4, 4], tplRir: 1 })]);
  const up = ex(E.newSession('d2', hist(done), '2026-11-26', 'x'), 'Bench press (heavy)');
  assert.deepEqual([up.rec.rule, up.rec.kg, up.sets[0].target.kg, up.sets[1].target.kg], ['R1', 82.5, 82.5, 77.5]);
  const grind = S5('2026-11-19', 'd2', [X('Bench press (heavy)', [W(80, 4, 0), W(75, 4, 3), W(75, 4, 3)], { backoff: 0.07, rep: [4, 4], tplRir: 1 })]);
  assert.equal(ex(E.newSession('d2', hist(grind), '2026-11-26', 'x'), 'Bench press (heavy)').rec.rule, 'R2', 'easy back-offs do not hide a grindy top set');
  const unrated = S5('2026-11-19', 'd2', [X('Bench press (heavy)', [W(80, 4, null), W(75, 4, 3), W(75, 4, 3)], { backoff: 0.07, rep: [4, 4], tplRir: 1 })]);
  assert.equal(ex(E.newSession('d2', hist(unrated), '2026-11-26', 'x'), 'Bench press (heavy)').rec.rule, 'RN');
  assert.equal(E.rirRef(unrated.exercises[0]), null);
  assert.equal(E.rirRef(done.exercises[0]), 1);
});

test('changing the top set in the sheet re-targets the back-offs at the same percentage', () => {
  const b = ex(E.newSession('d2', p1, '2026-11-19', 'x'), 'Bench press (heavy)');
  Object.assign(b.sets[0], { kg: 82.5, reps: 4, rir: 1 });
  E.confirmSet(b, b.sets[0], 'sheet', 'now');
  E.carryForward(b, 0);
  assert.deepEqual(b.sets.slice(1).map(s => s.target), [{ kg: 77.5, reps: 4, src: 'carried' }, { kg: 77.5, reps: 4, src: 'carried' }]);
});

test('phase 3: 3×3, top set at RIR 1, back-offs −10%', () => {
  const p2 = hist(S5('2026-12-17', 'd2', [X('Bench press (heavy)', [W(85, 4, 1), W(80, 4, 3), W(80, 4, 3)], { backoff: 0.07, rep: [4, 4], tplRir: 1 })]));
  const s = E.newSession('d2', p2, '2026-12-29', 'x');
  const b = ex(s, 'Bench press (heavy)');
  assert.equal(b.rec.rule, 'RP');
  assert.deepEqual(b.sets.map(x => x.target), [{ kg: 85, reps: 3 }, { kg: 77.5, reps: 3 }, { kg: 77.5, reps: 3 }]);
  assert.deepEqual([b.rep, b.backoff], [[3, 3], 0.1]);
});

test('phase 4: heavy lifts have no kg target; week 19 triples, week 20 a single on bench and squat, a triple on the deadlift', () => {
  const w19 = E.newSession('d2', p1, '2027-02-11', 'x'), w20 = E.newSession('d2', p1, '2027-02-18', 'x');
  assert.equal(ex(w19, 'Bench press (heavy)').cal, 'test');
  assert.deepEqual(ex(w19, 'Bench press (heavy)').sets.map(s => s.target), [{ kg: null, reps: 3 }, { kg: null, reps: 3 }, { kg: null, reps: 3 }]);
  assert.deepEqual(ex(w20, 'Bench press (heavy)').sets.map(s => s.target), [{ kg: null, reps: 1 }]);
  assert.equal(ex(w20, 'Trap-bar / conventional DL').sets.length, 3);
  assert.equal(ex(w20, 'Trap-bar / conventional DL').sets[0].target.reps, 3);
  assert.deepEqual(ex(E.newSession('d3', p1, '2027-02-20', 'x'), 'High-bar back squat').sets.map(s => s.target), [{ kg: null, reps: 1 }]);
});

test('week 20 halves the sets of the volume days, not the heavy days', () => {
  const v = E.newSession('d1', p1, '2027-02-16', 'x');
  assert.deepEqual([ex(v, 'Chin-up').sets.length, ex(v, 'Hammer curl').sets.length], [2, 2]);
  assert.equal(ex(E.newSession('d1', p1, '2027-02-09', 'x'), 'Chin-up').sets.length, 3, 'week 19 is full');
  assert.equal(ex(E.newSession('d4', p1, '2027-02-21', 'x'), 'Single-arm DB row').sets.length, 2);
  assert.equal(ex(E.newSession('d3', p1, '2027-02-20', 'x'), 'Bulgarian split squat').sets.length, 3);
});

test('a date change inside the block re-targets the same session for its new phase', () => {
  const d = E.newSession('d2', p1, '2026-11-19', 'x');
  d.date = '2026-11-13';
  E.retarget(d, p1);
  const b = ex(d, 'Bench press (heavy)');
  assert.equal(b.rec.rule, 'R1', 'back in phase 1: clean 3×5 at 80 goes to 82.5, no back-offs');
  assert.equal(b.backoff, undefined);
  assert.deepEqual(b.sets.map(s => s.target), [{ kg: 82.5, reps: 5 }, { kg: 82.5, reps: 5 }, { kg: 82.5, reps: 5 }]);
  d.date = '2026-11-19';
  E.retarget(d, p1);
  assert.equal(ex(d, 'Bench press (heavy)').rec.rule, 'RP');
  assert.equal(ex(d, 'Bench press (heavy)').sets[1].target.kg, 75);
});

/* ----------------------------------------------------------------- deload */
const SETTINGS = { ...E.DEFAULTS.settings };
test('scheduled deloads fire in block weeks 6, 12 and 18 and only then', () => {
  const fire = d => E.deloadCheck([], [], SETTINGS, d).fire;
  for (const d of ['2026-11-09', '2026-11-12', '2026-11-15', '2026-12-21', '2026-12-24', '2026-12-27', '2027-02-01', '2027-02-04', '2027-02-07']) assert.equal(fire(d), true, d);
  for (const d of ['2026-10-05', '2026-10-12', '2026-11-08', '2026-11-16', '2026-12-20', '2026-12-28', '2027-01-31', '2027-02-08', '2027-02-21', '2027-03-15']) assert.equal(fire(d), false, d);
  assert.equal(E.deloadCheck([], [], SETTINGS, '2026-11-09').codes[0].c, 'BLOCK');
});

test('no spurious deload around 2026-10-12: the old every-5-weeks cadence is gone inside the block', () => {
  const sept = [S5('2026-09-27', 'lower-a', []), S5('2026-09-25', 'lower-b', []), S5('2026-09-24', 'upper-pull', []), S5('2026-09-17', 'upper-push', []), S5('2026-09-15', 'lower-a', []), S5('2026-09-08', 'upper-push', [])];
  for (const d of ['2026-10-05', '2026-10-12', '2026-10-13', '2026-10-15', '2026-10-18']) {
    for (const weeks of [4, 5]) {
      const r = E.deloadCheck(sept, [], { ...SETTINGS, deloadWeeks: weeks }, d);
      assert.equal(r.fire, false, d + ' deloadWeeks ' + weeks);
      assert.ok(!r.codes.some(c => c.c === 'CADENCE'), d);
    }
  }
  const s = E.newSession('d1', sept, '2026-10-13', 'x', E.deloadCheck(sept, [], SETTINGS, '2026-10-13').fire);
  assert.equal(s.isDeload, false);
});

test('a block-deload week: every one of the four sessions starts as a deload, at 65%, with half the accessory sets', () => {
  const h = hist(S5('2026-11-05', 'd2', [X('Bench press (heavy)', [W(80, 5, 2), W(80, 5, 2), W(80, 5, 2)]), X('Trap-bar / conventional DL', [W(110, 5, 2), W(110, 5, 2), W(110, 5, 2)])]),
    S5('2026-11-07', 'd3', [X('High-bar back squat', [W(100, 5, 2), W(100, 5, 2), W(100, 5, 2)])]), S5('2026-11-06', 'd1', [X('High-bar back squat (volume)', [W(90, 8, 2), W(90, 8, 2), W(90, 8, 2)]), X('Chin-up', [W(0, 8, 2)], { load: 'bw+' })]));
  const fire = E.deloadCheck(h, [], SETTINGS, '2026-11-10').fire;
  assert.equal(fire, true);
  for (const k of NEW) {
    const s = E.newSession(k, h, '2026-11-10', 'x', fire);
    assert.equal(s.isDeload, true, k);
  }
  const d2 = E.newSession('d2', h, '2026-11-12', 'x', true);
  const b = ex(d2, 'Bench press (heavy)');
  assert.deepEqual([b.rec.rule, b.sets[0].target.kg, b.sets[0].target.reps, b.sets.length], ['R6', 52.5, 5, 3]);
  assert.equal(b.backoff, undefined, 'no back-offs in a deload');
  assert.equal(ex(d2, 'Trap-bar / conventional DL').sets.length, 3, 'main lifts keep their sets');
  assert.equal(ex(d2, 'Weighted dip').sets.length, 2);
  assert.equal(ex(d2, 'Overhead triceps extension').sets.length, 2);
  assert.equal(ex(d2, 'Hip thrust (paused top)').sets.length, 2);
  // pre-session block unchanged
  assert.equal(ex(d2, 'Couch stretch').sets.length, 2);
  // and the deload is not "last time": the week after reads the last normal session
  const after = hist(S5('2026-11-12', 'd2', [X('Bench press (heavy)', [W(52.5, 5, 4)])], { isDeload: true }), ...h);
  assert.equal(E.lastFor('Bench press (heavy)', after, '2026-11-19').ex.sets[0].kg, 80);
});

test('the manual ⋯ → Deload session still works, in or out of a deload week', () => {
  const h = hist(S5('2026-10-15', 'd2', [X('Bench press (heavy)', [W(77.5, 5, 2), W(77.5, 5, 2), W(77.5, 5, 2)])]));
  const d = E.newSession('d2', h, '2026-10-22', 'x');
  assert.equal(d.isDeload, false);
  assert.equal(ex(d, 'Bench press (heavy)').sets[0].target.kg, 80);
  d.isDeload = true; E.retarget(d, h);
  assert.deepEqual([ex(d, 'Bench press (heavy)').rec.rule, ex(d, 'Bench press (heavy)').sets[0].target.kg], ['R6', 50]);
  d.isDeload = false; E.retarget(d, h);
  assert.equal(ex(d, 'Bench press (heavy)').sets[0].target.kg, 80);
});

test('the strength phase turns the bodyweight trigger D6 on, and an old phone setting of cut migrates once', () => {
  assert.equal(E.DEFAULTS.settings.phase, 'strength');
  const bw = []; for (let i = 0; i < 4; i++) { bw.push({ type: 'bw', date: '2026-10-' + String(14 + i).padStart(2, '0'), kg: 72 }); bw.push({ type: 'bw', date: '2026-10-' + String(21 + i).padStart(2, '0'), kg: 70 }); }
  const codes = phase => E.deloadCheck([], bw, { ...SETTINGS, phase }, '2026-10-26').codes.map(c => c.c);
  assert.ok(codes('strength').includes('D6'));
  assert.ok(!codes('cut').includes('D6'), 'a deliberate cut still turns it off');
  const old = E.normaliseState({ v: 5, settings: { token: 't', phase: 'cut', deloadWeeks: 5 } });
  assert.equal(old.settings.phase, 'strength');
  assert.equal(old.settings.token, 't');
  assert.equal(old.settings.planV, 2);
  const chosen = E.normaliseState(JSON.parse(JSON.stringify(old)));
  chosen.settings.phase = 'cut';
  assert.equal(E.normaliseState(JSON.parse(JSON.stringify(chosen))).settings.phase, 'cut', 'after the one-time migration the setting is Dan’s');
  assert.equal(E.migrateState({ settings: { phase: 'cut' } }).settings.phase, 'strength');
});

/* ---------------------------------------------------- pre-session block */
test('every lift opens with the pre-session block: routines first, no rec, tagged pre-*', () => {
  const lower = ['Couch stretch', 'Deep squat hold', 'Knee-to-wall ankle stretch', 'Adductor rocks', 'Hip flexor ladder (practice rung)'];
  const upper = ['Couch stretch', 'Deep squat hold', 'Wrist prep', 'Wall handstand', 'L-sit', 'Hip flexor ladder (working rung)'];
  for (const k of ['d1', 'd2', 'd3', 'd4']) {
    const s = E.newSession(k, [], '2026-10-20', 'x'), want = k === 'd4' ? upper : lower;
    assert.deepEqual(s.exercises.slice(0, want.length).map(e => e.n), want, k);
    for (const e of s.exercises.slice(0, want.length)) { assert.match(e.routine, /^pre-/, e.n); assert.equal(e.rec, null, e.n); assert.equal(e.key, false); }
    assert.ok(s.exercises.slice(want.length).every(e => !e.routine), k + ': the lifts follow');
  }
  const d1 = E.newSession('d1', [], '2026-10-20', 'x');
  assert.deepEqual(ex(d1, 'Couch stretch').sets.map(s => s.target), [{ seconds: 60, src: 'dose' }, { seconds: 60, src: 'dose' }], '60 s per side');
  assert.equal(ex(d1, 'Deep squat hold').sets.length, 2, '2 × 30–45 s');
  assert.equal(ex(E.newSession('d4', [], '2026-10-25', 'x'), 'L-sit').sets.length, 4);
  assert.equal(ex(E.newSession('d4', [], '2026-10-25', 'x'), 'Hip flexor ladder (working rung)').sets.length, 4);
  assert.equal(ex(E.newSession('d4', [], '2026-10-25', 'x'), 'Wall handstand').sets.length, 2);
});

test('the pre-session block makes no decisions and does not count as lifts', () => {
  const s = E.newSession('d1', [], '2026-10-20', '2026-10-20T08:00:00Z');
  for (const e of s.exercises) if (e.routine) for (const st of e.sets) E.confirmSet(e, st, 'tick', '2026-10-20T08:20:00Z');
  for (const e of s.exercises) if (!e.routine) e.sets = [];
  const r = E.finishSession(s, '2026-10-20T08:30:00Z');
  assert.ok(r.session);
  assert.equal(r.session.decisions.length, 0);
  assert.equal(E.sessionsInWeek([{ ...r.session, key: 'skill' }], '2026-10-19').length, 0);
  // the pre-block exercises have no heavy/cal flags, so no kg target is ever withheld from them
  assert.ok(r.session.exercises.filter(e => e.routine).every(e => !e.cal && !e.backoff));
});

test('the pre-session block asks for no seconds twice: a hold target is its dose or last time', () => {
  const prev = S5('2026-10-13', 'd4', [{ n: 'L-sit', kind: 'time', routine: 'pre-upper', targetSets: 4, sets: [{ seconds: 12, warmup: false, state: 'done' }, { seconds: 10, warmup: false, state: 'done' }] }]);
  assert.deepEqual(ex(E.newSession('d4', [prev], '2026-10-18', 'x'), 'L-sit').sets[0].target, { seconds: 11, src: 'last' });
  assert.equal(ex(E.newSession('d4', [], '2026-10-18', 'x'), 'L-sit').sets[0].target, null);
});

/* ------------------------------------------------------------ the app */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
test('the page hides legacy templates on the Log tab, offers the Skill day, and flags old sessions in History', () => {
  assert.match(html, /if\(k === next \|\| t\.legacy\) continue;/);
  assert.match(html, /E\.SKILL_DAY/);
  assert.match(html, /E\.isLegacyKey\(s\.key\)/);
  assert.doesNotMatch(html, /floorFor/);
  assert.match(html, /E\.blockInfo\(today\(\)\)/);
});
test('the Log tab offers exactly the four sessions and the Skill day (and Custom)', () => {
  const offered = Object.entries(E.TEMPLATES).filter(([, t]) => !t.legacy).map(([k]) => k);
  assert.deepEqual(offered, ['d1', 'd2', 'd3', 'd4', 'skill', 'custom']);
});
