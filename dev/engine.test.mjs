// Engine tests. Plain Node, no dependencies: node --test "tracker/dev/*.test.mjs"
// Fixtures are synthetic and inline: tracker/ is published to public GitHub
// Pages, so real training data never lives here (realdata.test.mjs reads it
// from training/log at test time instead).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../engine.js';

const T = (key, name) => E.TEMPLATES[key].ex.find(e => e.n === name);
const W = (kg, reps, rir = null, more = {}) => ({ kg, reps, rir, warmup: false, state: 'done', doneAt: '2026-09-01T10:00:00Z', via: 'tick', target: null, ...more });
const X = (n, sets, more = {}) => ({ n, kind: 'weight', targetSets: sets.length, sets, ...more });
const S5 = (date, key, exercises, more = {}) => ({ schemaVersion: 5, date, key, name: key, isDeload: false, exercises, decisions: [], ...more });
const hist = (...s) => s.sort((a, b) => (a.date < b.date ? 1 : -1));

/* ------------------------------------------------------------------ e1rm */
test('e1rm: a missing RIR gives no estimate, never RIR 0', () => {
  assert.equal(E.e1rm(75, 5, null), null);
  assert.ok(Math.abs(E.e1rm(75, 5, 1) - 90) < 1e-9);
});

test('rirRef is the last rated working set, ignoring warm-ups and planned sets', () => {
  const ex = X('x', [W(60, 5, 4, { warmup: true }), W(75, 5, 3), W(75, 5, 2), W(75, 5, null), { ...W(75, 5, 0), state: 'planned' }]);
  assert.equal(E.rirRef(ex), 2);
  assert.equal(E.rirRef(X('x', [W(75, 5)])), null);
});

/* ------------------------------------------------------------ core rules */
const ohp = T('upper-push', 'Overhead press');
test('RN: every set at the top with no last-set RIR holds the weight', () => {
  const h = [S5('2026-09-01', 'upper-push', [X(ohp.n, [W(30, 8), W(30, 8), W(30, 8)])])];
  const r = E.recommend(ohp, h, '2026-09-08');
  assert.equal(r.rule, 'RN'); assert.equal(r.kg, 30); assert.equal(r.reps, 8);
});
test('R2: top of range with last-set RIR 1 against target 2 holds', () => {
  const h = [S5('2026-09-01', 'upper-push', [X(ohp.n, [W(30, 8, 2), W(30, 8, 2), W(30, 8, 1)])])];
  assert.equal(E.recommend(ohp, h, '2026-09-08').rule, 'R2');
});
test('R1: top of range at the target RIR adds one increment and drops to the bottom', () => {
  const h = [S5('2026-09-01', 'upper-push', [X(ohp.n, [W(30, 8, 3), W(30, 8, 2), W(30, 8, 2)])])];
  const r = E.recommend(ohp, h, '2026-09-08');
  assert.deepEqual([r.rule, r.kg, r.reps], ['R1', 32.5, 6]);
});
test('R0: fewer sets than prescribed holds at the top of the range', () => {
  const h = [S5('2026-09-01', 'upper-push', [X(ohp.n, [W(30, 8, 2), W(30, 8, 2)], { targetSets: 3 })])];
  assert.equal(E.recommend(ohp, h, '2026-09-08').rule, 'R0');
});
test('R4: two sets below the range holds at the bottom', () => {
  const h = [S5('2026-09-01', 'upper-push', [X(ohp.n, [W(30, 6, 1), W(30, 5, 0), W(30, 5, 0)])])];
  const r = E.recommend(ohp, h, '2026-09-08');
  assert.deepEqual([r.rule, r.kg, r.reps], ['R4', 30, 6]);
});
test('R3: otherwise same weight, one more rep on the weakest set', () => {
  const h = [S5('2026-09-01', 'upper-push', [X(ohp.n, [W(30, 8, 2), W(30, 7, 2), W(30, 6, 1)])])];
  const r = E.recommend(ohp, h, '2026-09-08');
  assert.deepEqual([r.rule, r.kg, r.reps], ['R3', 30, 7]);
});
test('R5: two R4 decisions in a row drop the load 10%; later-dated and not-done decisions are ignored', () => {
  const sets = [W(40, 6, 1), W(40, 5, 0), W(40, 5, 0)];
  const d = rule => [{ ex: ohp.n, rule, outcome: 'overridden' }];
  const h = hist(
    S5('2026-09-01', 'upper-push', [X(ohp.n, sets)], { decisions: d('R4') }),
    S5('2026-08-25', 'upper-push', [X(ohp.n, sets)], { decisions: d('R4') }));
  const r = E.recommend(ohp, h, '2026-09-08');
  assert.deepEqual([r.rule, r.kg, r.reps], ['R5', 35, 6]);
  // A not-done decision between them does not count as an evaluation.
  const h2 = hist(...h, S5('2026-08-28', 'upper-push', [X(ohp.n, sets)], { decisions: [{ ex: ohp.n, rule: 'R3', outcome: 'not-done' }] }));
  assert.equal(E.recommend(ohp, h2, '2026-09-08').rule, 'R5');
});
test('lastRules skips sessions dated on or after beforeDate and not-done decisions', () => {
  const h = hist(
    S5('2026-09-10', 'upper-push', [], { decisions: [{ ex: 'A', rule: 'R9', outcome: 'accepted' }] }),
    S5('2026-09-05', 'upper-push', [], { decisions: [{ ex: 'A', rule: 'R8', outcome: 'not-done' }] }),
    S5('2026-09-03', 'upper-push', [], { decisions: [{ ex: 'A', rule: 'R4', outcome: 'accepted' }] }));
  assert.deepEqual(E.lastRules('A', 2, h, '2026-09-10'), ['R4']);
});

