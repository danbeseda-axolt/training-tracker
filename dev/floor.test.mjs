// Floor and stretching routines. Plain Node, no dependencies.
// Checks the routines against training/daily-floor.md and that they log the
// same way the lifts do: one tap records the prescription, nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine.js';

const names = xs => xs.map(e => e.n);
const done = (seconds, more = {}) => ({ seconds, warmup: false, state: 'done', doneAt: '2026-09-01T10:00:00Z', via: 'tick', target: null, ...more });

test('the floor week matches daily-floor.md', () => {
  // 2026-09-28 is a Monday. Block 1 every day; length A/B, ladder and skill by weekday.
  const want = {
    '2026-09-28': ['squat-block', 'length-b', 'hip-ladder', 'handstand'], // Mon
    '2026-09-29': ['squat-block', 'length-a', 'hip-ladder', 'lsit'],      // Tue
    '2026-09-30': ['squat-block', 'length-b', 'handstand'],               // Wed
    '2026-10-01': ['squat-block', 'length-a', 'hip-ladder', 'lsit'],      // Thu
    '2026-10-02': ['squat-block', 'length-b', 'handstand'],               // Fri
    '2026-10-03': ['squat-block', 'length-a', 'hip-ladder', 'lsit'],      // Sat
    '2026-10-04': ['squat-block', 'length-b', 'handstand']                // Sun
  };
  for (const [d, keys] of Object.entries(want)) assert.deepEqual(E.floorFor(d), keys, d);
  const ladderDays = Object.keys(want).filter(d => E.floorFor(d).includes('hip-ladder')).length;
  assert.equal(ladderDays, 4, 'the ladder runs 4 days a week');
});

test('a Daily floor session is built from that day’s blocks, tagged by routine', () => {
  const s = E.newSession('floor', [], '2026-09-29', 'x');
  assert.deepEqual(names(s.exercises), [
    'Knee-to-wall ankle stretch', 'Deep squat hold', '90/90 hip switches', 'T-spine extension over roller',
    'Pancake passive hold', 'Good morning pancake', 'Seated single-leg hamstring hinge',
    'Hip flexor ladder', 'L-sit'
  ]);
  assert.equal(s.exercises[0].routine, 'squat-block');
  assert.equal(s.exercises[4].routine, 'length-a');
  assert.equal(s.isDeload, false);
});

test('per-side work is one set per side', () => {
  const s = E.newSession('floor', [], '2026-09-28', 'x');
  const by = n => s.exercises.find(e => e.n === n);
  assert.equal(by('Knee-to-wall ankle stretch').sets.length, 4, '2 × 30 s per side');
  assert.equal(by('Couch stretch').sets.length, 2, '60 s per side');
  assert.equal(by('Hip flexor ladder').sets.length, 4);
});

test('a prescribed hold is one tap: the target is the dose', () => {
  const s = E.newSession('floor', [], '2026-09-28', 'x');
  const couch = s.exercises.find(e => e.n === 'Couch stretch');
  assert.deepEqual(couch.sets[0].target, { seconds: 60, src: 'dose' });
  assert.ok(E.confirmSet(couch, couch.sets[0], 'tick', 'now'));
  assert.equal(couch.sets[0].seconds, 60);
  assert.equal(couch.sets[0].state, 'done');
  const wrist = s.exercises.find(e => e.n === 'Wrist prep');
  assert.ok(E.confirmSet(wrist, wrist.sets[0], 'tick', 'now'));
  assert.equal(wrist.sets[0].rounds, 1);
});

test('a skill hold asks the first time, then targets last time’s typical hold', () => {
  const first = E.newSession('floor', [], '2026-09-28', 'x').exercises.find(e => e.n === 'Hip flexor ladder');
  assert.equal(first.sets[0].target, null, 'no invented number');
  assert.equal(E.canConfirm(first, first.sets[0]), false, 'so ✓ opens the sheet');

  const prev = { schemaVersion: 5, date: '2026-09-26', key: 'floor', name: 'Daily floor', isDeload: false, decisions: [],
    exercises: [{ n: 'Hip flexor ladder', kind: 'time', sets: [done(20), done(18), done(15), done(12, { warmup: true })] }] };
  const next = E.newSession('floor', [prev], '2026-09-28', 'x').exercises.find(e => e.n === 'Hip flexor ladder');
  assert.deepEqual(next.sets[0].target, { seconds: 18, src: 'last' }, 'median of working sets; the warm-up is ignored');
});

test('any session can add a routine, without doubling what is already there', () => {
  const lift = E.newSession('lower-a', [], '2026-09-26', 'x');
  const before = lift.exercises.length;
  const add = E.routineExercises(['length-a', 'hip-ladder'], [], lift.date, names(lift.exercises));
  assert.deepEqual(names(add), ['Pancake passive hold', 'Good morning pancake', 'Seated single-leg hamstring hinge', 'Hip flexor ladder']);
  lift.exercises.push(...add);
  assert.equal(lift.exercises.length, before + 4);
  const again = E.routineExercises(['hip-ladder', 'five-min'], [], lift.date, names(lift.exercises));
  assert.deepEqual(names(again), ['Deep squat hold', 'Couch stretch'], 'the ladder is already in');
});

test('floor work inside a lift session saves as done sets and adds no decisions', () => {
  const d = E.newSession('lower-a', [], '2026-09-26', '2026-09-26T09:00:00Z');
  d.exercises = E.routineExercises(['length-b'], [], d.date, []);
  for (const ex of d.exercises) for (const st of ex.sets) E.confirmSet(ex, st, 'tick', '2026-09-26T09:30:00Z');
  const r = E.finishSession(d, '2026-09-26T09:40:00Z');
  assert.ok(r.session, 'saved');
  assert.equal(r.session.decisions.length, 0);
  const couch = r.session.exercises.find(e => e.n === 'Couch stretch');
  assert.deepEqual(couch.sets.map(s => s.seconds), [60, 60]);
  assert.equal(couch.routine, 'length-b');
});

test('a date change keeps a prescribed hold’s target', () => {
  const d = E.newSession('floor', [], '2026-09-28', 'x');
  d.date = '2026-09-27';
  E.retarget(d, []);
  assert.deepEqual(d.exercises.find(e => e.n === 'Deep squat hold').sets[0].target, { seconds: 90, src: 'dose' });
});

test('every routine exercise uses a kind the app can log', () => {
  for (const r of Object.values(E.ROUTINES)) for (const e of r.ex) {
    assert.ok(['time', 'reps', 'rounds'].includes(e.kind), e.n);
    assert.ok(e.sets >= 1, e.n);
  }
});
