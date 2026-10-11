// A programme as per-user data (release 1, S2/S3): the engine runs a supplied
// programme, and with none supplied runs Dan's plan exactly as before. Plus the
// profile programme's load/save against a fake Supabase. Fixtures are invented.
// node --test "tracker/dev/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine.js';
import { makeCloud } from '../cloud.js';
import { readFileSync } from 'node:fs';
import { project } from './coach-fixture.mjs';

/* An invented 4-day upper/lower. Two traps on purpose: 'Overhead press' and
   'Bench press (volume)' share their names with Dan's calibrated lifts, and one
   day's key is 'd1', Dan's Day 1. Neither may pull in the block. */
const RAW = () => ({
  id: 'gen-test-001', name: 'Test upper/lower', source: 'generated', perWeek: 4, createdAt: '2026-10-10T08:00:00Z',
  answers: { days: 4, experience: 'some' },
  days: [
    { key: 'upper-a', name: 'Upper A', ex: [
      { n: 'Overhead press', kind: 'weight', sets: 3, rep: [6, 8], rir: 2, inc: 2.5, rest: 150, bar: 20, key: true, cal: true, heavy: true, topRir: 1 },
      { n: 'Lat pulldown', kind: 'weight', sets: 3, rep: [8, 12], rir: 2, inc: 5, rest: 120 },
      { n: 'Push-up', kind: 'weight', load: 'bw', sets: 3, rep: [8, 15], rir: 2, rest: 90, seed: { reps: 8 } }
    ] },
    { key: 'lower-a', name: 'Lower A', ex: [
      { n: 'Goblet squat', kind: 'weight', sets: 3, rep: [8, 12], rir: 2, inc: 2, rest: 120 },
      { n: 'Plank', kind: 'time', sets: 2, dose: 30, rest: 60 }
    ] },
    { key: 'd1', name: 'Upper B', ex: [
      { n: 'Bench press (volume)', kind: 'weight', sets: 3, rep: [8, 10], rir: 2, inc: 2.5, rest: 150, bar: 20, key: true, wk1: true }
    ] },
    { key: 'lower-b', name: 'Lower B', ex: [
      { n: 'Romanian deadlift', kind: 'weight', sets: 3, rep: [8, 10], rir: 2, inc: 2.5, rest: 150, bar: 20, key: true }
    ] }
  ]
});
const PROG = E.normaliseProgramme(RAW());

const W = (kg, reps, rir = null) => ({ kg, reps, rir, warmup: false, state: 'done', doneAt: '2026-10-06T10:00:00Z', via: 'tick', target: null });
const X = (n, sets, more = {}) => ({ n, kind: 'weight', load: 'kg', targetSets: sets.length, sets, ...more });
const G = (date, day, exercises = [], more = {}) => ({ schemaVersion: 5, date, key: 'g-' + day, name: day, programmeId: PROG.id, isDeload: false, exercises, decisions: [], savedAt: date + 'T18:00:00Z', ...more });
const newest = (...s) => s.sort((a, b) => (a.date < b.date ? 1 : -1));
const ex = (s, n) => s.exercises.find(e => e.n === n);
const NOW = d => d + 'T09:00:00Z';

/* ------------------------------------------------------------ the shape */
test('normaliseProgramme strips the block-only flags and fills the defaults', () => {
  const p = E.normaliseProgramme({ ...RAW(), perWeek: undefined, source: undefined });
  assert.equal(p.v, 1);
  assert.equal(p.source, 'generated');
  assert.equal(p.perWeek, 4, 'perWeek defaults to the number of days');
  assert.equal(p.deloadEvery, null);
  assert.deepEqual(p.answers, { days: 4, experience: 'some' });
  const ohp = p.days[0].ex[0];
  for (const k of ['cal', 'heavy', 'topRir']) assert.equal(k in ohp, false, k);
  assert.equal('wk1' in p.days[2].ex[0], false);
  assert.equal(ohp.key, true, 'main-lift flag is kept (D1, deload set count)');
  assert.equal(p.days[1].ex[0].load, 'kg', 'weight gets a load type');
  assert.equal('load' in p.days[1].ex[1], false);
  assert.equal(RAW().days[0].ex[0].cal, true, 'the input is not mutated');
});

