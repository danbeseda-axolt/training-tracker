// The programme generator (programme.js) against the trainer's library
// (library.js): the three hand-walked profiles, an exhaustive safety loop over
// every answer combination, swaps, and the engine running what it builds.
// node --test "tracker/dev/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../library.js';
import * as G from '../programme.js';
import * as E from '../engine.js';

const names = d => d.ex.map(e => e.n);
const day = (p, k) => p.days.find(d => d.key === k);
const byId = new Map(L.EXERCISES.map(e => [e.id, e]));
const PAINS = [[], ['back'], ['knees'], ['shoulders'], ['back', 'knees'], ['back', 'shoulders'], ['knees', 'shoulders'], ['back', 'knees', 'shoulders']];

/* ----------------------------------------------- the three walked profiles */
test('profile 1: 3 days, full gym, new, nothing hurts, 60 min', () => {
  const p = G.generate({ days: 3, place: 'gym', level: 'new', pain: [], minutes: 60 }, L);
  assert.equal(p.name, '3 days a week · full body');
  assert.equal(p.perWeek, 3);
  assert.equal(p.source, 'generated');
  assert.equal(p.deloadEvery, null);
  assert.deepEqual(p.days.map(d => d.name), ['Full body A', 'Full body B', 'Full body C']);
  assert.deepEqual(names(p.days[0]), ['Goblet squat', 'Chest press machine', 'Seated cable row', 'Dumbbell hip thrust', 'Dead bug']);
  assert.deepEqual(names(p.days[1]), ['Dumbbell Romanian deadlift', 'Seated dumbbell shoulder press', 'Lat pulldown', 'Reverse lunge', 'Farmer carry']);
  assert.deepEqual(names(p.days[2]), ['Goblet squat', 'Lat pulldown', 'Dumbbell bench press', 'Chest-supported dumbbell row', 'Bird dog', 'Standing calf raise']);
  /* Main slots of one pattern repeat the exercise; secondaries differ from mains. */
  assert.equal(p.days[0].ex[0].lib, p.days[2].ex[0].lib);
  assert.notEqual(p.days[0].ex[3].lib, p.days[1].ex[0].lib, 'hinge secondary is not the hinge main');
  /* Dose: new = main 3 sets, secondary 2, RIR 3; no fill for novices. */
  const sq = p.days[0].ex[0];
  assert.deepEqual([sq.sets, sq.rep, sq.rir, sq.rest, sq.key], [3, [8, 12], 3, 120, true]);
  assert.deepEqual([p.days[0].ex[3].sets, p.days[0].ex[3].rir], [2, 3]);
  assert.deepEqual(sq.slot, { pattern: 'squat', role: 'main', use: 'squat' });
  assert.equal(sq.form, byId.get('goblet-squat').form);
  assert.deepEqual(p.gaps, []);
  assert.deepEqual(G.gapLines(p, L), []);
});

test('profile 2: 2 days, home, new, low back, 45 min', () => {
  const p = G.generate({ days: 2, place: 'home', level: 'new', pain: ['back'], minutes: 45 }, L);
  assert.deepEqual(names(p.days[0]), ['Box squat (to a chair)', 'Incline push-up', 'One-arm backpack row', 'Glute bridge']);
  assert.deepEqual(names(p.days[1]), ['Glute bridge', 'Pike push-up', 'One-arm backpack row']);
  /* No bar or bands: the vertical pull falls back to a row, same main exercise. */
  assert.deepEqual(p.days[1].ex[2].slot, { pattern: 'vpull', role: 'main', use: 'hpull' });
  /* Back: hinge and squat at least RIR 3; the row's floor (2) is below the dose. */
  for (const e of p.days.flatMap(d => d.ex)) if (e.rir != null) assert.equal(e.rir, 3, e.n);
  /* Accessories nothing fits were past the time cut anyway: no note. */
  assert.ok(p.gaps.every(g => g.cut));
  assert.deepEqual(G.gapLines(p, L), []);
  assert.deepEqual(G.buildLines(p.answers, L), ['2 days a week, full body', 'Bodyweight exercises', 'Easier start for a new lifter',
    'Leaving out hard-on-the-low-back exercises', 'About 45 minutes']);
});