/* ------------------------------------------------------------ bench: hold */
const bench = T('upper-push', 'Bench press (heavy)');
test('bench (hold): last-set RIR 2 does not add load', () => {
  const h = [S5('2026-09-01', 'upper-push', [X(bench.n, [W(75, 5, 3), W(75, 5, 3), W(75, 5, 2), W(75, 5, 2)])])];
  const r = E.recommend(bench, h, '2026-09-08');
  assert.notEqual(r.rule, 'R1'); assert.equal(r.rule, 'R2'); assert.equal(r.kg, 75); assert.match(r.why, /Hold, don't chase/);
});
test('bench (hold): every rated set RIR 3+ and last set 3 goes to 77.5 × 5', () => {
  const h = [S5('2026-09-01', 'upper-push', [X(bench.n, [W(75, 5, 4), W(75, 5, 3), W(75, 5, 3), W(75, 5, 3)])])];
  const r = E.recommend(bench, h, '2026-09-08');
  assert.deepEqual([r.rule, r.kg, r.reps], ['R1', 77.5, 5]);
});
test('bench (hold): no RIR logged gives RN, which is checked before hold; an unrated last set falls back to the last rated one', () => {
  const h = [S5('2026-09-01', 'upper-push', [X(bench.n, [W(75, 5), W(75, 5), W(75, 5), W(75, 5)])])];
  assert.equal(E.recommend(bench, h, '2026-09-08').rule, 'RN');
  const h2 = [S5('2026-09-01', 'upper-push', [X(bench.n, [W(75, 5, 2), W(75, 5, 2), W(75, 5, 2), W(75, 5)])])];
  assert.equal(E.recommend(bench, h2, '2026-09-08').rule, 'R2');
});
test('a date change keeps the hold rule: tplOf rebuilds it from the exercise', () => {
  const h = [S5('2026-09-01', 'upper-push', [X(bench.n, [W(75, 5, 2), W(75, 5, 2), W(75, 5, 2), W(75, 5, 2)])])];
  const d = E.newSession('upper-push', h, '2026-09-08', '2026-09-08T10:00:00Z');
  assert.equal(d.exercises[0].rec.rule, 'R2');
  d.date = '2026-09-09'; E.retarget(d, h);
  assert.equal(d.exercises[0].rec.rule, 'R2', 'bench @RIR2 must not become R1 after a date change');
  assert.equal(E.tplOf(d.exercises[0]).hold, true);
});

/* ------------------------------------------------ bodyweight-plus / R1b */
const dip = T('upper-push', 'Weighted dip');
test('Weighted dip (bw+) 15×8 ×3 at last-set RIR 2 goes to 17.5 × 6, never R1b', () => {
  const h = [S5('2026-09-01', 'upper-push', [X(dip.n, [W(15, 8, 2), W(15, 8, 2), W(15, 8, 2)], { load: 'bw+' })])];
  const r = E.recommend(dip, h, '2026-09-08');
  assert.deepEqual([r.rule, r.kg, r.reps], ['R1', 17.5, 6]);
});
test('bw+: a legacy null kg reads as bodyweight (0)', () => {
  const raise = T('lower-a', 'Hanging knee/leg raise');
  const h = [S5('2026-09-01', 'lower-a', [X(raise.n, [W(null, 10, 2), W(null, 12, 1), W(null, 10, 1)])])];
  const { target } = E.targets(raise, h, '2026-09-08');
  assert.equal(target.kg, 0);
  assert.equal(E.setText({ kind: 'weight', load: 'bw+' }, { state: 'planned', target }), 'BW × 11');
});
const curl = T('upper-push', 'Incline DB curl');
test('R1b: a 2 kg jump on 10 kg adds a rep instead', () => {
  const h = [S5('2026-09-01', 'upper-push', [X(curl.n, [W(10, 12, 1), W(10, 12, 1), W(10, 12, 1)])])];
  const r = E.recommend(curl, h, '2026-09-08');
  assert.deepEqual([r.rule, r.kg, r.reps], ['R1b', 10, 13]);
});
test('R1b is forced to R1 once every set is two past the top', () => {
  const h = [S5('2026-09-01', 'upper-push', [X(curl.n, [W(10, 14, 1), W(10, 14, 1), W(10, 14, 1)])])];
  const r = E.recommend(curl, h, '2026-09-08');
  assert.deepEqual([r.rule, r.kg, r.reps], ['R1', 12, 10]);
});
test('R1b never proposes more than top + 2 reps', () => {
  for (const reps of [[12, 12, 12], [13, 14, 13], [13, 16, 13], [12, 20, 13]]) {
    const h = [S5('2026-09-01', 'upper-push', [X(curl.n, reps.map(r => W(10, r, 1)))])];
    const r = E.recommend(curl, h, '2026-09-08');
    if (r.rule === 'R1b') assert.ok(r.reps <= curl.rep[1] + 2, JSON.stringify(r));
  }
});

/* ---------------------------------------------------------- bands, bw */
const pallof = T('upper-push', 'Pallof press');
test('Pallof (band): no recommendation ever carries a numeric kg; target band is the last band', () => {
  const B = (band, reps, rir) => ({ band, reps, rir, warmup: false, state: 'done', doneAt: null, via: 'tick' });
  const cases = [
    [B('red', 10, 2), B('red', 10, 2), B('red+green', 10, 2)],  // B1
    [B('red', 10, 1), B('red', 9, 1), B('red', 8, 1)],          // B2
    [B('red', 10), B('red', 10), B('red', 10)],                 // RN
    [B('red', 10, 2), B('red', 10, 2)]                          // R0
  ];
  const rules = [];
  for (const sets of cases) {
    const h = [S5('2026-09-01', 'upper-push', [{ n: pallof.n, kind: 'band', targetSets: 3, sets }])];
    for (const dl of [false, true]) {
      const r = E.recommend(pallof, h, '2026-09-08', dl);
      const t = E.targets(pallof, h, '2026-09-08', dl).target;
      assert.ok(!('kg' in r) || r.kg == null, JSON.stringify(r));
      assert.ok(!('kg' in t), JSON.stringify(t));
      assert.equal(t.band, sets[sets.length - 1].band);
      if (!dl) rules.push(r.rule);
    }
  }
  assert.deepEqual(rules, ['B1', 'B2', 'RN', 'R0']);
});
test('Pallof from a legacy kg-less file: band unknown, so ✓ refuses and the sheet opens', () => {
  const h = [E.migrateSession({ date: '2026-09-01', key: 'upper-push', exercises: [{ n: pallof.n, kind: 'weight', targetSets: 3, sets: [{ kg: null, reps: 10, rir: null, done: false, warmup: false }, { kg: null, reps: 10, rir: null, done: false, warmup: false }] }] })];
  const d = E.newSession('upper-push', h, '2026-09-08', 'x');
  const ex = d.exercises.find(e => e.n === pallof.n);
  assert.deepEqual(ex.sets[0].target, { band: null, reps: 10 });
  assert.equal(E.setText(ex, ex.sets[0]), 'band? × 10');
  assert.equal(E.confirmSet(ex, ex.sets[0], 'tick', 'now'), false);
  assert.equal(ex.sets[0].state, 'planned');
});
const wheel = T('lower-a', 'Ab wheel rollout');
test('Ab wheel (bw): targets have no kg, and a topped session asks for a harder variation', () => {
  const R = (reps, rir) => ({ reps, rir, warmup: false, state: 'done', doneAt: null, via: 'tick' });
  const h = [S5('2026-09-01', 'lower-a', [X(wheel.n, [R(10, 2), R(10, 1), R(10, 1)], { load: 'bw' })])];
  const { rec, target } = E.targets(wheel, h, '2026-09-08');
  assert.equal(rec.rule, 'R1v'); assert.equal(rec.kg, null);
  assert.deepEqual(target, { reps: 10 });
  const d = E.newSession('lower-a', h, '2026-09-08', 'x');
  const set = d.exercises.find(e => e.n === wheel.n).sets[0];
  assert.ok(!('kg' in set));
  const h2 = [S5('2026-09-01', 'lower-a', [X(wheel.n, [R(8, 1), R(7, 1), R(7, 1)], { load: 'bw' })])];
  const r2 = E.recommend(wheel, h2, '2026-09-08');
  assert.equal(r2.rule, 'R3'); assert.equal(r2.kg, null); assert.equal(r2.reps, 8);
});

/* --------------------------------------------------------------- deload */
test('R6 per kind: weight 65%, bw+ added load 65%, bw and band keep no kg, carries 65% with the same metres', () => {
  const up = [S5('2026-09-01', 'upper-push', [
    X(bench.n, [W(80, 5, 2), W(80, 5, 2), W(80, 5, 2), W(80, 5, 2)]),
    X(dip.n, [W(20, 8, 2), W(20, 8, 2), W(20, 8, 2)], { load: 'bw+' }),
    { n: pallof.n, kind: 'band', targetSets: 3, sets: [1, 2, 3].map(() => ({ band: 'red', reps: 10, rir: 2, state: 'done' })) }])];
  assert.deepEqual(E.targets(bench, up, '2026-09-08', true).target, { kg: 52.5, reps: 5 });
  assert.deepEqual(E.targets(dip, up, '2026-09-08', true).target, { kg: 12.5, reps: 6 });
  const p = E.targets(pallof, up, '2026-09-08', true);
  assert.equal(p.rec.rule, 'R6'); assert.ok(!('kg' in p.rec)); assert.deepEqual(p.target, { band: 'red', reps: 10 });
  const R = reps => ({ reps, rir: 1, state: 'done' });
  const farmer = T('lower-a', 'Farmer’s carry');
  const lo = [S5('2026-09-01', 'lower-a', [X(wheel.n, [R(10), R(10), R(10)], { load: 'bw' }),
    { n: farmer.n, kind: 'distance', targetSets: 3, sets: [{ kg: 24, metres: 40, state: 'done' }] }])];
  assert.deepEqual(E.targets(wheel, lo, '2026-09-08', true).target, { reps: 6 });
  assert.deepEqual(E.targets(farmer, lo, '2026-09-08', true).target, { kg: 16, metres: 40 });
});

/* ------------------------------------------------------------- carries */
test('carries: Farmer’s target is 40 m on every set, Suitcase 30 m, with the last load; ✓ copies metres', () => {
  const farmer = T('lower-a', 'Farmer’s carry'), suit = T('lower-b', 'Suitcase carry');
  const h = [E.migrateSession({ date: '2026-09-01', key: 'lower-a', exercises: [{ n: farmer.n, kind: 'distance', targetSets: 3, sets: [{ kg: 24, metres: null, done: false, warmup: false }] }] })];
  const a = E.newSession('lower-a', h, '2026-09-08', 'x').exercises.find(e => e.n === farmer.n);
  assert.equal(a.sets.length, 3);
  for (const s of a.sets) assert.deepEqual(s.target, { kg: 24, metres: 40 });
  const b = E.newSession('lower-b', [], '2026-09-08', 'x').exercises.find(e => e.n === suit.n);
  for (const s of b.sets) assert.deepEqual(s.target, { kg: null, metres: 30 });
  assert.equal(E.confirmSet(a, a.sets[0], 'tick', '2026-09-08T10:00:00Z'), true);
  assert.equal(a.sets[0].metres, 40); assert.equal(a.sets[0].kg, 24); assert.equal(a.sets[0].state, 'done');
  assert.equal(E.confirmSet(b, b.sets[0], 'tick', 'x'), false, 'no load known yet: the sheet has to ask');
});

/* ----------------------------------------------------- set confirmation */
test('newSession: only planned sets, kg/reps/rir null, target set where a rec exists', () => {
  const h = [S5('2026-09-01', 'upper-push', [X(bench.n, [W(75, 5, 2), W(75, 5, 2), W(75, 5, 2), W(75, 5, 2)])])];
  const d = E.newSession('upper-push', h, '2026-09-08', '2026-09-08T10:00:00Z');
  for (const ex of d.exercises) for (const s of ex.sets) {
    assert.equal(s.state, 'planned');
    assert.equal(s.kg ?? null, null); assert.equal(s.reps, null); assert.equal(s.rir ?? null, null);
    assert.ok(!('done' in s));
    if (ex.rec) assert.ok(s.target, ex.n);
  }
  assert.deepEqual(d.exercises[0].sets[0].target, { kg: 75, reps: 5 });
  assert.equal(d.schemaVersion, 5);
});
test('✓ copies the target; un-ticking clears only values that still equal it', () => {
  const ex = { n: 'x', kind: 'weight', load: 'kg', sets: [E.blankSet({ kind: 'weight' }, { kg: 75, reps: 5 })] };
  const st = ex.sets[0];
  assert.equal(E.confirmSet(ex, st, 'tick', '2026-09-08T10:00:00Z'), true);
  assert.deepEqual([st.kg, st.reps, st.rir, st.state, st.via], [75, 5, null, 'done', 'tick']);
  assert.equal(st.doneAt, '2026-09-08T10:00:00Z');
  st.reps = 4;                                    // Dan corrected the reps
  E.unconfirmSet(st);
  assert.deepEqual([st.kg, st.reps, st.state, st.doneAt], [null, 4, 'planned', null]);
});
test('a null target is never confirmable', () => {
  const ex = { n: 'x', kind: 'weight', sets: [E.blankSet({ kind: 'weight' }, null)] };
  assert.equal(E.canConfirm(ex, ex.sets[0]), false);
  assert.equal(E.confirmSet(ex, ex.sets[0], 'tick', 'x'), false);
  assert.equal(ex.sets[0].state, 'planned');
});
test('a changed weight in the sheet carries to the later sets: 77.5 then ✓ ✓ ✓ records 77.5 × 4', () => {
  const h = [S5('2026-09-01', 'upper-push', [X(bench.n, [W(75, 5, 2), W(75, 5, 2), W(75, 5, 2), W(75, 5, 2)])])];
  const d = E.newSession('upper-push', h, '2026-09-08', 'x');
  const ex = d.exercises[0];
  Object.assign(ex.sets[0], { kg: 77.5, reps: 5, rir: 2, state: 'done', via: 'sheet', doneAt: '2026-09-08T10:00:00Z' });
  E.carryForward(ex, 0);
  for (const j of [1, 2, 3]) assert.equal(E.confirmSet(ex, ex.sets[j], 'tick', '2026-09-08T10:05:00Z'), true);
  assert.deepEqual(ex.sets.map(s => s.kg), [77.5, 77.5, 77.5, 77.5]);
  assert.equal(ex.sets[1].target.src, 'carried');
  assert.equal(ex.rec.kg, 75, 'the rec stays what the rules said');
});

/* ------------------------------------------------------------- finishing */
function pushHistory() {
  const B = (band, reps, rir) => ({ band, reps, rir, warmup: false, state: 'done', doneAt: null, via: 'tick' });
  return [S5('2026-09-01', 'upper-push', [
    X(bench.n, [W(75, 5, 2), W(75, 5, 2), W(75, 5, 2), W(75, 5, 2)]),
    X(ohp.n, [W(30, 8, 2), W(30, 7, 2), W(30, 7, 2)]),
    X(dip.n, [W(15, 8, 2), W(15, 8, 2), W(15, 7, 2)], { load: 'bw+' }),
    X(curl.n, [W(20, 10, 1), W(20, 10, 1), W(20, 10, 1)]),
    { n: pallof.n, kind: 'band', targetSets: 3, sets: [B('red', 10, 2), B('red', 10, 2), B('red', 10, 2)] }])];
}
test('finishSession: untouched blocks with 16 unticked; drop gives empty; asShown confirms all as bulk and is retro', () => {
  const d = E.newSession('upper-push', pushHistory(), '2026-09-08', '2026-09-08T10:00:00Z');
  assert.deepEqual(E.finishSession(d, '2026-09-08T10:00:30Z'), { blocked: 'unticked', count: 16, noTarget: 0 });
  assert.deepEqual(E.finishSession(d, '2026-09-08T10:00:30Z', 'drop'), { blocked: 'empty' });
  const { session } = E.finishSession(d, '2026-09-08T10:00:30Z', 'asShown');
  const sets = session.exercises.flatMap(e => e.sets);
  assert.equal(sets.length, 16);
  assert.ok(sets.every(s => s.state === 'done' && s.via === 'bulk'));
  assert.equal(session.logMode, 'retro');
  assert.ok(session.decisions.every(x => x.outcome === 'bulk-accepted'), JSON.stringify(session.decisions.map(x => x.outcome)));
  assert.equal(d.exercises[0].sets[0].state, 'planned', 'finishSession is pure');
});
test('finishSession: asShown with no targets is blocked, not fabricated', () => {
  const d = E.newSession('upper-pull', [], '2026-09-09', 'x');
  const r = E.finishSession(d, 'y', 'asShown');
  assert.equal(r.blocked, 'unticked');
  assert.ok(r.noTarget > 0);
});
test('finishSession: no planned sets survive; skipped exercises are stubs with a not-done decision; accepted means top kg = rec', () => {
  const d = E.newSession('upper-push', pushHistory(), '2026-09-08', '2026-09-08T10:00:00Z');
  const [b, o] = d.exercises;
  for (const s of b.sets) E.confirmSet(b, s, 'tick', '2026-09-08T10:10:00Z');
  Object.assign(o.sets[0], { kg: 32.5, reps: 6, rir: 2, state: 'done', via: 'sheet', doneAt: '2026-09-08T10:20:00Z' });
  const { session } = E.finishSession(d, '2026-09-08T11:00:00Z', 'drop');
  assert.ok(!session.exercises.flatMap(e => e.sets).some(s => s.state === 'planned'));
  const stub = session.exercises.find(e => e.n === dip.n);
  assert.deepEqual([stub.n, stub.kind, stub.load, stub.targetSets, stub.sets, stub.skipped], [dip.n, 'weight', 'bw+', 3, [], true]);
  const dec = Object.fromEntries(session.decisions.map(x => [x.ex, x]));
  assert.equal(dec[bench.n].outcome, 'accepted');
  assert.equal(dec[ohp.n].outcome, 'overridden');
  assert.equal(dec[ohp.n].recReps, o.rec.reps);
  assert.equal(dec[ohp.n].rirRef, 2);
  assert.equal(dec[dip.n].outcome, 'not-done');
  assert.equal(session.schemaVersion, 5);
  assert.equal(session.firstDoneAt, '2026-09-08T10:10:00Z');
  assert.equal(session.lastDoneAt, '2026-09-08T10:20:00Z');
});
test('logMode: 12 ticked sets over 45 minutes on the day is live; over 5 minutes is retro', () => {
  for (const [span, want] of [[45, 'live'], [5, 'retro']]) {
    const d = E.newSession('upper-push', pushHistory(), '2026-09-08', '2026-09-08T09:00:00Z');
    let k = 0;
    const all = d.exercises.flatMap(ex => ex.sets.map(s => [ex, s])).slice(0, 12);
    for (const [ex, s] of all) E.confirmSet(ex, s, 'tick', new Date(Date.parse('2026-09-08T09:00:00Z') + (k++ / 11) * span * 60000).toISOString());
    const { session } = E.finishSession(d, '2026-09-08T10:00:00Z', 'drop');
    assert.equal(session.logMode, want);
  }
});
test('editing a legacy session and saving it unchanged keeps every set and the original decisions', () => {
  const legacy = { date: '2026-09-01', key: 'upper-push', name: 'Upper Push', isDeload: false, notes: '', startedAt: 'a', endedAt: '2026-09-01T12:00:00Z',
    exercises: [X(bench.n, [{ kg: 75, reps: 5, rir: 1, done: false, warmup: false }, { kg: 75, reps: 5, rir: 1.5, done: false, warmup: false }], { rec: { rule: 'R2', kg: 75, reps: 5, why: 'w' } }),
      { n: 'Farmer’s carry', kind: 'distance', targetSets: 1, sets: [{ kg: 24, metres: null, done: false, warmup: false }] }],
    decisions: [{ ex: bench.n, rule: 'R2', recKg: 75, actualKg: 75, why: 'w', outcome: 'accepted' }] };
  const d = { ...E.migrateSession(legacy), editing: true, originPath: 'training/log/2026-09-01-upper-push.json', origDate: '2026-09-01', origKey: 'upper-push' };
  const { session } = E.finishSession(d, '2026-09-20T10:00:00Z');
  assert.deepEqual(session.decisions, legacy.decisions);
  assert.equal(session.exercises.length, 2);
  session.exercises.forEach((ex, i) => ex.sets.forEach((s, j) => {
    const o = legacy.exercises[i].sets[j];
    for (const k of Object.keys(o)) assert.deepEqual(s[k], o[k]);
    assert.equal(s.state, 'legacy');
  }));
  assert.equal(session.endedAt, legacy.endedAt, 'an edit keeps endedAt');
  assert.equal(session.editedAt, '2026-09-20T10:00:00Z');
  assert.ok(!('editing' in session) && !('originPath' in session));
  const plan = E.planSave(d, session, [legacy], [], 'training/log', 'now');
  assert.equal(plan.session.file, 'training/log/2026-09-01-upper-push.json');
  assert.equal(plan.items.length, 1, 'no tombstone when the path is unchanged');
});

/* ------------------------------------------------------------- file paths */
test('two different upper-push sessions on 2026-09-23 get -2; history keeps both', () => {
  // Empty sessions are not savable, so each carries a note.
  const mk = id => { const d = E.newSession('upper-push', [], '2026-09-23', 't'); d.id = id; d.notes = 'n'; return E.finishSession(d, 'u', 'drop').session; };
  const s1 = E.planSave({}, mk('s_one'), [], [], 'training/log', 'n').session;
  const s2 = E.planSave({}, mk('s_two'), [], [s1], 'training/log', 'n').session;
  assert.ok(s1.file.endsWith('2026-09-23-upper-push.json'));
  assert.ok(s2.file.endsWith('2026-09-23-upper-push-2.json'));
  const m = E.mergedHistory([s1], [s2]);
  assert.equal(m.length, 2);
});
test('editing a session into a new date queues a tombstone for the old path first', () => {
  const orig = { schemaVersion: 5, id: 's_a', date: '2026-09-15', key: 'lower-a', name: 'Lower A', file: 'training/log/2026-09-15-lower-a.json', exercises: [], decisions: [] };
  const draft = { ...E.clone(orig), editing: true, originPath: orig.file, origDate: orig.date, origKey: orig.key, date: '2026-09-16', notes: 'moved' };
  const { session } = E.finishSession(draft, '2026-09-20T10:00:00Z');
  const plan = E.planSave(draft, session, [orig], [], 'training/log', '2026-09-20T10:00:00Z');
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].deleted, true);
  assert.equal(E.pathOf(plan.items[0], 'training/log'), 'training/log/2026-09-15-lower-a.json');
  assert.equal(plan.items[1].file, 'training/log/2026-09-16-lower-a.json');
});