test('normaliseProgramme refuses what the engine cannot run', () => {
  const bad = (f, re) => { const p = RAW(); f(p); assert.throws(() => E.normaliseProgramme(p), re); };
  bad(p => { p.id = ''; }, /id/);
  bad(p => { p.days = []; }, /days/);
  bad(p => { p.days[1].key = 'upper-a'; }, /duplicate/);
  bad(p => { p.days[0].key = 'Upper A'; }, /key/);
  bad(p => { delete p.days[0].ex[1].rir; }, /rep and rir/);
  bad(p => { p.days[0].ex[1].rep = [12, 8]; }, /rep/);
  bad(p => { p.days[0].ex[1].kind = 'cardio'; }, /kind/);
  bad(p => { p.days[0].ex.push({ ...p.days[0].ex[1] }); }, /twice/);
  bad(p => { p.perWeek = 9; }, /perWeek/);
  bad(p => { p.deloadEvery = 1; }, /deloadEvery/);
  assert.equal(E.activeProgramme({ programme: { id: 'x', days: 'no' } }), null);
  assert.equal(E.activeProgramme({}), null);
  assert.deepEqual(E.activeProgramme({ programme: RAW() }), PROG);
});

/* ------------------------------------------------- today's session, targets */
test('a programme session in Dan\'s block week 1 is plain: no ramp, no pre-block, no block fields', () => {
  const s = E.newSession('g-upper-a', [], '2026-10-06', NOW('2026-10-06'), false, PROG);
  assert.equal(s.key, 'g-upper-a');
  assert.equal(s.name, 'Upper A');
  assert.equal(s.programmeId, PROG.id);
  assert.equal(s.schemaVersion, 5);
  assert.equal('blockWeek' in s, false);
  assert.equal('phase' in s, false);
  assert.deepEqual(s.exercises.map(e => e.n), ['Overhead press', 'Lat pulldown', 'Push-up'], 'no pre-session block');
  const ohp = ex(s, 'Overhead press');
  assert.equal(ohp.cal, undefined, 'never a week-1 ramp, though Dan\'s Overhead press is one');
  assert.equal(ohp.sets.length, 3);
  assert.deepEqual(ohp.rep, [6, 8]);
  assert.equal(ohp.sets[0].target, null, 'first time: ✓ asks for the numbers');
  assert.deepEqual(ex(s, 'Push-up').sets[0].target, { reps: 8, src: 'seed' }, 'or the seed');
});

test('a day keyed d1 never resolves to Dan\'s Day 1', () => {
  const s = E.newSession('g-d1', [], '2026-10-06', NOW('2026-10-06'), false, PROG);
  assert.equal(s.name, 'Upper B');
  assert.deepEqual(s.exercises.map(e => e.n), ['Bench press (volume)']);
  const b = s.exercises[0];
  assert.equal(b.cal, undefined);
  assert.deepEqual(b.rep, [8, 10]);
  assert.equal(b.sets.length, 3);
  assert.throws(() => E.newSession('g-nope', [], '2026-10-06', NOW('2026-10-06'), false, PROG), /no programme day/);
  assert.throws(() => E.newSession('g-d1', [], '2026-10-06', NOW('2026-10-06'), false, null), /no programme day/);
});

test('progression is plain double progression from the range and RIR, also across Dan\'s phase dates', () => {
  const H = newest(G('2026-10-13', 'upper-a', [
    X('Overhead press', [W(40, 8, 2), W(40, 8, 2), W(40, 8, 2)]),
    X('Lat pulldown', [W(50, 7, 1), W(50, 7, 1), W(50, 9, 1)])
  ]));
  /* 2026-11-17 is Dan's phase 2: a heavy lift there would get RP and back-offs. */
  for (const date of ['2026-10-16', '2026-11-17']) {
    const s = E.newSession('g-upper-a', H, date, NOW(date), false, PROG);
    const o = ex(s, 'Overhead press');
    assert.equal(o.rec.rule, 'R1', date);
    assert.deepEqual(o.sets.map(x => x.target), [{ kg: 42.5, reps: 6 }, { kg: 42.5, reps: 6 }, { kg: 42.5, reps: 6 }], date);
    assert.equal(o.backoff, undefined);
    assert.equal(ex(s, 'Lat pulldown').rec.rule, 'R4', 'two sets below the range: hold at the bottom');
  }
  const H2 = newest(G('2026-10-13', 'upper-a', [X('Overhead press', [W(40, 8, 2), W(40, 7, 2), W(40, 6, 2)])]));
  const r3 = ex(E.newSession('g-upper-a', H2, '2026-10-16', NOW('2026-10-16'), false, PROG), 'Overhead press');
  assert.equal(r3.rec.rule, 'R3');
  assert.deepEqual(r3.sets[0].target, { kg: 40, reps: 7 });
});

test('last time is by exercise name, across programmes and Dan\'s own sessions', () => {
  /* A session from another programme (or Dan's d3) is still last time. */
  const H = newest({ schemaVersion: 5, date: '2026-10-10', key: 'd3', name: 'Day 3', isDeload: false, decisions: [],
    exercises: [X('Overhead press', [W(45, 8, 2), W(45, 8, 2), W(45, 8, 2)])] });
  const o = ex(E.newSession('g-upper-a', H, '2026-10-14', NOW('2026-10-14'), false, PROG), 'Overhead press');
  assert.equal(o.rec.rule, 'R1');
  assert.equal(o.sets[0].target.kg, 47.5);
});

