// Floor and stretching routines. Plain Node, no dependencies.
// Checks the routines against training/daily-floor.md and that they log the
// same way the lifts do: one tap records the prescription, nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine.js';

const names = xs => xs.map(e => e.n);
const done = (seconds, more = {}) => ({ seconds, warmup: false, state: 'done', doneAt: '2026-09-01T10:00:00Z', via: 'tick', target: null, ...more });

test('the daily floor week is gone: no floorFor, no FLOOR_WEEK, and floor is a legacy empty template', () => {
  assert.equal(E.floorFor, undefined);
  assert.equal(E.TEMPLATES.floor.legacy, true);
  assert.deepEqual(E.newSession('floor', [], '2026-09-29', 'x').exercises, []);
  assert.equal(E.isLiftKey('floor'), false);
});

test('the Skill day is built from compression, handstand and flexibility, tagged by routine, and is not a lift', () => {
  assert.deepEqual(E.SKILL_DAY, ['skill-compression', 'skill-handstand', 'skill-flex']);
  const s = E.newSession('skill', [], '2026-10-09', 'x');
  assert.deepEqual(names(s.exercises), [
    'Hip flexor ladder (working rung)', 'L-sit', 'Wrist prep', 'Wall handstand',
    'Pancake passive hold', 'Frog stretch', 'Couch stretch', 'Seated single-leg hamstring hinge'
  ]);
  assert.equal(s.exercises[0].routine, 'skill-compression');
  assert.equal(s.isDeload, false);
  assert.equal(E.newSession('skill', [], '2026-10-09', 'x', true).isDeload, false, 'a non-lift is never a deload');
  assert.equal(E.isLiftKey('skill'), false);
  assert.equal(E.TEMPLATES.skill.day, 'Optional');
  assert.deepEqual(E.weekPlan([], '2026-10-09').map(p => p.key), ['d1', 'd2', 'd3', 'd4'], 'the Skill day is not one of the four lifts');
  assert.deepEqual(E.sessionsInWeek([{ date: '2026-10-09', key: 'skill' }, { date: '2026-10-09', key: 'd2' }], '2026-10-05').map(h => h.key), ['d2']);
});

test('per-side work is one set per side', () => {
  const s = E.newSession('skill', [], '2026-10-09', 'x');
  const by = n => s.exercises.find(e => e.n === n);
  assert.equal(by('Couch stretch').sets.length, 2, '60 s per side');
  assert.equal(by('Seated single-leg hamstring hinge').sets.length, 2, '45 s per side');
  const d1 = E.newSession('d1', [], '2026-10-06', 'x');
  assert.equal(d1.exercises.find(e => e.n === 'Knee-to-wall ankle stretch').sets.length, 2, '30 s per side');
  assert.equal(d1.exercises.find(e => e.n === 'Adductor rocks').sets.length, 2, '8 per side');
});

test('a prescribed hold is one tap: the target is the dose', () => {
  const s = { exercises: E.routineExercises(['length-b', 'handstand'], [], '2026-09-28') };
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
  const first = E.routineExercises(['hip-ladder'], [], '2026-09-28').find(e => e.n === 'Hip flexor ladder');
  assert.equal(first.sets[0].target, null, 'no invented number');
  assert.equal(E.canConfirm(first, first.sets[0]), false, 'so ✓ opens the sheet');

  const prev = { schemaVersion: 5, date: '2026-09-26', key: 'floor', name: 'Daily floor', isDeload: false, decisions: [],
    exercises: [{ n: 'Hip flexor ladder', kind: 'time', sets: [done(20), done(18), done(15), done(12, { warmup: true })] }] };
  const next = E.routineExercises(['hip-ladder'], [prev], '2026-09-28').find(e => e.n === 'Hip flexor ladder');
  assert.deepEqual(next.sets[0].target, { seconds: 18, src: 'last' }, 'median of working sets; the warm-up is ignored');
});

test('any session can add a routine, without doubling what is already there', () => {
  const lift = E.newSession('lower-a', [], '2026-09-26', 'x'); // a legacy lift: any session can take a routine
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
  const d = { date: '2026-09-28', key: 'custom', exercises: E.routineExercises(['squat-block'], [], '2026-09-28') };
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