/* ------------------------------------------------------------- migration */
test('migrateSession is idempotent, deep-copies, and only adds keys', () => {
  const src = { date: '2026-09-01', key: 'lower-a', bodyweight: null, exercises: [{ n: 'a', kind: 'weight', sets: [{ kg: 10, reps: 5, rir: null, done: false, warmup: false }] }], decisions: [] };
  const once = E.migrateSession(src);
  assert.deepEqual(E.migrateSession(once), once);
  assert.equal(src.exercises[0].sets[0].state, undefined, 'the input is untouched');
  assert.deepEqual(once.exercises[0].sets[0], { kg: 10, reps: 5, rir: null, done: false, warmup: false, state: 'legacy', doneAt: null, via: null, target: null });
  assert.equal(once.schemaVersion, undefined);
  const v5 = { schemaVersion: 5, exercises: [{ sets: [{ kg: 1, state: 'done' }] }] };
  assert.deepEqual(E.migrateSession(v5), v5);
});
test('isSuspectPrefill: fast, all sets = rec, no RIR, pre-v5 only', () => {
  const s = { date: '2026-09-01', key: 'upper-push', startedAt: '2026-09-01T10:00:00Z', endedAt: '2026-09-01T10:00:11Z',
    exercises: [X('a', [{ kg: 75, reps: 5, rir: null }], { rec: { kg: 75, reps: 5 } })] };
  assert.equal(E.isSuspectPrefill(s), true);
  assert.equal(E.isSuspectPrefill({ ...s, endedAt: '2026-09-01T10:03:00Z' }), false);
  assert.equal(E.isSuspectPrefill({ ...s, schemaVersion: 5 }), false);
  const rated = E.clone(s); rated.exercises[0].sets[0].rir = 2;
  assert.equal(E.isSuspectPrefill(rated), false);
  assert.equal(E.analysisHistory([s], []).length, 0);
  assert.equal(E.analysisHistory([{ ...s, verified: true }], []).length, 1);
  assert.equal(E.mergedHistory([s], []).length, 1, 'History still lists it');
});
test('analysisHistory: a queued copy replaces the pulled one; a queued tombstone removes it', () => {
  const a = { date: '2026-09-01', key: 'upper-push', name: 'pulled', exercises: [] };
  assert.equal(E.analysisHistory([a], [{ ...a, name: 'queued', qid: 'q1' }])[0].name, 'queued');
  assert.equal(E.analysisHistory([a], [{ ...a, qid: 'q1' }])[0].qid, undefined);
  assert.equal(E.analysisHistory([a], [{ ...a, deleted: true }]).length, 0);
});
test('migrateState keeps the token and every list verbatim, and turns untouched prefills back into targets', () => {
  const rec = { rule: 'R2', kg: 75, reps: 5, why: 'w' };
  const v4 = {
    settings: { token: 'TEST_TOKEN_NOT_REAL', owner: 'o', repo: 'r', branch: 'b', path: 'p', restOn: false, phase: 'maintain', deloadWeeks: 4 },
    draft: { date: '2026-09-22', key: 'upper-push', name: 'Upper Push', startedAt: '2026-09-22T10:00:00Z', exercises: [
      { n: bench.n, kind: 'weight', rec, sets: [
        { kg: 75, reps: 5, rir: null, done: false, warmup: false },
        { kg: 75, reps: 5, rir: null, done: false, warmup: false },
        { kg: 77.5, reps: 5, rir: null, done: false, warmup: false },
        { kg: null, reps: null, rir: null, done: false, warmup: false }] }] },
    queue: [{ date: '2026-09-20', key: 'lower-a' }, { date: '2026-09-21', key: 'upper-push', deleted: true }],
    bwQueue: [{ type: 'bw', date: '2026-09-21', kg: 72.4 }],
    history: [{ date: '2026-09-17' }, { date: '2026-09-15' }, { date: '2026-09-08' }],
    bw: [{ type: 'bw', date: '2026-09-20', kg: 72.6 }, { type: 'floor', date: '2026-09-01', hang: 60 }],
    historyFetched: 123
  };
  const input = E.clone(v4);
  const s = E.migrateState(v4);
  assert.equal(s.v, 5);
  assert.equal(s.settings.token, 'TEST_TOKEN_NOT_REAL');
  for (const k of ['owner', 'repo', 'branch', 'path', 'restOn', 'phase', 'deloadWeeks']) assert.equal(s.settings[k], input.settings[k]);
  assert.deepEqual(s.settings.bands, E.DEFAULT_BANDS); assert.equal(s.settings.wakeLock, true);
  for (const k of ['queue', 'bwQueue', 'history', 'bw']) assert.deepEqual(s[k], input[k]);
  assert.equal(s.historyFetched, 123);
  const sets = s.draft.exercises[0].sets;
  for (const j of [0, 1]) assert.deepEqual([sets[j].state, sets[j].kg, sets[j].reps, sets[j].target], ['planned', null, null, { kg: 75, reps: 5 }]);
  assert.deepEqual([sets[2].state, sets[2].kg, sets[2].reps], ['legacy', 77.5, 5]);
  assert.equal(sets[3].state, 'planned');
  assert.deepEqual(v4, input, 'the old blob is not mutated');
});
test('migrateDraft: an open edit of a saved session keeps every set as legacy', () => {
  const rec = { rule: 'R2', kg: 75, reps: 5 };
  const d = E.migrateDraft({ editing: true, exercises: [{ n: 'a', kind: 'weight', rec, sets: [{ kg: 75, reps: 5, rir: null, done: false }] }] });
  assert.deepEqual([d.exercises[0].sets[0].state, d.exercises[0].sets[0].kg], ['legacy', 75]);
});
test('normaliseState fills defaults and rejects a non-object', () => {
  const s = E.normaliseState({ v: 5, settings: { token: 't' }, history: null });
  assert.equal(s.settings.token, 't'); assert.deepEqual(s.history, []); assert.equal(s.settings.path, 'training/log');
  assert.throws(() => E.normaliseState(null));
  assert.throws(() => E.migrateState('x'));
});