test('profile 3: 4 days, dumbbells, under 2 years, shoulders, 75 min (checked by eye: 2 push / 2 pull per upper day)', () => {
  const p = G.generate({ days: 4, place: 'db', level: 'some', pain: ['shoulders'], minutes: 75 }, L);
  assert.equal(p.name, '4 days a week · upper and lower');
  const ua = day(p, 'upper-a'), ub = day(p, 'upper-b');
  assert.deepEqual(names(ua), ['Neutral-grip dumbbell press', 'One-arm dumbbell row', 'Dumbbell floor press', 'Chest-supported dumbbell row',
    'Dumbbell triceps kickback', 'Dumbbell curl', 'Dead bug']);
  assert.deepEqual(names(ub), ['Neutral-grip dumbbell press', 'One-arm dumbbell row', 'Prone Y raise', 'Dumbbell squeeze press',
    'Hammer curl', 'Dumbbell skull crusher', 'Bird dog']);
  /* preferFirst for shoulders puts the neutral grip first; RIR floor 3 on pressing. */
  assert.deepEqual([ua.ex[0].rir, ua.ex[0].sets], [3, 4], 'some: fill adds a 4th main set at 75 min');
  /* No overhead pressing on sore shoulders: vpush falls back to a chest press, vpull to a row. */
  assert.deepEqual([ua.ex[2].slot.use, ua.ex[3].slot.use], ['hpush', 'hpull']);
  for (const d of [ua, ub]) {
    const n = pats => d.ex.filter(e => pats.includes(e.slot.use)).length;
    assert.equal(n(['hpush', 'vpush']), 2, d.name + ' push');
    assert.equal(n(['hpull', 'vpull']), 2, d.name + ' pull');
  }
  assert.deepEqual(p.gaps.filter(g => !g.cut), []);
});

test('5 days, dumbbells, under 2 years, shoulders, 45 min (checked by eye: push and pull balanced over the week)', () => {
  const p = G.generate({ days: 5, place: 'db', level: 'some', pain: ['shoulders'], minutes: 45 }, L);
  assert.deepEqual(p.days.map(names), [
    ['Neutral-grip dumbbell press', 'One-arm dumbbell row', 'Dumbbell floor press'],
    ['Goblet squat', 'Dumbbell hip thrust', 'Split squat', 'Dead bug'],
    ['Neutral-grip dumbbell press', 'One-arm dumbbell row', 'Chest-supported dumbbell row'],
    ['Dumbbell Romanian deadlift', 'Box squat (to a chair)', 'Reverse lunge', 'Plank', 'Farmer carry'],
    ['Goblet squat', 'Dumbbell squeeze press', 'Prone Y raise', 'One-arm dumbbell row', 'Bird dog']]);
  const all = p.days.flatMap(d => d.ex);
  const push = all.filter(e => ['hpush', 'vpush'].includes(e.slot.use)).length, pull = all.filter(e => ['hpull', 'vpull'].includes(e.slot.use)).length;
  assert.deepEqual([push, pull], [4, 5]);
  /* The light day: one set off, never below 2. */
  for (const e of day(p, 'full-c').ex) assert.equal(e.sets, 2, e.n);
});

test('generation is deterministic and the programme passes the engine\'s check', () => {
  const a = { days: 5, place: 'gym', level: 'exp', pain: ['knees'], minutes: 75 };
  assert.deepEqual(G.generate(a, L), G.generate(a, L));
  const p = G.generate(a, L, { id: 'gen-x1', createdAt: '2026-10-11T10:00:00Z' });
  const n = E.normaliseProgramme(p);
  assert.equal(n.id, 'gen-x1');
  assert.deepEqual(n.answers, p.answers);
  assert.deepEqual(n.gaps, p.gaps);
  /* Light day: one set off every slot, never below 2. */
  const light = day(p, 'full-c');
  for (const e of light.ex) assert.ok(e.sets >= 2 && e.sets <= 3, e.n);
});