test('a deload of a programme session is 65% at the bottom, sets not halved, no block week', () => {
  const H = newest(G('2026-10-13', 'upper-a', [X('Lat pulldown', [W(60, 10, 2), W(60, 10, 2), W(60, 10, 2)])]));
  const s = E.newSession('g-upper-a', H, '2026-11-10', NOW('2026-11-10'), true, PROG);
  assert.equal(s.isDeload, true);
  const l = ex(s, 'Lat pulldown');
  assert.equal(l.rec.rule, 'R6');
  assert.deepEqual(l.sets[0].target, { kg: 40, reps: 8 });
  assert.equal(l.sets.length, 3);
});

test('retarget and finish keep a programme session out of the block, with or without the programme to hand', () => {
  const H = newest(G('2026-10-13', 'd1', [X('Bench press (volume)', [W(60, 10, 2), W(60, 10, 2), W(60, 10, 2)])]));
  const s = E.newSession('g-d1', [], '2026-10-06', NOW('2026-10-06'), false, PROG);
  s.date = '2026-10-16';
  for (const p of [PROG, null]) {
    const d = E.retarget(E.clone(s), H, p);
    const b = d.exercises[0];
    assert.equal(b.cal, undefined);
    assert.equal(b.rec.rule, 'R1');
    assert.deepEqual(b.sets[0].target, { kg: 62.5, reps: 8 });
  }
  const d = E.retarget(E.clone(s), H, PROG);
  for (const st of d.exercises[0].sets) E.confirmSet(d.exercises[0], st, 'tick', '2026-10-16T10:00:00Z');
  const fin = E.finishSession(d, '2026-10-16T10:30:00Z').session;
  assert.equal(fin.programmeId, PROG.id);
  assert.equal(fin.key, 'g-d1');
  assert.equal('blockWeek' in fin, false);
  assert.equal('phase' in fin, false);
  assert.equal(fin.schemaVersion, 5);
  assert.equal(E.planSave({}, fin, [], [], 'training/log', '2026-10-16T10:30:00Z').session.file, 'training/log/2026-10-16-g-d1.json');
  assert.equal(E.isLiftKey('g-d1'), true);
  assert.equal(E.isLegacyKey('g-d1'), false);
});

/* ---------------------------------------------------- next session, the week */
test('next session is the next day in rotation after the last one done from this programme', () => {
  assert.equal(E.programmeWeek(PROG, [], '2026-10-12').next, 'g-upper-a', 'nothing done: the first day');
  assert.equal(E.programmeWeek(PROG, [G('2026-10-12', 'upper-a')], '2026-10-12').next, 'g-lower-a');
  assert.equal(E.programmeWeek(PROG, [G('2026-10-12', 'upper-a'), G('2026-10-14', 'd1')], '2026-10-15').next, 'g-lower-b');
  const w = E.programmeWeek(PROG, [G('2026-10-12', 'upper-a'), G('2026-10-14', 'lower-b')], '2026-10-15');
  assert.equal(w.next, 'g-upper-a', 'wraps round');
  assert.equal(w.nextName, 'Upper A');
  assert.deepEqual(w.last, { key: 'g-lower-b', date: '2026-10-14' });
  assert.deepEqual(w.days.map(d => [d.key, d.next]), [['g-upper-a', true], ['g-lower-a', false], ['g-d1', false], ['g-lower-b', false]]);
  /* Out of order is fine: the rotation follows what was actually done. */
  assert.equal(E.programmeWeek(PROG, [G('2026-10-12', 'd1')], '2026-10-12').next, 'g-lower-b');
  /* Two on one day: the later save decides. */
  assert.equal(E.programmeWeek(PROG, [G('2026-10-12', 'lower-a', [], { savedAt: '2026-10-12T19:00:00Z' }), G('2026-10-12', 'upper-a')], '2026-10-12').next, 'g-d1');
});

test('rotation ignores other programmes, deleted sessions and days no longer in the programme', () => {
  const other = G('2026-10-14', 'lower-a', [], { programmeId: 'old-programme' });
  assert.equal(E.programmeWeek(PROG, [G('2026-10-12', 'upper-a'), other], '2026-10-15').next, 'g-lower-a');
  assert.equal(E.programmeWeek(PROG, [G('2026-10-12', 'upper-a'), G('2026-10-14', 'lower-a', [], { deleted: true })], '2026-10-15').next, 'g-lower-a');
  assert.equal(E.programmeWeek(PROG, [G('2026-10-12', 'gone')], '2026-10-15').next, 'g-upper-a');
  /* A new programme (new id) starts at its first day. */
  const p2 = E.normaliseProgramme({ ...RAW(), id: 'gen-test-002' });
  assert.equal(E.programmeWeek(p2, [G('2026-10-12', 'upper-a')], '2026-10-15').next, 'g-upper-a');
});

