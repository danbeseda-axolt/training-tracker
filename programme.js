// @ts-check
/* Ledger programme generator: five answers + the exercise library → a
   programme in the engine's shape (see normaliseProgramme in engine.js).
   Pure and deterministic: no DOM, no clock, no network, and it imports
   nothing. The library is passed in (the page passes library.js), so the
   tests can hand it the same module or a variant.

   The selection rules are the library's (header of library.js), in its order:
   eligibility, fallback or drop, preferFirst + PICK_ORDER, week-wide
   assignment (main slots repeat, others vary), dose with the pain RIR floor,
   time trimming and the fill rule, light day. START_EASY is not applied: it
   needs a week-1 notion the engine does not have for programmes.

   Every exercise records its slot ({pattern, role, use}: use is the pattern
   actually filled, after a fallback), its library id (lib), the id the
   generator chose (orig) and, once swapped by the person, picked:true. A swap
   keeps the slot's sets and recomputes reps, RIR and rest for the new
   exercise. As of 2026-10-11. */

/** @typedef {Record<string, any>} Obj */
/** @typedef {{days:number, place:string, has:{bar:boolean, bands:boolean}, level:string, pain:string[], minutes:number}} Answers */

export const SPLIT_TEXT = /** @type {Record<number, string>} */ ({ 2: 'full body', 3: 'full body', 4: 'upper and lower', 5: 'upper and lower, plus a light full-body day' });
/* Q1's second line, matching the library's SPLITS. */
export const DAYS_LINE = /** @type {Record<number, string>} */ ({ 2: 'Full body, twice a week', 3: 'Full body, three times a week',
  4: 'Upper body one day, legs the next', 5: 'Upper and lower, plus a short full-body day' });
export const PLACE_TEXT = /** @type {Record<string, string>} */ ({ gym: 'Full gym', db: 'Dumbbells', home: 'Bodyweight' });
export const PAIN_TEXT = /** @type {Record<string, string>} */ ({ back: 'low back', knees: 'knees', shoulders: 'shoulders' });
export const MINUTES = [45, 60, 75];
export const LEVEL_KEYS = ['new', 'some', 'exp'];
/* The library browse groups, in the UX doc's order. */
export const GROUPS = [
  { name: 'Squat', patterns: ['squat'] }, { name: 'Hinge (hips back)', patterns: ['hinge'] },
  { name: 'Lunge and single leg', patterns: ['lunge'] }, { name: 'Push', patterns: ['hpush', 'vpush'] },
  { name: 'Pull', patterns: ['hpull', 'vpull'] }, { name: 'Core', patterns: ['core'] },
  { name: 'Arms and extras', patterns: ['biceps', 'triceps', 'carry', 'calves'] }
];
/* The pattern as a word in a sentence ("no row exercise fits …"). */
export const PATTERN_WORD = /** @type {Record<string, string>} */ ({ squat: 'squat', hinge: 'hip hinge', lunge: 'single-leg', hpush: 'chest press',
  vpush: 'overhead press', hpull: 'row', vpull: 'pulling', biceps: 'biceps', triceps: 'triceps', core: 'core', carry: 'carry', calves: 'calf' });