/* -------------------------------------------------- the exhaustive safety loop */
test('every answer combination: nothing unsuitable, every day usable, the engine runs it', () => {
  let n = 0;
  for (const days of [2, 3, 4, 5]) for (const place of L.PLACES) for (const level of Object.keys(L.LEVELS)) for (const pain of PAINS)
    for (const minutes of G.MINUTES) for (const has of place === 'gym' ? [{}] : [{ bar: false, bands: false }, { bar: true, bands: false }, { bar: false, bands: true }, { bar: true, bands: true }]) {
      const a = { days, place, level, pain, minutes, has };
      const tag = JSON.stringify(a);
      const p = G.generate(a, L);
      const kit = place === 'gym' ? { bar: true, bands: true, step: true } : { ...has, step: true };
      assert.equal(p.days.length, days, tag);
      for (const d of p.days) {
        assert.ok(d.ex.length >= 1, tag + ' ' + d.key + ' is empty');
        assert.ok(d.ex.length >= L.TIME.minSlots || p.gaps.some(g => g.day === d.key), tag + ' ' + d.key + ' has ' + d.ex.length + ' with no documented drop');
        assert.equal(new Set(d.ex.map(e => e.n)).size, d.ex.length, tag + ' duplicate on ' + d.key);
        /* fallbackMaxOnDay: a day with a fallback into X never has more X slots than the cap. */
        for (const [x, cap] of Object.entries(L.PAIN_RULES.fallbackMaxOnDay || {}))
          if (d.ex.some(e => e.slot.use === x && e.slot.pattern !== x))
            assert.ok(d.ex.filter(e => e.slot.use === x).length <= cap, tag + ' ' + d.key + ': ' + x + ' over ' + cap);
        /* The backpack row is a home exercise only. */
        if (place !== 'home') assert.ok(!d.ex.some(e => e.lib === 'backpack-row'), tag + ' backpack row at ' + place);
        for (const e of d.ex) {
          const x = byId.get(e.lib);
          assert.ok(x, e.n);
          for (const f of pain) assert.ok(!x.avoid.includes(f), tag + ': ' + e.n + ' is hard on ' + f);
          assert.ok(x.equip.includes(place), tag + ': ' + e.n + ' needs other equipment');
          for (const k of x.needs) assert.ok(kit[k], tag + ': ' + e.n + ' needs ' + k);
          assert.ok(x.level <= L.LEVELS[level], tag + ': ' + e.n + ' is above the level');
          assert.ok(!x.roles || x.roles.includes(e.slot.role), tag + ': ' + e.n + ' in a ' + e.slot.role + ' slot');
          if (e.kind === 'weight' || e.kind === 'band') for (const f of pain) {
            const floor = (L.PAIN_RULES[f].rirFloor || {})[e.slot.use];
            if (floor != null) assert.ok(e.rir >= floor, tag + ': ' + e.n + ' RIR under the floor');
          }
        }
      }
      /* The gap note names only kit the person lacks. */
      for (const l of G.gapLines(p, L)) {
        if (kit.bar) assert.doesNotMatch(l, /pull-up bar/, tag);
        if (kit.bands) assert.doesNotMatch(l, /[Bb]ands would/, tag);
      }
      assert.deepEqual(G.audit(p, L), [], tag + ': a generated programme passes its own audit');
      assert.ok(G.editable(p, L), tag);
      const prog = E.normaliseProgramme({ ...p, id: 'gen-t' });
      const k0 = E.programmeKey(prog.days[0]);
      const s = E.newSession(k0, [], '2026-10-12', '2026-10-12T09:00:00Z', false, prog);
      assert.equal(s.exercises.length, prog.days[0].ex.length);
      const w = E.programmeWeek(prog, [{ ...s, savedAt: 'x' }], '2026-10-12');
      assert.equal(w.next, prog.days.length > 1 ? E.programmeKey(prog.days[1]) : k0);
      assert.equal(w.target, days);
      n++;
    }
  assert.equal(n, 4 * (3 * 8 * 3 + 2 * 3 * 8 * 3 * 4));
});