test('the weekly count is lift sessions this ISO week against perWeek', () => {
  const list = [
    G('2026-10-09', 'upper-a'),                                         // last week
    G('2026-10-12', 'lower-a'), G('2026-10-13', 'd1', [], { isDeload: true }),
    G('2026-10-14', 'lower-b', [], { programmeId: 'old-programme' }),   // another programme still counts
    { schemaVersion: 5, date: '2026-10-14', key: 'skill', name: 'Skill day', exercises: [] },
    { schemaVersion: 5, date: '2026-10-14', key: 'custom', name: 'Custom', exercises: [] },
    G('2026-10-15', 'upper-a', [], { deleted: true })
  ];
  const w = E.programmeWeek(PROG, list, '2026-10-15');
  assert.equal(w.done, 3);
  assert.equal(w.target, 4);
  assert.equal(w.doneToday, false);
  assert.equal(E.programmeWeek(PROG, list, '2026-10-14').doneToday, true);
  const three = E.normaliseProgramme({ ...RAW(), perWeek: 3 });
  assert.equal(E.programmeWeek(three, list, '2026-10-15').target, 3);
});

/* ---------------------------------------------------------------- deloads */
test('a programme has no block deload weeks; deloadEvery sets a cadence; D5 reads perWeek', () => {
  const lifts = [G('2026-11-03', 'upper-a'), G('2026-10-20', 'lower-a'), G('2026-10-13', 'd1'), G('2026-10-06', 'lower-b')];
  /* 2026-11-10 is Dan's block week 6. */
  assert.ok(E.deloadCheck(lifts, [], E.DEFAULTS.settings, '2026-11-10').codes.some(c => c.c === 'BLOCK'), 'Dan: scheduled');
  const r = E.deloadCheck(lifts, [], E.DEFAULTS.settings, '2026-11-10', PROG);
  assert.equal(r.codes.some(c => c.c === 'BLOCK' || c.c === 'CADENCE'), false);
  assert.equal(r.fire, false);
  const every4 = E.normaliseProgramme({ ...RAW(), deloadEvery: 4 });
  const c = E.deloadCheck(lifts, [], E.DEFAULTS.settings, '2026-11-10', every4).codes.find(x => x.c === 'CADENCE');
  assert.ok(c, 'five weeks since the first session, cadence 4');
  assert.match(c.t, /every 4/);
  const three = E.normaliseProgramme({ ...RAW(), perWeek: 3 });
  const d5 = E.deloadCheck(lifts, [], E.DEFAULTS.settings, '2026-11-04', three).codes.find(x => x.c === 'D5');
  assert.ok(d5);
  assert.match(d5.t, /1 of 3/);
});

test('D1 reads the programme\'s main lifts', () => {
  const rdl = kg => X('Romanian deadlift', [W(kg, 8, 2), W(kg, 8, 2), W(kg, 8, 2)]);
  const gs = kg => X('Goblet squat', [W(kg, 8, 2), W(kg, 8, 2), W(kg, 8, 2)]);
  const H = newest(...['2026-10-02', '2026-10-05', '2026-10-08', '2026-10-11', '2026-10-14', '2026-10-17'].map((d, i) =>
    G(d, 'lower-b', [rdl(i < 3 ? 100 : 80), gs(i < 3 ? 30 : 20)])));
  const p = E.normaliseProgramme({ ...RAW(), days: RAW().days.map(d => d.key === 'lower-a' ? { ...d, ex: d.ex.map(e => e.n === 'Goblet squat' ? { ...e, key: true } : e) } : d) });
  const r = E.deloadCheck(H, [], E.DEFAULTS.settings, '2026-10-18', p);
  assert.ok(r.codes.find(c => c.c === 'D1'), 'two programme main lifts regressed');
  assert.equal(E.deloadCheck(H, [], E.DEFAULTS.settings, '2026-10-18', PROG).codes.some(c => c.c === 'D1'), false, 'goblet squat is not a main lift in PROG');
});