/* ----------------------------------------------------- week and deload */
test('floor and custom sessions never count toward the week or the deload cadence', () => {
  const h = hist(S5('2026-09-22', 'floor', [], { isDeload: true }), S5('2026-09-23', 'upper-push', []), S5('2026-08-10', 'lower-a', []));
  assert.deepEqual(E.sessionsInWeek(h, '2026-09-21').map(s => s.key), ['upper-push']);
  assert.equal(E.weeksSinceDeload(h, '2026-09-23'), 6, 'the floor "deload" is ignored');
  assert.equal(E.newSession('floor', [], '2026-09-23', 'x', true).isDeload, false);
  assert.equal(E.newSession('upper-push', [], '2026-09-23', 'x', true).isDeload, true);
});
test('deloadCheck: cadence fires at the setting, counted from the first lift', () => {
  const h = [S5('2026-09-08', 'upper-push', [])];
  assert.equal(E.deloadCheck(h, [], { deloadWeeks: 5, phase: 'cut' }, '2026-09-23').fire, false);
  const r = E.deloadCheck(h, [], { deloadWeeks: 5, phase: 'cut' }, '2026-10-12');
  assert.equal(r.fire, true); assert.equal(r.codes[0].c, 'CADENCE');
});
test('weekPlan: any day in the week counts; suspect sessions show as unverified; next is today, else the earliest open', () => {
  const sus = { date: '2026-09-22', key: 'upper-push', startedAt: '2026-09-22T10:00:00Z', endedAt: '2026-09-22T10:00:05Z', exercises: [X('a', [{ kg: 1, reps: 1, rir: null }], { rec: { kg: 1, reps: 1 } })] };
  const list = [S5('2026-09-23', 'lower-b', []), sus];
  const p = E.weekPlan(list, '2026-09-23');
  assert.deepEqual(p.map(x => [x.day, x.state]), [['Mon', 'unverified'], ['Tue', 'done'], ['Wed', 'today'], ['Fri', 'upcoming']]);
  assert.equal(E.nextTemplate(p), 'upper-pull');
  assert.equal(E.nextTemplate(E.weekPlan(list, '2026-09-24')), 'upper-pull', 'Thursday: the missed Wednesday comes first');
});