const LIGHT_KINDS = ['reps', 'time', 'band', 'distance'];
const clone = (/** @type {any} */ x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const cap = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A checked copy of the answers, or an Error. @param {any} a @param {Obj} lib @returns {Answers} */
export function checkAnswers(a, lib) {
  const bad = (/** @type {string} */ m) => { throw new Error('answers: ' + m); };
  if (!a || typeof a !== 'object') bad('not an object');
  if (![2, 3, 4, 5].includes(a.days) || !lib.SPLITS[a.days]) bad('days');
  if (!lib.PLACES.includes(a.place)) bad('place');
  if (!(a.level in lib.LEVELS)) bad('level');
  if (!Array.isArray(a.pain) || a.pain.some((/** @type {any} */ p) => !lib.PAIN_FLAGS.includes(p))) bad('pain');
  if (!Number.isInteger(a.minutes) || a.minutes < 30 || a.minutes > 120) bad('minutes');
  const has = a.place === 'gym' ? { bar: true, bands: true } : { bar: !!(a.has && a.has.bar), bands: !!(a.has && a.has.bands) };
  return { days: a.days, place: a.place, has, level: a.level, pain: [...new Set(/** @type {string[]} */ (a.pain))], minutes: a.minutes };
}
/** Kit on hand: a step or chair is assumed everywhere. @param {Answers} a */
const kitOf = a => /** @type {Obj} */ ({ ...a.has, step: true });

/* Why an exercise does not fit these answers, in the person's words, or null.
   role: the slot's role, for exercises limited to some roles. */
/** @param {Obj} ex @param {Answers} a @param {Obj} lib @param {string} [role] @returns {string|null} */
export function unfit(ex, a, lib, role) {
  /* Never throws on answers it cannot read: it says so instead. */
  if (!a || typeof a !== 'object' || !Array.isArray(a.pain) || !lib.PLACES.includes(a.place) || !(a.level in lib.LEVELS)) return 'Your answers are incomplete';
  if (!ex || !Array.isArray(ex.equip)) return 'Not in the exercise list';
  if (!ex.equip.includes(a.place)) return a.place === 'home' && ex.equip.includes('db') ? 'Needs dumbbells' : 'Needs a gym';
  const kit = kitOf({ ...a, has: a.has || {} });
  for (const n of ex.needs || []) if (!kit[n]) return n === 'bar' ? 'Needs a pull-up bar' : n === 'bands' ? 'Needs resistance bands' : 'Needs a step or chair';
  if (ex.level > lib.LEVELS[a.level]) return 'For more experienced lifters';
  for (const p of a.pain) if ((ex.avoid || []).includes(p)) return 'Hard on the ' + (PAIN_TEXT[p] || p);
  if (role && ex.roles && !ex.roles.includes(role)) return 'Not for a ' + role + ' slot';
  return null;
}

/* Rule 4: preferFirst for each pain (in the person's order), then PICK_ORDER
   for the level, then anything else of the pattern; only what fits (rule 2). */
/** @param {string} pattern @param {string} role @param {Answers} a @param {Obj} lib @returns {Obj[]} */
export function candidates(pattern, role, a, lib) {
  /* Memoised per answers object (checkAnswers makes a fresh one per call, so
     a cached list never outlives one generate / alternatives call). */
  let byA = CAND.get(a);
  if (!byA) { byA = new Map(); CAND.set(a, byA); }
  const k = pattern + '|' + role, hit = byA.get(k);
  if (hit && hit.lib === lib) return hit.list;
  const list = candidatesNow(pattern, role, a, lib);
  byA.set(k, { lib, list });
  return list;
}
const CAND = /** @type {WeakMap<object, Map<string, {lib:Obj, list:Obj[]}>>} */ (new WeakMap());
/** @param {string} pattern @param {string} role @param {Answers} a @param {Obj} lib @returns {Obj[]} */
function candidatesNow(pattern, role, a, lib) {
  /** @type {string[]} */
  const ids = [];
  for (const p of a.pain) ids.push(...((((lib.PAIN_RULES[p] || {}).preferFirst) || {})[pattern] || []));
  ids.push(...(((lib.PICK_ORDER[pattern] || {})[a.level]) || []));
  for (const e of lib.EXERCISES) if (e.pattern === pattern) ids.push(e.id);
  const byId = new Map(lib.EXERCISES.map((/** @type {Obj} */ e) => [e.id, e]));
  /** @type {Obj[]} */
  const out = [];
  for (const id of new Set(ids)) {
    const e = byId.get(id);
    if (e && e.pattern === pattern && !unfit(e, a, lib, role)) out.push(e);
  }
  return out;
}
/* Rule 3: the slot's pattern, else its fallback pattern (main and secondary
   only), else nothing: the slot is dropped, never filled with a misfit. */
/* A fallback into pattern X is allowed only while the day has fewer than
   PAIN_RULES.fallbackMaxOnDay[X] slots already filling X (by slot.use), so a
   day never turns into four rows. dayUse: pattern -> slots filling it so far. */
/** @param {Obj} slot @param {Answers} a @param {Obj} lib @param {Record<string, number>} [dayUse] */
function resolve(slot, a, lib, dayUse = {}) {
  const c = candidates(slot.pattern, slot.role, a, lib);
  if (c.length) return { use: slot.pattern, list: c };
  const fb = lib.PAIN_RULES.fallback[slot.pattern];
  if (fb && lib.PAIN_RULES.fallbackRoles.includes(slot.role)) {
    const cap = (lib.PAIN_RULES.fallbackMaxOnDay || {})[fb];
    if (cap != null && (dayUse[fb] || 0) >= cap) return { use: fb, list: [], capped: true };
    const f = candidates(fb, slot.role, a, lib);
    if (f.length) return { use: fb, list: f };
  }
  return null;
}

/* Rule 6: the dose for the role and level, the exercise's own range and rest
   where it has them, and the pain RIR floor for the pattern filled. */
/** @param {Obj} ex library exercise @param {{pattern:string, role:string, use:string}} slot @param {Answers} a @param {Obj} lib @param {number} [sets] */
function build(ex, slot, a, lib, sets) {
  const dose = lib.DOSE[slot.role][a.level];
  let rir = dose.rir;
  for (const p of a.pain) { const f = ((lib.PAIN_RULES[p] || {}).rirFloor || {})[slot.use]; if (f != null) rir = Math.max(rir, f); }
  /** @type {Obj} */
  const t = { n: ex.n, kind: ex.kind, sets: sets ?? dose.sets, rest: ex.rest ?? dose.rest };
  if (ex.kind === 'weight') {
    t.load = ex.load || 'kg'; t.rep = (ex.rep || dose.rep).slice(); t.rir = rir;
    if (t.load !== 'bw') t.inc = ex.inc ?? 2.5;
    if (ex.bar) t.bar = ex.bar;
  } else if (ex.kind === 'band') { t.rep = (ex.rep || dose.rep).slice(); t.rir = rir; }
  else if (ex.kind === 'reps') t.rep = (ex.rep || dose.rep).slice();
  else if (ex.kind === 'distance' && ex.dist != null) t.dist = ex.dist;
  if (ex.seed) t.seed = clone(ex.seed);
  if (slot.role === 'main') t.key = true;
  Object.assign(t, { note: ex.note || '', lib: ex.id, form: ex.form || null, why: ex.why || '', slot: { ...slot }, orig: ex.id });
  return t;
}
/** Minutes a built slot takes (TIME). @param {Obj} t @param {Answers} a @param {Obj} lib */
function slotMinutes(t, a, lib) {
  const base = lib.TIME.slotMinutes[t.slot.role][a.level];
  return t.load === 'bw' || LIGHT_KINDS.includes(t.kind) ? Math.ceil(base * lib.TIME.lightFactor) : base;
}

/* The programme for these answers. opts.id / opts.createdAt name it (a
   re-take needs a new id, so the rotation restarts); opts.keep is the
   previous programme, whose swaps are carried over where they still fit. */
/** @param {any} answers @param {Obj} lib @param {{id?:string, createdAt?:string|null, keep?:Obj|null}} [opts] */
export function generate(answers, lib, opts = {}) {
  const a = checkAnswers(answers, lib);
  const split = lib.SPLITS[a.days];
  /* Rule 7 decides which slots survive the time trim, but which exercises
     are picked decides what each slot costs. Only surviving slots may use up
     an exercise for the week, so: assign with the trim positions found so
     far, trim, and repeat until the positions stop changing (2-3 rounds). */
  /** @type {number[]} */
  let cuts = split.map(() => Infinity);
  let out = assignAndTrim(a, lib, split, cuts);
  for (let round = 0; round < 6 && out.cuts.some((c, i) => c !== cuts[i]); round++) {
    cuts = out.cuts;
    out = assignAndTrim(a, lib, split, cuts);
  }
  const { days, gaps } = out;
  /** @type {Obj} */
  let prog = {
    v: 1, id: opts.id || 'gen-' + [a.days, a.place, a.has.bar ? 'b' : '', a.has.bands ? 'r' : '', a.level, a.pain.join('_') || 'none', a.minutes].join('-'),
    name: a.days + ' days a week · ' + SPLIT_TEXT[a.days], source: 'generated', perWeek: a.days, deloadEvery: null,
    days, answers: a, gaps, createdAt: opts.createdAt ?? null
  };
  if (opts.keep) prog = carrySwaps(prog, opts.keep, lib);
  return prog;
}

/* One round: rule 5 (the whole week, mains, then secondaries, then
   accessories) for the slots before each day's cut, then rules 6-8.
   Returns the days, the gaps and the cuts this round's picks produce. */
/** @param {Answers} a @param {Obj} lib @param {Obj[]} split @param {number[]} cuts */
function assignAndTrim(a, lib, split, cuts) {
  /** @type {Obj[]} */
  const gaps = [];
  const picks = split.map(() => /** @type {(Obj|null)[]} */ ([]));
  const used = new Set();
  /** @type {Record<string, string>} */
  const mainPick = {};
  for (const role of ['main', 'secondary', 'accessory']) {
    split.forEach((/** @type {Obj} */ day, /** @type {number} */ di) => {
      day.slots.forEach((/** @type {Obj} */ slot, /** @type {number} */ si) => {
        if (slot.role !== role || si >= cuts[di]) return;
        /* What the day fills already or will: fallbacks placed so far plus
           every slot of the day (before the cut) whose own pattern it is. */
        /** @type {Record<string, number>} */
        const dayUse = {};
        day.slots.forEach((/** @type {Obj} */ s, /** @type {number} */ k) => { if (k !== si && k < cuts[di] && candidates(s.pattern, s.role, a, lib).length) dayUse[s.pattern] = (dayUse[s.pattern] || 0) + 1; });
        for (const p of picks[di]) if (p && p.slot.use !== p.slot.pattern) dayUse[p.slot.use] = (dayUse[p.slot.use] || 0) + 1;
        const res = resolve(slot, a, lib, dayUse);
        const onDay = new Set(picks[di].filter(Boolean).map(p => p && p.ex.id));
        /** @type {Obj|undefined} */
        let ex;
        if (res) {
          const free = res.list.filter(e => !onDay.has(e.id));
          if (role === 'main') {
            const m = mainPick[res.use];
            ex = m && !onDay.has(m) ? res.list.find(e => e.id === m) : free[0];
            if (ex && !mainPick[res.use]) mainPick[res.use] = ex.id;
          } else ex = free.find(e => !used.has(e.id)) || free[0];
        }
        if (!res || !ex) {
          picks[di][si] = null;
          gaps.push({ day: day.key, slot: si, pattern: slot.pattern, role, why: !res ? 'none-fits' : res.capped ? 'cap' : 'repeat' });
          return;
        }
        used.add(ex.id);
        picks[di][si] = { ex, si, slot: { pattern: slot.pattern, role, use: res.use } };
      });
    });
  }
  /** @type {number[]} */
  const newCuts = [];
  const days = split.map((/** @type {Obj} */ day, /** @type {number} */ di) => {
    const built = /** @type {Obj[]} */ (picks[di].filter(Boolean)).map(p => ({ t: build(p.ex, p.slot, a, lib), si: p.si }));
    /* Rule 7: keep slots in order while they fit the minutes (at least
       minSlots), then spend what is left on extra main sets. */
    const budget = a.minutes - lib.TIME.warmup;
    let total = 0;
    /** @type {Obj[]} */
    const kept = [];
    /* The slot position where time ran out: a dropped slot after it would
       have been trimmed anyway, so it is not reported as a gap. */
    let cut = Infinity;
    for (const { t, si } of built) {
      const m = slotMinutes(t, a, lib);
      if (kept.length >= lib.TIME.minSlots && total + m > budget) { cut = si; break; }
      kept.push(t); total += m;
    }
    /* A slot dropped for want of an exercise but past where time ran out
       would have been trimmed anyway: it is not reported as a gap. */
    for (const g of gaps) if (g.day === day.key && g.slot > cut) g.cut = true;
    newCuts[di] = Math.min(cut, cuts[di]);
    const per = lib.TIME.fill.perSetMinutes[a.level], max = lib.TIME.fill.maxMainSets[a.level];
    let spare = budget - total, more = true;
    while (more) {
      more = false;
      for (const t of kept) if (t.slot.role === 'main' && t.sets < max && spare >= per) { t.sets++; spare -= per; more = true; }
    }
    /* Rule 8: the light day takes a set off every slot, never below 2. */
    if (day.light) for (const t of kept) t.sets = Math.max(2, t.sets - 1);
    return { key: day.key, name: day.name, ex: kept };
  });
  return { days, gaps, cuts: newCuts };
}

/* Swaps from an earlier programme are kept when the same day (by position:
   Day A stays Day A) has a slot filling the same pattern and the exercise
   still fits the new answers. Otherwise they are dropped. */
/** @param {Obj} prog @param {Obj} old @param {Obj} lib */
export function carrySwaps(prog, old, lib) {
  let p = prog;
  (old.days || []).forEach((/** @type {Obj} */ od, /** @type {number} */ di) => {
    const nd = p.days[di];
    if (!nd) return;
    for (const e of od.ex || []) {
      if (!e.picked || !e.slot) continue;
      const j = nd.ex.findIndex((/** @type {Obj} */ x) => x.slot && x.slot.use === e.slot.use && x.lib !== e.lib
        && alternatives(p, nd.key, nd.ex.indexOf(x), p.answers, lib, { max: 999 }).some(c => c.id === e.lib));
      if (j >= 0) p = swap(p, nd.key, j, e.lib, p.answers, lib);
    }
  });
  return p;
}

/* What a slot could be instead: the current exercise first, then what fits
   the answers for the slot's pattern and role, in the library's order,
   leaving out exercises already on that day. At most `max` (6). */
/** @param {Obj} prog @param {string} dayKey @param {number} exIndex @param {any} answers @param {Obj} lib @param {{max?:number}} [opts] */
export function alternatives(prog, dayKey, exIndex, answers, lib, opts = {}) {
  /* A programme without readable answers or slot info (a coach programme,
     a hand-written one, corrupt answers) has nothing to offer: never throws. */
  /** @type {Answers} */
  let a;
  try { a = checkAnswers(answers, lib); } catch (e) { return []; }
  const day = prog && Array.isArray(prog.days) ? prog.days.find((/** @type {Obj} */ d) => d.key === dayKey) : null;
  const cur = day && day.ex[exIndex];
  if (!cur || !cur.slot) return [];
  const others = new Set(day.ex.filter((/** @type {Obj} */ _, /** @type {number} */ i) => i !== exIndex).map((/** @type {Obj} */ e) => e.lib));
  const byId = new Map(lib.EXERCISES.map((/** @type {Obj} */ e) => [e.id, e]));
  const row = (/** @type {Obj} */ e, /** @type {boolean} */ current) => ({ id: e.id, n: e.n, why: e.why || '', form: e.form || null, current, fit: true, reason: null });
  const out = [];
  const c = byId.get(cur.lib);
  if (c) out.push(row(c, true));
  for (const e of candidates(cur.slot.use, cur.slot.role, a, lib)) if (e.id !== cur.lib && !others.has(e.id)) out.push(row(e, false));
  return out.slice(0, opts.max || 6);
}

/* A new programme with one slot swapped. Refuses an exercise the slot could
   not offer. Swapping back to the generator's choice clears picked. */
/** @param {Obj} prog @param {string} dayKey @param {number} exIndex @param {string} id @param {any} answers @param {Obj} lib */
export function swap(prog, dayKey, exIndex, id, answers, lib) {
  const a = checkAnswers(answers, lib);
  if (!alternatives(prog, dayKey, exIndex, a, lib, { max: 99 }).some(x => x.id === id)) throw new Error('swap: ' + id + ' does not fit this slot');
  const p = clone(prog);
  const day = p.days.find((/** @type {Obj} */ d) => d.key === dayKey), cur = day.ex[exIndex];
  const ex = lib.EXERCISES.find((/** @type {Obj} */ e) => e.id === id);
  const t = build(ex, cur.slot, a, lib, cur.sets);
  t.orig = cur.orig || cur.lib;
  if (t.lib !== t.orig) t.picked = true;
  day.ex[exIndex] = t;
  return p;
}

/* Problems that make a stored programme unsafe to run as it is, against its
   own answers: answers that do not read (an unknown pain flag, a missing
   field), or an exercise the library no longer has or that does not fit the
   answers (e.g. one hard on a joint the person said hurts). An empty list =
   fine. A programme with no answers at all (coach / hand-written) has
   nothing to check against and passes; it just cannot be swapped. The page
   treats any problem as "set it up again" rather than running it. */
/** @param {Obj} prog @param {Obj} lib @returns {string[]} */
export function audit(prog, lib) {
  if (!prog || prog.answers == null) return [];
  /** @type {Answers} */
  let a;
  try { a = checkAnswers(prog.answers, lib); } catch (e) { return [String(/** @type {Error} */ (e).message)]; }
  const byId = new Map(lib.EXERCISES.map((/** @type {Obj} */ e) => [e.id, e]));
  /** @type {string[]} */
  const out = [];
  for (const d of prog.days || []) for (const e of d.ex || []) {
    if (!e.lib) continue;
    const x = byId.get(e.lib);
    if (!x) { out.push(e.n + ': not in the exercise list'); continue; }
    const why = unfit(x, a, lib, e.slot && e.slot.role);
    if (why) out.push(e.n + ': ' + why);
  }
  return out;
}
/** Swaps and the library are offered only with readable answers and slot info on every exercise. @param {Obj} prog @param {Obj} lib */
export function editable(prog, lib) {
  if (!prog || !prog.answers || !Array.isArray(prog.days)) return false;
  try { checkAnswers(prog.answers, lib); } catch (e) { return false; }
  const ids = new Set(lib.EXERCISES.map((/** @type {Obj} */ e) => e.id));
  return prog.days.every((/** @type {Obj} */ d) => (d.ex || []).every((/** @type {Obj} */ e) => e.slot && e.slot.use && e.slot.role && ids.has(e.lib)));
}

/* ------------------------------------------------------------ onboarding */
/** The first question whose answer is missing or unreadable (0-4), or -1. @param {any} a @param {Obj} lib */
export function firstMissing(a, lib) {
  const x = a && typeof a === 'object' ? a : {};
  if (![2, 3, 4, 5].includes(x.days) || !lib.SPLITS[x.days]) return 0;
  if (!lib.PLACES.includes(x.place)) return 1;
  if (!(x.level in lib.LEVELS)) return 2;
  if (!Array.isArray(x.pain) || x.pain.some((/** @type {any} */ p) => !lib.PAIN_FLAGS.includes(p))) return 3;
  if (!Number.isInteger(x.minutes) || x.minutes < 30 || x.minutes > 120) return 4;
  return -1;
}
/* Moves on from the question that was answered, not from whatever the
   counter says now: a second tap on the same question (or a stale timer
   after Back) changes nothing. */
/** @param {Obj} o onboarding state @param {number} from the question answered */
export const onboardAdvance = (o, from) => (o && o.step === from ? { ...o, step: from + 1 } : o);

/* Which full screen a phone shows instead of the tabs (null = the app as
   usual). Pure, so the gate can be tested:
   - never on a GitHub phone or the coach's account, never over a session;
   - a re-take in progress shows the questions;
   - no programme: signed in on an account phone → loading / questions;
     signed out → the start page, on an account phone or on a phone with
     nothing on it at all. (A fresh phone that already holds data from
     before sign-in existed keeps today's app.) */
/** @param {{building?:any, storage?:string|null, mode?:string|null, coach?:boolean, draft?:any, retake?:boolean, programme?:boolean, signedIn?:boolean, githubOk?:boolean, hasData?:boolean, progLoad?:string|null}} s */
export function entryScreen(s) {
  if (s.building) return 'building';
  if (s.storage === 'github' || s.mode === 'github' || s.coach || s.draft) return null;
  if (s.retake) return 'questions';
  if (s.programme) return null;
  if (!s.signedIn) {
    if (s.mode === 'account') return 'start';
    return s.mode == null && !s.githubOk && !s.hasData ? 'start' : null;
  }
  if (s.mode === 'account') return s.progLoad ? 'loading' : 'questions';
  return null;
}

/* Where an exercise sits in the programme: one entry per slot that fills its
   pattern, for the library's "Use instead of" and "In Day A". */
/** @param {Obj} prog @param {string} id @param {Obj} lib */
export function slotsFor(prog, id, lib) {
  if (!editable(prog, lib)) return [];
  const ex = lib.EXERCISES.find((/** @type {Obj} */ e) => e.id === id);
  /** @type {{dayKey:string, dayName:string, i:number, current:string, has:boolean}[]} */
  const out = [];
  if (!ex) return out;
  for (const d of prog.days) d.ex.forEach((/** @type {Obj} */ e, /** @type {number} */ i) => {
    if (e.slot && e.slot.use === ex.pattern) out.push({ dayKey: d.key, dayName: d.name, i, current: e.n, has: e.lib === id });
  });
  return out;
}
/** Days that already have this exercise. @param {Obj} prog @param {string} id */
export const daysWith = (prog, id) => prog.days.filter((/** @type {Obj} */ d) => d.ex.some((/** @type {Obj} */ e) => e.lib === id)).map((/** @type {Obj} */ d) => d.name);

/* The lines of the "Building your programme" screen, from the answers. */
/** @param {any} answers @param {Obj} lib */
export function buildLines(answers, lib) {
  const a = checkAnswers(answers, lib);
  const out = [a.days + ' days a week, ' + SPLIT_TEXT[a.days]];
  const kit = [a.has.bar ? 'a pull-up bar' : '', a.has.bands ? 'bands' : ''].filter(Boolean);
  out.push(a.place === 'gym' ? 'Full-gym exercises'
    : (a.place === 'db' ? 'Dumbbell exercises' : 'Bodyweight exercises') + (kit.length ? ' with ' + kit.join(' and ') : ''));
  if (a.level === 'new') out.push('Easier start for a new lifter');
  for (const p of a.pain) out.push('Leaving out hard-on-the-' + PAIN_TEXT[p].replace(' ', '-') + ' exercises');
  out.push('About ' + a.minutes + ' minutes');
  return out;
}
/* "Day B has 4 exercises, not 5: no pull fits …". One line per day with a
   slot that nothing fits; null when there is none. */
/** @param {Obj} prog @param {Obj} lib */
export function gapLines(prog, lib) {
  const a = prog.answers;
  if (!a || !Array.isArray(prog.gaps)) return [];
  /** @type {string[]} */
  const out = [];
  for (const d of prog.days) {
    const g = prog.gaps.filter((/** @type {Obj} */ x) => x.day === d.key && !x.cut);
    if (!g.length) continue;
    const pats = [...new Set(g.map((/** @type {Obj} */ x) => PATTERN_WORD[x.pattern] || x.pattern))];
    const where = a.place === 'home' ? '"at home, no weights"' : a.place === 'db' ? '"dumbbells only"' : 'a full gym';
    const pain = a.pain.length ? ' with sore ' + a.pain.map((/** @type {string} */ p) => PAIN_TEXT[p]).join(' and ') : '';
    /* Name only kit the person lacks that would actually fill one of these slots. */
    const all = { ...a, has: { bar: true, bands: true } }, want = new Set();
    for (const x of g) for (const e of [...candidates(x.pattern, x.role, all, lib), ...(lib.PAIN_RULES.fallback[x.pattern] ? candidates(lib.PAIN_RULES.fallback[x.pattern], x.role, all, lib) : [])])
      for (const n of e.needs || []) if ((n === 'bar' || n === 'bands') && !a.has[n]) want.add(n);
    const kitWords = [want.has('bar') ? 'a pull-up bar' : '', want.has('bands') ? 'bands' : ''].filter(Boolean).join(' or ');
    const kit = kitWords ? ' ' + cap(kitWords) + ' would add one: re-take the questions in Settings.' : '';
    out.push(d.name + ' has ' + d.ex.length + ' exercises, not ' + (d.ex.length + g.length) + ': no ' + pats.join(' or ') + ' exercise fits ' + where + pain + '.' + kit);
  }
  return out;
}
/** About how many exercises a day, for Q5's rows. @param {Obj} partial answers without minutes @param {number} minutes @param {Obj} lib */
export function aboutCount(partial, minutes, lib) {
  try {
    const p = generate({ pain: [], ...partial, minutes }, lib);
    return Math.round(p.days.reduce((/** @type {number} */ s, /** @type {Obj} */ d) => s + d.ex.length, 0) / p.days.length);
  } catch (e) { return null; }
}