/* ------------------------------------------------- no programme: Dan as before */
test('no programme: the coach plan decides exactly what build 5-9 decided (frozen fixture, invented sessions)', () => {
  /* fixtures/coach-plan-5-9.json was written by the build 5-9 engine
     (git show 5aede14:tracker/engine.js) from coach-fixture.mjs's invented
     history: targets, rules, ramp and back-off flags, block fields, deload
     codes and the week plan, over 6 dates x 6 sessions x deload on/off. */
  const want = JSON.parse(readFileSync(new URL('./fixtures/coach-plan-5-9.json', import.meta.url), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(project(E))), want);
  /* The same with the programme argument passed explicitly as null. */
  const withNull = { ...E,
    newSession: (k, h, d, n, dl) => E.newSession(k, h, d, n, dl, null),
    retarget: (d, h) => E.retarget(d, h, null),
    deloadCheck: (h, bw, s, t) => E.deloadCheck(h, bw, s, t, null) };
  assert.deepEqual(JSON.parse(JSON.stringify(project(withNull))), want);
  for (const k of Object.keys(E.TEMPLATES)) assert.equal('programmeId' in E.newSession(k, [], '2026-10-13', NOW('2026-10-13'), false), false, k);
  /* Spot checks of Dan's block behaviour that a programme must not have. */
  const d3 = E.newSession('d3', [], '2026-10-10', NOW('2026-10-10'), false);
  assert.equal(ex(d3, 'Overhead press').cal, 'ramp');
  assert.equal(d3.blockWeek, 1);
  assert.equal(d3.exercises[0].routine, 'pre-core');
  const H = newest({ schemaVersion: 5, date: '2026-10-06', key: 'd1', name: 'Day 1', isDeload: false, decisions: [],
    exercises: [X('High-bar back squat (volume)', [W(80, 8, 2)], { cal: 'ramp' })] });
  const d1 = E.newSession('d1', H, '2026-10-13', NOW('2026-10-13'), false);
  assert.equal(ex(d1, 'High-bar back squat (volume)').rec.rule, 'RC');
  assert.equal(E.nextTemplate(E.weekPlan([], '2026-10-13')), 'd1');
});

test('Dan\'s exercises still resolve to his templates when a programme shares their names', () => {
  /* tplOf on a d3 session: Dan's Overhead press, calibrated. */
  assert.equal(E.tplOf({ n: 'Overhead press', kind: 'weight', rep: [5, 5] }, 'd3').cal, true);
  /* The same name in a programme session: the programme's, plain. */
  const t = E.tplOf({ n: 'Overhead press', kind: 'weight', rep: [6, 8] }, 'g-upper-a', PROG);
  assert.equal(t.cal, false);
  assert.equal(t.heavy, false);
  assert.equal(E.tplOf({ n: 'Push-up', kind: 'weight', load: 'bw' }, 'g-upper-a', PROG).seed.reps, 8);
  /* Routines added by hand still find their dose in a programme session. */
  assert.equal(E.tplOf({ n: 'Couch stretch', kind: 'time' }, 'g-upper-a', PROG).dose, 60);
});

/* ------------------------------------------- profile programme, fake Supabase */
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => { if (body === undefined) throw new Error('no body'); return body; } });
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = sub => 'h.' + b64u({ sub, role: 'authenticated' }) + '.sig';
const USER = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000b';
const T0 = Date.UTC(2026, 9, 11, 12, 0, 0);
/* What setProgramme stores: the programme stamped with when it was saved. */
const STAMP = { ...PROG, updatedAt: new Date(T0).toISOString() };
const signedIn = (sub = USER) => ({ access_token: jwt(sub), refresh_token: 'rt-1', expires_at: Math.floor(T0 / 1000) + 3600, user: { id: sub, email: 'tester@example.com' } });

function fakeProfiles({ row = null, postStatus = 201, getStatus = 200, delay = 0 } = {}) {
  const calls = [];
  const db = { row: row ? JSON.parse(JSON.stringify(row)) : null };
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (delay) await new Promise(r => setTimeout(r, delay));
    const u = new URL(url), method = init.method || 'GET';
    if (u.pathname !== '/rest/v1/profiles') return res(404, { message: 'no route' });
    if (method === 'GET') return getStatus === 200 ? res(200, db.row ? [{ programme_key: db.row.programme_key, settings: db.row.settings }] : []) : res(getStatus, { message: 'fail' });
    const st = typeof postStatus === 'function' ? postStatus() : postStatus;
    if (st < 300) { const [r] = JSON.parse(init.body); db.row = { ...(db.row || {}), ...r }; }
    return res(st, st < 300 ? undefined : { message: 'fail', code: 'XX000' });
  };
  return { fetch, calls, db, posts: () => calls.filter(c => c.init.method === 'POST') };
}
function setup(sb, state = {}) {
  const S = { settings: {}, queue: [], history: [], cloudQueue: [], cloud: signedIn(), cloudOwner: { id: USER, email: 'tester@example.com' }, ...state };
  const cloud = makeCloud({ fetch: sb.fetch, getState: () => S, save: () => {}, now: () => T0, checkProgramme: E.normaliseProgramme });
  return { S, cloud };
}