/* ------------------------------------------------------------------- swaps */
const A3 = { days: 3, place: 'db', level: 'new', pain: ['knees'], minutes: 60 };

test('alternatives: current first, only what fits the slot, nothing already on that day, at most 6', () => {
  const p = G.generate(A3, L);
  const alt = G.alternatives(p, 'full-a', 0, A3, L);
  assert.equal(alt[0].current, true);
  assert.equal(alt[0].n, p.days[0].ex[0].n);
  assert.ok(alt.length <= 6);
  for (const x of alt) {
    const e = byId.get(x.id);
    assert.equal(e.pattern, 'squat');
    assert.ok(!e.avoid.includes('knees'));
    assert.ok(e.equip.includes('db'));
    assert.ok(x.why.length > 0);
  }
  /* Knees: box squat comes first by preferFirst. */
  assert.equal(p.days[0].ex[0].n, 'Box squat (to a chair)');
  assert.ok(!alt.some(x => x.id === 'leg-press'), 'gym-only');
  /* Nothing already on the day is offered for another slot. */
  const onDay = new Set(p.days[0].ex.map(e => e.lib));
  for (const [i] of p.days[0].ex.entries()) for (const x of G.alternatives(p, 'full-a', i, A3, L)) if (!x.current) assert.ok(!onDay.has(x.id));
});

test('swap: a new programme, Your pick marked, sets kept, reps and RIR follow the new exercise; back again clears it', () => {
  const p = G.generate(A3, L);
  const before = JSON.stringify(p);
  const q = G.swap(p, 'full-a', 0, 'goblet-squat', A3, L);
  assert.equal(JSON.stringify(p), before, 'the original is untouched');
  const e = q.days[0].ex[0];
  assert.equal(e.n, 'Goblet squat');
  assert.equal(e.picked, true);
  assert.equal(e.orig, 'box-squat');
  assert.equal(e.sets, p.days[0].ex[0].sets);
  assert.deepEqual(e.rep, [8, 12], 'dose rep: goblet squat has no own range');
  assert.equal(e.rir, 3, 'knees floor on squat');
  assert.equal(e.load, 'kg');
  E.normaliseProgramme(q);
  const back = G.swap(q, 'full-a', 0, 'box-squat', A3, L);
  assert.equal('picked' in back.days[0].ex[0], false);
  assert.deepEqual(back, p);
  assert.throws(() => G.swap(p, 'full-a', 0, 'back-squat', A3, L), /does not fit/);
  assert.throws(() => G.swap(p, 'full-a', 0, 'db-bench-press', A3, L), /does not fit/, 'another pattern');
});

test('unfit gives the reason the library view shows', () => {
  const a = G.checkAnswers({ days: 3, place: 'home', level: 'new', pain: ['knees', 'shoulders'], minutes: 45 }, L);
  assert.equal(G.unfit(byId.get('leg-press'), a, L), 'Needs a gym');
  assert.equal(G.unfit(byId.get('goblet-squat'), a, L), 'Needs dumbbells');
  assert.equal(G.unfit(byId.get('chin-up'), a, L), 'Needs a pull-up bar');
  assert.equal(G.unfit(byId.get('band-row'), a, L), 'Needs resistance bands');
  assert.equal(G.unfit(byId.get('single-leg-glute-bridge'), a, L), 'For more experienced lifters');
  assert.equal(G.unfit(byId.get('split-squat'), a, L), 'Hard on the knees');
  assert.equal(G.unfit(byId.get('pike-pushup'), a, L), 'Hard on the shoulders');
  assert.equal(G.unfit(byId.get('prone-y-raise'), a, L, 'main'), 'Not for a main slot');
  assert.equal(G.unfit(byId.get('glute-bridge'), a, L), null);
});