/* ------------------------------------------------------------- display */
test('compact and setText read the way Dan logs', () => {
  const ex = X(bench.n, [W(60, 5, null, { warmup: true }), W(75, 5, 2), W(75, 5, 2), W(75, 4, 1)]);
  assert.equal(E.compact(ex), '75×5 ×2, 75×4 @1');
  assert.equal(E.setText(ex, ex.sets[1]), '75 kg × 5 @2');
  assert.equal(E.setText({ kind: 'weight' }, E.blankSet({ kind: 'weight' }, null)), 'tap to enter');
  assert.equal(E.setText({ kind: 'weight', load: 'bw+' }, W(15, 8)), 'BW+15 × 8');
  assert.equal(E.niceDate('2026-09-15', true), 'Tue 15 Sep 2026');
  // Pre-v5 exercises have no load type: display reads it from the template.
  const legacyRaise = E.migrateSession({ exercises: [{ n: 'Hanging knee/leg raise', kind: 'weight', sets: [{ kg: null, reps: 10, rir: 2 }] }] }).exercises[0];
  assert.equal(E.summarise(legacyRaise), 'BW×10 @2');
  const legacyPallof = E.migrateSession({ exercises: [{ n: 'Pallof press', kind: 'weight', sets: [{ kg: null, reps: 10, rir: null }] }] }).exercises[0];
  assert.equal(E.summarise(legacyPallof), '?×10');
});