test('pullProgramme reads settings.programme from the user\'s profile row, checks it and caches it', async () => {
  const sb = fakeProfiles({ row: { id: USER, programme_key: 'gen-test-001', settings: { other: 1, programme: RAW() } } });
  const { S, cloud } = setup(sb);
  const p = await cloud.pullProgramme();
  assert.deepEqual(p, PROG);
  assert.deepEqual(S.programme, PROG, 'cached on the phone, block flags stripped');
  const c = sb.calls[0];
  assert.equal(c.url, 'https://widuygqbkpyerqhgbvos.supabase.co/rest/v1/profiles?select=programme_key,settings&id=eq.' + USER);
  assert.equal(c.init.headers.Authorization, 'Bearer ' + jwt(USER));
  assert.deepEqual(E.activeProgramme(S), PROG);
});

test('pullProgramme: no programme in the account drops a clean cached copy and keeps only this user\'s held change; a held change is not overwritten; a bad one is not cached', async () => {
  const mine = E.normaliseProgramme({ ...RAW(), id: 'local-1' });
  for (const row of [null, { id: USER, settings: {} }]) {
    const clean = setup(fakeProfiles({ row }), { programme: mine });
    assert.equal(await clean.cloud.pullProgramme(), null);
    assert.equal(clean.S.programme, undefined, 'a clean copy the account does not have is dropped');
    const held = setup(fakeProfiles({ row }), { programme: mine, programmeDirty: true, programmeOwner: USER });
    assert.equal(await held.cloud.pullProgramme(), null);
    assert.equal(held.S.programme, mine, 'this user\'s held change waits to go up');
    const theirs = setup(fakeProfiles({ row }), { programme: mine, programmeDirty: true, programmeOwner: OTHER });
    await theirs.cloud.pullProgramme();
    assert.equal(theirs.S.programme, undefined, 'someone else\'s held change is dropped, never kept for this user');
    assert.equal('programmeDirty' in theirs.S, false);
  }
  const { S, cloud } = setup(fakeProfiles({ row: { id: USER, settings: { programme: RAW() } } }), { programme: mine, programmeDirty: true });
  await cloud.pullProgramme();
  assert.equal(S.programme, mine, 'the local change waits to go up');
  const bad = setup(fakeProfiles({ row: { id: USER, settings: { programme: { id: 'x', days: [] } } } }), { programme: mine });
  await assert.rejects(bad.cloud.pullProgramme(), /programme: days/);
  assert.equal(bad.S.programme, mine);
});

test('a profile marked programme_key coach (Dan) sets S.coach and never yields a programme', async () => {
  const { S, cloud } = setup(fakeProfiles({ row: { id: USER, programme_key: 'coach', settings: {} } }));
  assert.equal(await cloud.pullProgramme(), null);
  assert.equal(S.coach, true);
  assert.equal(S.programme, undefined);
  const plain = setup(fakeProfiles({ row: { id: USER, programme_key: null, settings: {} } }));
  await plain.cloud.pullProgramme();
  assert.equal(plain.S.coach, undefined);
});