test('re-take keeps a swap where the same day still has that slot and it still fits; drops it otherwise', () => {
  const p = G.swap(G.generate(A3, L), 'full-a', 0, 'goblet-squat', A3, L);
  const same = G.generate({ ...A3, minutes: 75 }, L, { keep: p });
  assert.equal(same.days[0].ex[0].n, 'Goblet squat');
  assert.equal(same.days[0].ex[0].picked, true);
  /* Moving home: no dumbbells, so the goblet squat no longer fits. */
  const home = G.generate({ ...A3, place: 'home' }, L, { keep: p });
  assert.ok(!home.days.some(d => d.ex.some(e => e.picked)));
});

test('the engine runs a generated session and progresses it', () => {
  const p = E.normaliseProgramme(G.generate({ days: 3, place: 'gym', level: 'some', pain: [], minutes: 60 }, L, { id: 'gen-e1' }));
  const s = E.newSession('g-full-a', [], '2026-10-12', '2026-10-12T09:00:00Z', false, p);
  assert.equal(s.programmeId, 'gen-e1');
  const lp = s.exercises[0];
  assert.equal(lp.n, 'Leg press');
  assert.equal(lp.sets[0].target, null, 'first time: ✓ asks for the numbers');
  for (const st of lp.sets) Object.assign(st, { kg: 100, reps: 10, rir: 2, state: 'done', doneAt: '2026-10-12T09:10:00Z', via: 'sheet' });
  const fin = E.finishSession(s, '2026-10-12T10:00:00Z', 'drop').session;
  const next = E.newSession('g-full-a', [fin], '2026-10-14', '2026-10-14T09:00:00Z', false, p);
  assert.equal(next.exercises[0].rec.rule, 'R1');
  assert.deepEqual(next.exercises[0].sets[0].target, { kg: 105, reps: 6 });
  /* A session-only swap builds the replacement the same way. */
  const alt = E.programmeExercise(E.normaliseProgramme(G.swap(p, 'full-a', 0, 'goblet-squat', p.answers, L)).days[0].ex[0], [fin], '2026-10-14');
  assert.equal(alt.n, 'Goblet squat');
  assert.equal(alt.cal, undefined);
  assert.equal(alt.sets.length, p.days[0].ex[0].sets);
});

test('helpers for the screens: Q5 counts, library slots and days', () => {
  const part = { days: 3, place: 'gym', level: 'new', pain: [] };
  const c = G.MINUTES.map(m => G.aboutCount(part, m, L));
  assert.ok(c[0] <= c[1] && c[1] <= c[2], c.join());
  const p = G.generate({ ...part, minutes: 60 }, L);
  assert.deepEqual(G.daysWith(p, 'goblet-squat'), ['Full body A', 'Full body C']);
  const sl = G.slotsFor(p, 'leg-press', L);
  assert.deepEqual(sl.map(x => [x.dayName, x.current]), [['Full body A', 'Goblet squat'], ['Full body C', 'Goblet squat']]);
  assert.deepEqual(Object.keys(G.DAYS_LINE).map(Number), Object.keys(L.SPLITS).map(Number));
  const grouped = G.GROUPS.flatMap(g => g.patterns);
  assert.deepEqual([...grouped].sort(), Object.keys(L.PATTERNS).sort(), 'every pattern is in one library group');
});

test('checkAnswers refuses incomplete answers; home and db kit defaults to none, gym to all', () => {
  assert.throws(() => G.checkAnswers({ days: 6, place: 'gym', level: 'new', pain: [], minutes: 60 }, L), /days/);
  assert.throws(() => G.checkAnswers({ days: 3, place: 'gym', level: 'new', minutes: 60 }, L), /pain/);
  assert.throws(() => G.checkAnswers({ days: 3, place: 'gym', level: 'new', pain: ['neck'], minutes: 60 }, L), /pain/);
  assert.deepEqual(G.checkAnswers({ days: 3, place: 'home', level: 'new', pain: [], minutes: 60 }, L).has, { bar: false, bands: false });
  assert.deepEqual(G.checkAnswers({ days: 3, place: 'gym', level: 'new', pain: [], minutes: 60, has: { bar: false } }, L).has, { bar: true, bands: true });
});

