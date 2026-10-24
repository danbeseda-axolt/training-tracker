// Progress per lift (build 5-21, projects/ledger-ux-research-2026-10-24.md).
// Pure rules in progress.js, with the real engine's e1rm and dates.
// node --test "tracker/dev/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../progress.js';
import * as E from '../engine.js';

const set = (kg, reps, rir = null, more = {}) => ({ kg, reps, rir, state: 'done', ...more });
const ses = (date, exercises, more = {}) => ({ date, key: 'd1', exercises, ...more });
const ex = (n, sets) => ({ n, kind: 'weight', sets });

test('baseName joins heavy and volume variants, and nothing else', () => {
  assert.equal(G.baseName('Bench press (heavy)'), 'Bench press');
  assert.equal(G.baseName('High-bar back squat (volume)'), 'High-bar back squat');
  assert.equal(G.baseName('Hip thrust (paused top)'), 'Hip thrust (paused top)');
});

test('exerciseBest uses RIR where given, RIR 0 otherwise, and skips warm-ups, planned sets and 13+ effective reps', () => {
  const b = G.exerciseBest(ex('Squat', [set(60, 5, null, { warmup: true }), set(100, 5, 2), set(100, 5), { kg: 120, reps: 5, state: 'planned' }]), E.e1rm);
  assert.equal(b.kg, 100);
  assert.ok(Math.abs(b.v - 100 * (1 + 7 / 30)) < 1e-9, 'RIR 2 set beats the same set read at RIR 0');
  assert.equal(G.exerciseBest(ex('Curl', [set(10, 15, 0)]), E.e1rm), null);
});

test('liftSeries: oldest first, one point per date, PRs marked, deleted and unverified left out', () => {
  const h = [
    ses('2026-10-12', [ex('Bench press (volume)', [set(65, 8, 2)])]),
    ses('2026-10-08', [ex('Bench press (heavy)', [set(75, 5, 2)])]),
    ses('2026-10-08', [ex('Bench press (heavy)', [set(70, 5, 2)])]),
    ses('2026-10-20', [ex('Bench press (heavy)', [set(77.5, 5, 2)])]),
    ses('2026-10-21', [ex('Bench press (heavy)', [set(100, 5, 2)])], { deleted: true }),
    ses('2026-10-22', [ex('Bench press (heavy)', [set(100, 5, 2)])], { unverified: true })
  ];
  const s = G.liftSeries(h, 'Bench press', E.e1rm);
  assert.deepEqual(s.map(p => p.date), ['2026-10-08', '2026-10-12', '2026-10-20']);
  assert.equal(s[0].kg, 75);
  assert.deepEqual(s.map(p => p.pr), [true, false, true], '65×8 @2 (86.7) is below 75×5 @2 (92.5); 77.5×5 @2 is a new best');
});

test('cardStats: change against the last point 28+ days back, else the first; isBest on a new high', () => {
  const pts = [{ date: '2026-09-15', v: 80 }, { date: '2026-09-27', v: 95 }, { date: '2026-10-15', v: 110 }, { date: '2026-10-23', v: 111 }];
  const c = G.cardStats(pts, '2026-10-24', E.addDays);
  assert.equal(c.last, 111); assert.equal(c.change, 31); assert.equal(c.since, '2026-09-15', '28 days before 24 Oct is 26 Sep; the last point on or before it is 15 Sep');
  assert.equal(c.isBest, true);
  assert.equal(G.cardStats([], '2026-10-24', E.addDays), null);
  assert.equal(G.cardStats([{ date: '2026-10-20', v: 50 }, { date: '2026-10-22', v: 48 }], '2026-10-24', E.addDays).change, -2);
});

test('homeLifts: main lifts first in programme order, bodyweight-only never, two sessions needed, at most four', () => {
  const days = [{ ex: [{ n: 'Couch stretch', kind: 'time' }, { n: 'Curl', kind: 'weight' }, { n: 'Squat', kind: 'weight', key: true }] },
    { ex: [{ n: 'Bench press (heavy)', kind: 'weight', key: true }, { n: 'Push-up', kind: 'weight', load: 'bw' }, { n: 'Row', kind: 'weight' }, { n: 'Dip', kind: 'weight', load: 'bw+' }] }];
  const counts = { Squat: 5, 'Bench press': 3, Curl: 2, Row: 1, Dip: 4, 'Push-up': 9 };
  assert.deepEqual(G.homeLifts(days, b => counts[b] || 0), ['Squat', 'Bench press', 'Curl', 'Dip']);
  assert.deepEqual(G.homeLifts(days, b => counts[b] || 0, 2), ['Squat', 'Bench press']);
});

test('repRecords: best kg per rep count up to 12, newest date on a tie', () => {
  const h = [ses('2026-09-08', [ex('Overhead press', [set(30, 8), set(32.5, 5)])]), ses('2026-10-15', [ex('Overhead press', [set(42.5, 5), set(20, 15)])]),
    ses('2026-10-23', [ex('Overhead press', [set(42.5, 5)])])];
  assert.deepEqual(G.repRecords(h, 'Overhead press'), [{ reps: 5, kg: 42.5, date: '2026-10-23' }, { reps: 8, kg: 30, date: '2026-09-08' }]);
});

test('inRange and weekStreak', () => {
  const pts = [{ date: '2025-10-01' }, { date: '2026-08-01' }, { date: '2026-10-01' }, { date: '2026-10-20' }];
  assert.equal(G.inRange(pts, '1m', '2026-10-24', E.addDays).length, 2);
  assert.equal(G.inRange(pts, '3m', '2026-10-24', E.addDays).length, 3);
  assert.equal(G.inRange(pts, 'all', '2026-10-24', E.addDays).length, 4);
  const dates = ['2026-10-19', '2026-10-13', '2026-10-06', '2026-09-22'];
  assert.equal(G.weekStreak(dates, '2026-10-24', E.weekOf, E.addDays), 3, 'gap in the week of 29 Sep ends it');
  assert.equal(G.weekStreak(['2026-10-13', '2026-10-06'], '2026-10-24', E.weekOf, E.addDays), 2, 'this week not over yet: counts from last week');
  assert.equal(G.weekStreak(['2026-10-06'], '2026-10-24', E.weekOf, E.addDays), 0);
});