test('setProgramme caches at once and upserts the row, keeping the other settings keys', async () => {
  const sb = fakeProfiles({ row: { id: USER, programme_key: null, settings: { theme: 'dark' } } });
  const { S, cloud } = setup(sb);
  assert.equal(await cloud.setProgramme(RAW()), true);
  assert.deepEqual(S.programme, STAMP);
  assert.equal('programmeDirty' in S, false);
  const [post] = sb.posts();
  assert.equal(post.url, 'https://widuygqbkpyerqhgbvos.supabase.co/rest/v1/profiles?on_conflict=id');
  assert.equal(post.init.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
  assert.deepEqual(JSON.parse(post.init.body), [{ id: USER, programme_key: 'gen-test-001', settings: { theme: 'dark', programme: STAMP } }]);
  assert.deepEqual(sb.db.row.settings, { theme: 'dark', programme: STAMP });
});

test('setProgramme with no row yet creates it', async () => {
  const sb = fakeProfiles({ row: null });
  const { cloud } = setup(sb);
  assert.equal(await cloud.setProgramme(RAW()), true);
  assert.deepEqual(JSON.parse(sb.posts()[0].init.body)[0].settings, { programme: STAMP });
});

test('a failed save, signed out or another account holds the programme on the phone; sync sends it later', async () => {
  let st = 500;
  const sb = fakeProfiles({ postStatus: () => st });
  const { S, cloud } = setup(sb);
  assert.equal(await cloud.setProgramme(RAW()), false);
  assert.deepEqual(S.programme, STAMP, 'the engine can use it at once');
  assert.equal(S.programmeDirty, true);
  assert.equal(cloud.lastError().status, 500);
  st = 201;
  assert.deepEqual(await cloud.syncProgramme(), STAMP);
  assert.equal('programmeDirty' in S, false);
  assert.deepEqual(sb.db.row.settings.programme, STAMP);

  const out = fakeProfiles();
  const o = setup(out, { cloud: { signedOut: true, lastUserId: USER } });
  assert.equal(await o.cloud.setProgramme(RAW()), false);
  assert.equal(out.calls.length, 0, 'nothing sent while signed out');
  assert.equal(o.S.programmeDirty, true);

  const fr = fakeProfiles();
  const f = setup(fr, { cloud: signedIn(OTHER) });
  assert.equal(await f.cloud.setProgramme(RAW()), false);
  assert.equal(fr.calls.length, 0, 'never written to another account\'s profile');
  assert.equal(f.cloud.lastError().code, 'foreign');
});

test('syncProgramme pulls when nothing is held; an invalid programme is refused before anything is stored', async () => {
  const sb = fakeProfiles({ row: { id: USER, settings: { programme: RAW() } } });
  const { S, cloud } = setup(sb);
  assert.deepEqual(await cloud.syncProgramme(), PROG);
  assert.equal(sb.posts().length, 0);
  await assert.rejects(cloud.setProgramme({ id: 'x' }), /programme/);
  assert.deepEqual(S.programme, PROG);
});

test('two saves in a row: the newest programme is the last one sent', async () => {
  const sb = fakeProfiles({ delay: 5 });
  const { S, cloud } = setup(sb);
  const second = { ...RAW(), id: 'gen-test-002' };
  const a = cloud.setProgramme(RAW()), b = cloud.setProgramme(second);
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  const posts = sb.posts().map(p => JSON.parse(p.init.body)[0].programme_key);
  assert.equal(posts[posts.length - 1], 'gen-test-002');
  assert.equal(sb.db.row.programme_key, 'gen-test-002');
  assert.equal(S.programme.id, 'gen-test-002');
  assert.equal('programmeDirty' in S, false);
});

/* ------------------------------------- QA round (build 5-12): accounts, devices */
/* A fake Supabase with sign-in and one profile row per user. Emails map to
   invented user ids. offline: every request fails as no network. */
const IDS = { 'a@example.com': USER, 'b@example.com': OTHER, 'coach@example.com': '00000000-0000-4000-8000-0000000000cc' };
function fakeAccounts(rows = {}) {
  const calls = [], db = JSON.parse(JSON.stringify(rows));
  const box = { offline: false };
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (box.offline) throw new TypeError('Failed to fetch');
    const u = new URL(url), method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    if (u.pathname === '/auth/v1/verify') {
      const id = IDS[body.email];
      return res(200, { access_token: jwt(id), refresh_token: 'rt-' + id, expires_at: Math.floor(T0 / 1000) + 3600, user: { id, email: body.email } });
    }
    if (u.pathname === '/rest/v1/profiles') {
      if (method === 'GET') { const id = u.searchParams.get('id').replace(/^eq\./, ''); return res(200, db[id] ? [db[id]] : []); }
      for (const r of body) db[r.id] = { ...(db[r.id] || {}), ...r };
      return res(201);
    }
    return res(404, {});
  };
  return { fetch, calls, db, box, postsTo: id => calls.filter(c => c.url.includes('/rest/v1/profiles') && c.init.method === 'POST' && JSON.parse(c.init.body)[0].id === id) };
}
function phone(sb) {
  const S = { settings: {}, queue: [], history: [], cloudQueue: [], cloud: null };
  const cloud = makeCloud({ fetch: sb.fetch, getState: () => S, save: () => {}, now: () => T0, checkProgramme: E.normaliseProgramme });
  return { S, cloud };
}

test('A builds a programme offline, signs out, B signs in: B sees nothing of A\'s and nothing of A\'s reaches B\'s row', async () => {
  const sb = fakeAccounts();
  const { S, cloud } = phone(sb);
  await cloud.verifyCode('a@example.com', '111111');
  S.onboard = { step: 3, answers: { days: 3, pain: ['back'] } };
  sb.box.offline = true;
  assert.equal(await cloud.setProgramme(RAW()), false, 'held: no network');
  assert.equal(S.programmeDirty, true);
  assert.equal(S.programmeOwner, USER);
  sb.box.offline = false;
  cloud.signOut();
  for (const k of ['programme', 'programmeDirty', 'programmeOwner', 'coach', 'onboard', 'signin']) assert.equal(k in S, false, k + ' cleared on sign-out');
  await cloud.verifyCode('b@example.com', '222222');
  assert.equal(await cloud.pullProgramme(), null);
  assert.equal(S.programme, undefined);
  assert.equal(await cloud.syncProgramme(), null);
  assert.deepEqual(sb.postsTo(OTHER), [], 'nothing pushed to B\'s row');
  assert.equal(sb.db[OTHER], undefined);
});