/* ------------------------------------------ QA round (build 5-12) */
/* A tiny invented library, so this rule is tested whatever the trainer's
   library holds: day A's core slot is cut by the time budget, so it must not
   use up the best core exercise; day B gets it. */
function tinyLib() {
  const ex = (id, pattern, more = {}) => ({ id, n: id, pattern, equip: ['gym', 'db', 'home'], needs: [], level: 1, avoid: [], kind: 'weight', inc: 2, why: id, ...more });
  const dose = { sets: 3, rep: [8, 12], rir: 2, rest: 90 };
  const lv = { new: dose, some: dose, exp: dose };
  return {
    LEVELS: L.LEVELS, PLACES: L.PLACES, PAIN_FLAGS: L.PAIN_FLAGS, PATTERNS: { squat: {}, hinge: {}, core: {} },
    EXERCISES: [ex('sq', 'squat'), ex('hi', 'hinge'), ex('core-best', 'core'), ex('core-next', 'core')],
    PICK_ORDER: { squat: { new: ['sq'] }, hinge: { new: ['hi'] }, core: { new: ['core-best', 'core-next'] } },
    SPLITS: { 2: [{ key: 'a', name: 'A', slots: [{ pattern: 'squat', role: 'main' }, { pattern: 'core', role: 'accessory' }] },
                  { key: 'b', name: 'B', slots: [{ pattern: 'hinge', role: 'main' }, { pattern: 'core', role: 'accessory' }] }] },
    DOSE: { main: lv, secondary: lv, accessory: lv },
    /* 30 min - 5 warm-up = 25. Day A: squat 20 + core 10 does not fit. Day B: hinge 10 + core 10 fits. */
    TIME: { warmup: 5, slotMinutes: { main: { new: 20 }, secondary: { new: 10 }, accessory: { new: 10 } }, lightFactor: 1, minSlots: 1,
            fill: { perSetMinutes: { new: 99 }, maxMainSets: { new: 3 } } },
    PAIN_RULES: { fallback: {}, fallbackRoles: ['main', 'secondary'], fallbackMaxOnDay: {} }
  };
}
test('a slot cut by the time budget does not use up an exercise another day could have', () => {
  const lib = tinyLib();
  lib.SPLITS[2][1].slots[0] = { pattern: 'hinge', role: 'secondary' };
  const p = G.generate({ days: 2, place: 'gym', level: 'new', pain: [], minutes: 30 }, lib);
  assert.deepEqual(p.days.map(names), [['sq'], ['hi', 'core-best']]);
  /* With time for everything both days get a core slot, and they differ. */
  const q = G.generate({ days: 2, place: 'gym', level: 'new', pain: [], minutes: 60 }, lib);
  assert.deepEqual(q.days.map(names), [['sq', 'core-best'], ['hi', 'core-next']]);
});

test('fallbackMaxOnDay: a fallback into a pattern the day already has enough of is dropped, as a gap', () => {
  const lib = tinyLib();
  lib.SPLITS[2][0].slots = [{ pattern: 'hinge', role: 'main' }, { pattern: 'squat', role: 'secondary' }, { pattern: 'core', role: 'accessory' }];
  lib.EXERCISES = lib.EXERCISES.map(e => e.id === 'sq' ? { ...e, avoid: ['knees'] } : e).concat([{ ...lib.EXERCISES[1], id: 'hi2', n: 'hi2' }]);
  lib.PICK_ORDER.hinge.new = ['hi', 'hi2'];
  lib.PAIN_RULES.fallback = { squat: 'hinge' };
  lib.TIME.slotMinutes.main.new = 10;
  const a = { days: 2, place: 'gym', level: 'new', pain: ['knees'], minutes: 60 };
  lib.PAIN_RULES.fallbackMaxOnDay = { hinge: 2 };
  assert.deepEqual(names(G.generate(a, lib).days[0]), ['hi', 'hi2', 'core-best'], 'under the cap: squat falls back to a second hinge');
  lib.PAIN_RULES.fallbackMaxOnDay = { hinge: 1 };
  const p = G.generate(a, lib);
  assert.deepEqual(names(p.days[0]), ['hi', 'core-best'], 'at the cap: dropped');
  assert.deepEqual(p.gaps.map(g => [g.day, g.pattern, g.why]), [['a', 'squat', 'cap']]);
});