/* ------------------------------------------------------ templates, purity */
test('templates match programme v2', () => {
  const want = {
    'upper-push': [['Bench press (heavy)', 4, [5, 5], 2], ['Overhead press', 3, [6, 8], 2], ['Weighted dip', 3, [6, 8], 2], ['Incline DB curl', 3, [10, 12], 1], ['Pallof press', 3, [10, 10], 2]],
    'lower-b': [['Trap-bar / conventional DL', 3, [5, 5], 3], ['Romanian deadlift', 3, [8, 8], 2], ['45° back extension', 3, [10, 15], 1], ['Suitcase carry', 3], ['McGill Big 3', 2], ['Dead hang', 2]],
    'upper-pull': [['Pull-up (EMOM 10×3)', 1, [30, 30]], ['Chin-up', 3, [5, 10], 2], ['Single-arm DB row', 3, [8, 12], 1], ['Face pull', 3, [12, 15], 1], ['Hammer curl', 3, [10, 12], 1]],
    'lower-a': [['High-bar back squat', 4, [5, 5], 2], ['Bulgarian split squat', 3, [8, 8], 2], ['Hanging knee/leg raise', 3, [8, 12], 1], ['Ab wheel rollout', 3, [6, 10], 1], ['Farmer’s carry', 3]]
  };
  for (const [k, list] of Object.entries(want)) {
    assert.deepEqual(E.TEMPLATES[k].ex.map(e => e.n), list.map(x => x[0]), k);
    list.forEach(([n, sets, rep, rir], i) => {
      const e = E.TEMPLATES[k].ex[i];
      assert.equal(e.sets, sets, n);
      if (rep) assert.deepEqual(e.rep, rep, n);
      if (rir != null) assert.equal(e.rir, rir, n);
    });
  }
  assert.deepEqual(Object.values(E.TEMPLATES).filter(t => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(t.day)).map(t => t.day), ['Mon', 'Tue', 'Wed', 'Fri']);
});
test('engine.js is pure: no global state, DOM, network or clock', () => {
  const src = readFileSync(fileURLToPath(new URL('../engine.js', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /(^|[^A-Za-z0-9_$.])S\./m, 'reads a global S');
  for (const bad of ['document.', 'window.', 'fetch(', 'localStorage', 'Date.now(', 'new Date()', 'navigator.', 'Math.random('])
    assert.ok(!src.includes(bad), 'engine.js uses ' + bad);
  assert.ok(Object.keys(E).length > 30);
});