test('a different account taking the phone over (no explicit sign-out) also forgets the last one\'s programme', async () => {
  const sb = fakeAccounts();
  const { S, cloud } = phone(sb);
  await cloud.verifyCode('a@example.com', '111111');
  sb.box.offline = true;
  await cloud.setProgramme(RAW());
  sb.box.offline = false;
  /* B signs in over A on an empty phone: B becomes the owner. */
  await cloud.verifyCode('b@example.com', '222222');
  assert.equal(S.cloudOwner.id, OTHER);
  assert.equal(S.programme, undefined);
  assert.equal(await cloud.syncProgramme(), null);
  assert.deepEqual(sb.postsTo(OTHER), []);
});

test('a programme cached for another user is never sent to this user\'s row', async () => {
  const sb = fakeAccounts();
  const { S, cloud } = phone(sb);
  await cloud.verifyCode('b@example.com', '222222');
  S.programme = PROG; S.programmeDirty = true; S.programmeOwner = USER;     // A's, somehow still here
  await assert.rejects(cloud.pushProgramme(), e => e.code === 'foreign');
  assert.deepEqual(sb.postsTo(OTHER), []);
  /* A pull for B drops it. */
  await cloud.pullProgramme();
  assert.equal(S.programme, undefined);
});

test('coach account, then a friend on the same phone: the friend gets no coach flag (re-derived on every pull)', async () => {
  const coachId = IDS['coach@example.com'];
  const sb = fakeAccounts({ [coachId]: { id: coachId, programme_key: 'coach', settings: {} } });
  const { S, cloud } = phone(sb);
  await cloud.verifyCode('coach@example.com', '333333');
  await cloud.pullProgramme();
  assert.equal(S.coach, true);
  cloud.signOut();
  assert.equal('coach' in S, false);
  await cloud.verifyCode('b@example.com', '222222');
  assert.equal(await cloud.pullProgramme(), null);
  assert.equal('coach' in S, false, 'the friend gets the questions, not the coach app');
  /* And the flag follows the row: a coach row that later holds a programme stops being coach. */
  const two = fakeAccounts({ [USER]: { id: USER, programme_key: 'coach', settings: {} } });
  const p2 = phone(two);
  await p2.cloud.verifyCode('a@example.com', '1');
  await p2.cloud.pullProgramme();
  assert.equal(p2.S.coach, true);
  two.db[USER] = { id: USER, programme_key: 'gen-test-001', settings: { programme: RAW() } };
  await p2.cloud.pullProgramme();
  assert.equal('coach' in p2.S, false);
});

test('two phones: a newer programme in the account is kept over this phone\'s older held change, and the other way round', async () => {
  const newerThere = { ...RAW(), id: 'gen-other-phone', updatedAt: '2026-10-11T13:00:00.000Z' };
  const sb = fakeAccounts({ [USER]: { id: USER, programme_key: 'gen-other-phone', settings: { programme: newerThere } } });
  const { S, cloud } = phone(sb);
  await cloud.verifyCode('a@example.com', '1');
  /* This phone's change was made at T0 (12:00), before the other phone's 13:00 save. */
  S.programme = STAMP; S.programmeDirty = true; S.programmeOwner = USER;
  assert.equal(await cloud.pushProgramme(), true);
  assert.deepEqual(sb.postsTo(USER), [], 'the newer one is not overwritten');
  assert.equal(S.programme.id, 'gen-other-phone');
  assert.equal('programmeDirty' in S, false);
  assert.equal(cloud.lastError().code, 'superseded');
  /* A pull with a held older change adopts the newer one too. */
  S.programme = STAMP; S.programmeDirty = true;
  await cloud.pullProgramme();
  assert.equal(S.programme.id, 'gen-other-phone');
  /* This phone's change is the newer one: it goes up. */
  const later = { ...STAMP, id: 'gen-this-phone', updatedAt: '2026-10-11T14:00:00.000Z' };
  S.programme = later; S.programmeDirty = true;
  await cloud.pullProgramme();
  assert.equal(S.programme.id, 'gen-this-phone', 'a held newer change is kept on pull');
  assert.equal(await cloud.pushProgramme(), true);
  assert.equal(sb.db[USER].programme_key, 'gen-this-phone');
  assert.equal(sb.db[USER].settings.programme.updatedAt, '2026-10-11T14:00:00.000Z');
});