test('audit and editable: a stored programme is checked against its own answers', () => {
  const p = G.generate({ days: 3, place: 'gym', level: 'some', pain: [], minutes: 60 }, L);
  assert.deepEqual(G.audit(p, L), []);
  assert.equal(G.editable(p, L), true);
  /* The same programme now says sore knees, and holds an exercise hard on knees. */
  const kneeBad = L.EXERCISES.find(e => e.avoid.includes('knees') && e.equip.includes('gym') && e.level <= 2);
  const q = JSON.parse(JSON.stringify(p));
  q.answers.pain = ['knees'];
  q.days[0].ex[0] = { ...q.days[0].ex[0], lib: kneeBad.id, n: kneeBad.n };
  assert.ok(G.audit(q, L).some(x => x.includes('Hard on the knees')));
  /* Unknown pain flag, missing answers, unknown exercise, no slot info. */
  assert.match(G.audit({ ...p, answers: { ...p.answers, pain: ['neck'] } }, L)[0], /answers: pain/);
  assert.equal(G.editable({ ...p, answers: { ...p.answers, pain: ['neck'] } }, L), false);
  assert.deepEqual(G.audit({ ...p, answers: undefined }, L), [], 'a coach or hand-written programme has nothing to check');
  assert.equal(G.editable({ ...p, answers: undefined }, L), false, 'but it cannot be swapped');
  const gone = JSON.parse(JSON.stringify(p)); gone.days[0].ex[0].lib = 'no-such-exercise';
  assert.match(G.audit(gone, L)[0], /not in the exercise list/);
  const noSlot = JSON.parse(JSON.stringify(p)); delete noSlot.days[1].ex[0].slot;
  assert.equal(G.editable(noSlot, L), false);
});

test('without readable answers or slot info nothing throws: no alternatives, no slots, reasons instead of crashes', () => {
  const p = G.generate({ days: 3, place: 'gym', level: 'new', pain: [], minutes: 60 }, L);
  const coach = { ...JSON.parse(JSON.stringify(p)), source: 'coach', answers: undefined };
  for (const d of coach.days) for (const e of d.ex) { delete e.slot; delete e.lib; }
  assert.deepEqual(G.alternatives(coach, 'full-a', 0, coach.answers, L), []);
  assert.deepEqual(G.alternatives(p, 'full-a', 0, { ...p.answers, pain: ['neck'] }, L), []);
  assert.deepEqual(G.alternatives(p, 'nope', 0, p.answers, L), []);
  assert.deepEqual(G.slotsFor(coach, 'leg-press', L), []);
  assert.deepEqual(G.gapLines(coach, L), []);
  assert.equal(G.unfit(L.EXERCISES[0], undefined, L), 'Your answers are incomplete');
  assert.equal(G.unfit(L.EXERCISES[0], { place: 'gym', level: 'new', pain: 'back' }, L), 'Your answers are incomplete');
  assert.equal(G.unfit(undefined, p.answers, L), 'Not in the exercise list');
});

test('onboarding: the first missing answer, and advancing only from the question answered', () => {
  assert.equal(G.firstMissing({}, L), 0);
  assert.equal(G.firstMissing({ days: 3 }, L), 1);
  assert.equal(G.firstMissing({ days: 3, place: 'gym' }, L), 2);
  assert.equal(G.firstMissing({ days: 3, place: 'gym', level: 'new' }, L), 3);
  assert.equal(G.firstMissing({ days: 3, place: 'gym', level: 'new', pain: ['neck'] }, L), 3, 'an unknown flag is not an answer');
  assert.equal(G.firstMissing({ days: 3, place: 'gym', level: 'new', pain: [] }, L), 4);
  assert.equal(G.firstMissing({ days: 3, place: 'gym', level: 'new', pain: [], minutes: 60 }, L), -1);
  assert.equal(G.firstMissing(null, L), 0);
  /* A double tap on Q2 fires the advance twice: the second is a no-op. */
  const o = { step: 1, answers: { days: 3 } };
  const once = G.onboardAdvance(o, 1);
  assert.equal(once.step, 2);
  assert.equal(G.onboardAdvance(once, 1), once, 'stale: the counter already moved on');
  assert.equal(G.onboardAdvance(once, 1).step, 2, 'Q3 is not skipped');
});

test('entryScreen: who sees the start page, the questions or the app', () => {
  const E0 = { mode: null, storage: null, signedIn: false, hasData: false, githubOk: false };
  assert.equal(G.entryScreen(E0), 'start', 'nothing on the phone');
  assert.equal(G.entryScreen({ ...E0, storage: 'github', mode: 'github', hasData: true }), null, 'Dan: GitHub phone');
  assert.equal(G.entryScreen({ ...E0, storage: 'github', mode: 'github', programme: true, retake: true }), null, 'never on GitHub, whatever is cached');
  assert.equal(G.entryScreen({ ...E0, mode: 'account', signedIn: true, coach: true }), null, 'coach account');
  assert.equal(G.entryScreen({ ...E0, mode: 'account', signedIn: true }), 'questions');
  assert.equal(G.entryScreen({ ...E0, mode: 'account', signedIn: true, progLoad: 'loading' }), 'loading');
  assert.equal(G.entryScreen({ ...E0, mode: 'account', signedIn: true, programme: true }), null);
  /* QA 7: signed out with no programme is the start page, not the questions. */
  assert.equal(G.entryScreen({ ...E0, mode: 'account', signedIn: false, hasData: true }), 'start');
  assert.equal(G.entryScreen({ ...E0, mode: 'account', signedIn: false, programme: true, hasData: true }), null, 'signed out with a programme: the app');
  assert.equal(G.entryScreen({ ...E0, mode: 'account', signedIn: false, draft: true }), null, 'never over a session');
  assert.equal(G.entryScreen({ ...E0, mode: null, hasData: true }), null, 'old data, never signed in: the app as today');
  assert.equal(G.entryScreen({ ...E0, mode: 'account', signedIn: true, programme: true, retake: true }), 'questions');
  assert.equal(G.entryScreen({ ...E0, building: true, programme: true }), 'building');
});

test('re-take keeps a swap to an exercise ranked past the swap sheet\'s first six', () => {
  const lib = tinyLib();
  const cores = Array.from({ length: 9 }, (_, i) => ({ ...lib.EXERCISES[2], id: 'core-' + (i + 1), n: 'core-' + (i + 1) }));
  lib.EXERCISES = [lib.EXERCISES[0], lib.EXERCISES[1], ...cores];
  lib.PICK_ORDER.core.new = cores.map(e => e.id);
  const a = { days: 2, place: 'gym', level: 'new', pain: [], minutes: 60 };
  const p = G.generate(a, lib);
  const ci = p.days[0].ex.findIndex(e => e.slot.use === 'core');
  assert.equal(G.alternatives(p, 'a', ci, a, lib).some(x => x.id === 'core-9'), false, 'not on the sheet’s first six');
  const picked = G.swap(p, 'a', ci, 'core-9', a, lib);
  const again = G.generate(a, lib, { keep: picked });
  assert.equal(again.days[0].ex[ci].lib, 'core-9');
  assert.equal(again.days[0].ex[ci].picked, true);
});
