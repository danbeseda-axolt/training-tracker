// @ts-check
/* Ledger engine. Pure: no DOM, no network, no clock, no global state.
   Every function takes what it reads as arguments, and callers pass dates in,
   so plain Node can test all of it (node --test "tracker/dev/*.test.mjs").

   As of 2026-09-23. Field meanings are in ../training/log/README.md. */

/** @typedef {{kg?:number|null, reps?:number|null, rir?:number|null, seconds?:number|null, metres?:number|null, rounds?:number|null, band?:string|null, warmup?:boolean, done?:boolean, state?:'planned'|'done'|'legacy', target?:Target|null, doneAt?:string|null, via?:'tick'|'sheet'|'bulk'|null}} LSet */
/** @typedef {{kg?:number|null, reps?:number|null, metres?:number|null, seconds?:number|null, band?:string|null, rounds?:number|null, src?:string}} Target */
/** @typedef {{rule:string, kg?:number|null, reps?:number|null, band?:string|null, why:string}} Rec */
/** @typedef {{n:string, kind:string, load?:string, hold?:boolean, dist?:number|null, sets?:number, rep?:number[]|null, rir?:number|null, inc?:number|null, rest?:number|null, bar?:number|null, key?:boolean, note?:string, seed?:Target, dose?:number|null, routine?:string}} Tpl */
/** @typedef {Record<string, any>} Obj */

export const SCHEMA_VERSION = 5;
export const APP_VERSION = 'v5';

/* A one-sided low-back pinch from the third on means a physiotherapist
   before the next hinge session. How many happened before the app is a
   Settings value on the phone (settings.priorPinches, null = not set), so no
   health history ships in this public code. */
export const PHYSIO_AT = 3;

export const DEFAULT_BANDS = ['yellow', 'red', 'green', 'blue', 'black'];

export const DEFAULTS = {
  settings: { token: '', owner: 'danbeseda-axolt', repo: 'dan-brain', branch: 'main',
              path: 'training/log', restOn: true, phase: 'cut', deloadWeeks: 5,
              bands: DEFAULT_BANDS.slice(), wakeLock: true, priorPinches: null },
  draft: null, queue: [], bwQueue: [], history: [], bw: [], historyFetched: 0
};

/* ------------------------------------------------------------ templates */
/* Programme v2: ../training/programme-v2-draft.md and daily-floor.md, as of
   2026-08-30.
   kind : weight (kg/reps/rir) | band (band/reps/rir) | reps (a bare count)
          | time (s) | distance (kg/m) | rounds
   load : for weight only. kg (default) | bw+ (kg is ADDED load, 0 = bodyweight)
          | bw (bodyweight only, no kg at all; progress by reps, then variation)
   rep  : [min,max] prescribed range     rir : target reps in reserve
   inc  : smallest useful load jump      rest: prescribed rest, seconds
   bar  : bar weight, enables the plate breakdown
   key  : counts as a main lift for deload trigger D1
   hold : "hold, don't chase". Load goes up only when the whole session is RIR 3+
   dist : prescribed distance in metres for a carry
   seed : first-ever target, used only while the exercise has no history. bw+
          lifts start at bodyweight, the deadlift at the programme's 85 kg.
          Anything else with no history asks for its first set.               */
export const TEMPLATES = {
  'upper-push': { name: 'Upper Push', day: 'Mon', ex: [
    { n: 'Bench press (heavy)', kind: 'weight', sets: 4, rep: [5, 5], rir: 2, inc: 2.5, rest: 180, bar: 20, key: true, hold: true,
      note: 'First set paused 1s. Hold, don’t chase — only add load if a whole session lands at RIR 3–4.' },
    { n: 'Overhead press', kind: 'weight', sets: 3, rep: [6, 8], rir: 2, inc: 2.5, rest: 150, bar: 20, key: true, note: 'Strict, standing.' },
    { n: 'Weighted dip', kind: 'weight', load: 'bw+', sets: 3, rep: [6, 8], rir: 2, inc: 2.5, rest: 150, seed: { kg: 0, reps: 6 }, note: 'Added kg (0 = bodyweight). Shoulders just below elbows.' },
    { n: 'Preacher curl (one DB, two hands)', kind: 'weight', sets: 3, rep: [10, 12], rir: 1, inc: 2, rest: 75, note: 'One dumbbell held in both hands, elbows on the bench pad. kg is that one dumbbell. Biceps fresh.' },
    { n: 'Pallof press', kind: 'band', sets: 3, rep: [10, 10], rir: 2, rest: 60, note: 'Per side. Pick the band colours.' }
  ] },
  'lower-b': { name: 'Lower B — hinge', day: 'Tue', ex: [
    { n: 'Trap-bar / conventional DL', kind: 'weight', sets: 3, rep: [5, 5], rir: 3, inc: 2.5, rest: 210, bar: 20, key: true, seed: { kg: 85, reps: 5 },
      note: 'Rebuild from 85–95 kg. Film from the side. Stop on any one-sided pinch.' },
    { n: 'Romanian deadlift', kind: 'weight', sets: 3, rep: [8, 8], rir: 2, inc: 2.5, rest: 150, bar: 20, note: 'Full ROM.' },
    { n: '45° back extension', kind: 'weight', load: 'bw+', sets: 3, rep: [10, 15], rir: 1, inc: 2.5, rest: 90, seed: { kg: 0, reps: 10 }, note: 'The missing erector work. Added kg, 0 = bodyweight.' },
    { n: 'Suitcase carry', kind: 'distance', dist: 30, sets: 3, rest: 90, note: 'Per side, 30 m.' },
    { n: 'McGill Big 3', kind: 'rounds', sets: 2, rest: 60 },
    { n: 'Dead hang', kind: 'time', sets: 2, rest: 90, note: 'Build to 60s.' }
  ] },
  'upper-pull': { name: 'Upper Pull', day: 'Wed', ex: [
    { n: 'Pull-up (EMOM 10×3)', kind: 'reps', sets: 1, rep: [30, 30], rest: 0,
      note: 'Log total reps for the whole 10 min. Progress by reps per minute, not by adding minutes.' },
    { n: 'Chin-up', kind: 'weight', load: 'bw+', sets: 3, rep: [5, 10], rir: 2, inc: 2.5, rest: 150, seed: { kg: 0, reps: 5 }, note: 'Added kg, 0 = bodyweight.' },
    { n: 'Single-arm DB row', kind: 'weight', sets: 3, rep: [8, 12], rir: 1, inc: 2, rest: 120, note: 'Per side. Hand AND knee on the bench — never bent-over.' },
    { n: 'Face pull', kind: 'weight', sets: 3, rep: [12, 15], rir: 1, inc: 2.5, rest: 75 },
    { n: 'Hammer curl', kind: 'weight', sets: 3, rep: [10, 12], rir: 1, inc: 2, rest: 75, note: 'Per hand.' }
  ] },
  'lower-a': { name: 'Lower A — squat', day: 'Fri', ex: [
    { n: 'High-bar back squat', kind: 'weight', sets: 4, rep: [5, 5], rir: 2, inc: 2.5, rest: 210, bar: 20, key: true, note: 'The lift being built.' },
    { n: 'Bulgarian split squat', kind: 'weight', sets: 3, rep: [8, 8], rir: 2, inc: 2, rest: 120, note: 'Per leg.' },
    { n: 'Hanging knee/leg raise', kind: 'weight', load: 'bw+', sets: 3, rep: [8, 12], rir: 1, inc: 2, rest: 90, seed: { kg: 0, reps: 8 }, note: 'Strict. Added kg, 0 = bodyweight. Knee or straight: say which in the note.' },
    { n: 'Ab wheel rollout', kind: 'weight', load: 'bw', sets: 3, rep: [6, 10], rir: 1, rest: 90, seed: { reps: 6 }, note: 'Knees down. Bodyweight: progress by reps, then a harder variation.' },
    { n: 'Farmer’s carry', kind: 'distance', dist: 40, sets: 3, rest: 90, note: '40 m.' }
  ] },
  /* Built from ROUTINES for the day of the week: see floorFor(). */
  'floor': { name: 'Daily floor', day: 'Every day', ex: [] },
  'custom': { name: 'Custom', day: 'Any', ex: [] }
};

/* Earlier names of the same exercise, so a rename keeps its history. The
   2026-09 sessions logged "Incline DB curl", but Dan confirmed on 2026-09-23
   that it was a preacher curl with one 20 kg dumbbell held in both hands. */
export const ALIASES = /** @type {Record<string, string[]>} */ ({
  'Preacher curl (one DB, two hands)': ['Incline DB curl']
});
/** @param {string} logged the name in a session file @param {string} wanted */
export const sameEx = (logged, wanted) => logged === wanted || (ALIASES[wanted] || []).includes(logged);

/* Floor and stretching routines: ../training/daily-floor.md, as of 2026-08-30.
   A routine is one block of that file. The Daily floor session is built from
   the blocks due that weekday, and any session can add a block from
   ⋯ → Add floor or stretching (after lifting is fine; before it is not).
   dose : the prescribed hold in seconds. ✓ records exactly that, the same as
          ticking a lift at its target. Holds with no fixed dose (the ladder,
          L-sit, handstand) target last time's typical hold instead, and ask
          for the seconds the first time.
   Per-side work is one set per side, so "2 × 30 s / side" is 4 sets.         */
export const ROUTINES = {
  'squat-block': { name: 'Squat block', when: 'Every day', ex: [
    { n: 'Knee-to-wall ankle stretch', kind: 'time', dose: 30, sets: 4, rest: 0, note: '2 × 30 s per side, alternating L and R. Heel stays down: find where it just lifts, back off 1 cm.' },
    { n: 'Deep squat hold', kind: 'time', dose: 90, sets: 1, rest: 0, note: '90 s, broken as needed. Hands inside the knees pressing out, chest tall. Hold, don’t hang.' },
    { n: '90/90 hip switches', kind: 'reps', rep: [10, 10], sets: 1, rest: 0, note: '10 per side. Slow, torso tall.' },
    { n: 'T-spine extension over roller', kind: 'reps', rep: [10, 10], sets: 1, rest: 0, note: 'Ribs down: the movement is upper back, not lower back.' }
  ] },
  'length-a': { name: 'Length A — posterior chain', when: 'Tue · Thu · Sat', ex: [
    { n: 'Pancake passive hold', kind: 'time', dose: 90, sets: 1, rest: 0, note: 'Hinge from the hip with a flat back. Sit on a cushion edge if the low back rounds.' },
    { n: 'Good morning pancake', kind: 'reps', rep: [10, 10], sets: 2, rest: 0, note: 'Same position, hinge forward and back under control. This is what makes the range stick.' },
    { n: 'Seated single-leg hamstring hinge', kind: 'time', dose: 45, sets: 2, rest: 0, note: '45 s per side. Chest to knee, not nose to knee. Flat back.' }
  ] },
  'length-b': { name: 'Length B — anterior hip', when: 'Mon · Wed · Fri · Sun', ex: [
    { n: 'Couch stretch', kind: 'time', dose: 60, sets: 2, rest: 0, note: '60 s per side. Ribs down, tailbone tucked, squeeze the rear glute. Without the tuck it stretches your low back.' },
    { n: 'Half-kneeling hip flexor + reach', kind: 'time', dose: 30, sets: 2, rest: 0, note: '30 s per side. Same tuck, reach the same-side arm overhead and slightly across.' },
    { n: 'Thread the needle', kind: 'reps', rep: [8, 8], sets: 2, rest: 0, note: '8 per side. T-spine rotation.' }
  ] },
  'hip-ladder': { name: 'Hip flexor ladder', when: 'Mon · Tue · Thu · Sat', ex: [
    { n: 'Hip flexor ladder', kind: 'time', sets: 4, rest: 45, note: 'Hold until form breaks, not to burning. Put the rung (1–5) in the note. Up a rung at 4 × 20 s clean. Low back stays flat.' }
  ] },
  'handstand': { name: 'Handstand', when: 'Mon · Wed · Fri · Sun', ex: [
    { n: 'Wrist prep', kind: 'rounds', sets: 1, rest: 0, note: '60 s: lean back palms down, palms up, knuckle weight shifts, wrist circles.' },
    { n: 'Wall handstand', kind: 'time', sets: 2, rest: 60, note: 'Chest to wall, max hold up to 60 s. Shoulders fully open, ribs tucked, glutes squeezed.' }
  ] },
  'lsit': { name: 'L-sit', when: 'Tue · Thu · Sat', ex: [
    { n: 'L-sit', kind: 'time', sets: 5, rest: 45, note: '10–15 s at your current variation; put it in the note. Push the shoulders down. At 5 × 15 s move up and reset to 5 s.' }
  ] },
  'five-min': { name: '5-minute version', when: 'Short on time', ex: [
    { n: 'Deep squat hold', kind: 'time', dose: 90, sets: 1, rest: 0, note: '90 s.' },
    { n: 'Couch stretch', kind: 'time', dose: 60, sets: 2, rest: 0, note: '60 s per side.' },
    { n: 'Hip flexor ladder', kind: 'time', sets: 2, rest: 45, note: 'Two sets. Put the rung in the note.' }
  ] }
};

/* The fixed week from daily-floor.md, so there is nothing to decide: the squat
   block every day, then length A or B, the ladder four days a week, and the
   skill. Keys are getDay(): 0 = Sunday. */
const FLOOR_WEEK = /** @type {Record<number, string[]>} */ ({
  1: ['length-b', 'hip-ladder', 'handstand'],
  2: ['length-a', 'hip-ladder', 'lsit'],
  3: ['length-b', 'handstand'],
  4: ['length-a', 'hip-ladder', 'lsit'],
  5: ['length-b', 'handstand'],
  6: ['length-a', 'hip-ladder', 'lsit'],
  0: ['length-b', 'handstand']
});
/** The routine keys due on a date. @param {string} dateIso @returns {string[]} */
export function floorFor(dateIso) {
  return ['squat-block', ...FLOOR_WEEK[new Date(dateIso + 'T00:00:00').getDay()]];
}

/* Floor and custom sessions are not lifts: they never count toward the week,
   the deload cadence or a deload themselves. */
const NON_LIFT = new Set(['floor', 'custom']);
export const isLiftKey = (/** @type {string} */ k) => !NON_LIFT.has(k);
const isLift = (/** @type {Obj} */ h) => !NON_LIFT.has(h.key);

/* The programme fixes the deload cadence ("every 4–6 weeks, non-negotiable in
   a deficit") but not the dose. These numbers are a proposal, not the coach’s. */
export const DELOAD = { loadPct: 0.65, resumePct: 0.95 };

export const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

/* ------------------------------------------------------------- utilities */
/** @template T @param {T} x @returns {T} */
export const clone = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
const r2 = (/** @type {number} */ x) => Math.round(x * 100) / 100;
/** @param {number} x @param {number} step */
export const roundTo = (x, step) => r2(Math.round(x / step) * step);

/* Formatted from local parts, never toISOString: east of UTC that rounds local
   midnight back into the previous day and labels every week a day early. */
/** @param {Date} d */
export const localISO = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
/** ISO Monday of the week containing an ISO date. @param {string} iso */
export function weekOf(iso) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  return localISO(d);
}
/** @param {string} iso @param {number} n */
export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localISO(d);
}
/** @param {string} a @param {string} b */
export const weeksBetween = (a, b) => Math.round((+new Date(b + 'T00:00:00') - +new Date(a + 'T00:00:00')) / 6048e5);
/** @param {string} a @param {string} b */
export const daysBetween = (a, b) => Math.round((+new Date(b + 'T00:00:00') - +new Date(a + 'T00:00:00')) / 864e5);
/** @param {number[]} a */
export function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'Mon 15 Sep' or 'Mon 15 Sep 2026'. @param {string} iso @param {boolean} [year] */
export function niceDate(iso, year) {
  const d = new Date(iso + 'T00:00:00');
  return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] + (year ? ' ' + d.getFullYear() : '');
}

/* Plate breakdown per side. Null when the load cannot be made from the plates
   on hand, which is itself worth knowing before you get under it. */
/** @param {number|null|undefined} total @param {number|null|undefined} bar */
export function plateBreak(total, bar) {
  if (!bar || total == null || total < bar) return null;
  if (total === bar) return 'bar only';
  let side = (total - bar) / 2; const out = [];
  for (const p of PLATES) {
    const n = Math.floor(side / p + 1e-9);
    if (n) { out.push(n > 1 ? n + '×' + p : String(p)); side -= n * p; }
  }
  return side > 0.01 ? null : out.join(' + ') + ' / side';
}

/* ------------------------------------------------------------- set model */
/** @param {LSet} st */
export const hasData = st => st.kg != null || st.reps != null || st.seconds != null || st.metres != null || st.rounds != null || st.band != null;
/* Performed = confirmed in v5, or from a pre-v5 file (legacy, provenance
   unknown). A set with no state at all is only ever an un-migrated legacy set. */
/** @param {LSet} st */
export const performed = st => st.state == null || st.state === 'done' || st.state === 'legacy';
/* Warm-ups are excluded from every calculation. Counting them drags every
   recommendation down. Planned sets are targets, never observations. */
/** @param {Obj} ex @returns {LSet[]} */
export const working = ex => (ex.sets || []).filter((/** @type {LSet} */ st) => hasData(st) && !st.warmup && performed(st));

/** @param {Obj} ex */
export const loadOf = ex => (ex.kind === 'weight' ? (ex.load || 'kg') : null);

/* The fields a set of this kind must have before it can count as done. */
/** @param {Obj} ex @returns {string[]} */
export function fieldsOf(ex) {
  switch (ex.kind) {
    case 'weight': return loadOf(ex) === 'bw' ? ['reps'] : ['kg', 'reps'];
    case 'band': return ['band', 'reps'];
    case 'distance': return ['kg', 'metres'];
    case 'time': return ['seconds'];
    case 'rounds': return ['rounds'];
    default: return ['reps'];
  }
}
/** @param {Obj} ex */
const hasRir = ex => ex.kind === 'weight' || ex.kind === 'band';

/** A new planned set. @param {Obj} ex @param {Target|null} target */
export function blankSet(ex, target) {
  /** @type {Obj} */
  const s = {};
  for (const k of fieldsOf(ex)) s[k] = null;
  if (hasRir(ex)) s.rir = null;
  Object.assign(s, { warmup: false, state: 'planned', target: target ? { ...target } : null, doneAt: null, via: null });
  return s;
}

/* Confirming copies any empty field from the target. It refuses when a field
   the kind needs would still be empty: a null target is never "as shown". */
/** @param {Obj} ex @param {LSet} st */
export function canConfirm(ex, st) {
  const t = /** @type {Obj} */ (st.target || {});
  return fieldsOf(ex).every(k => (/** @type {Obj} */ (st))[k] != null || t[k] != null);
}
/** @param {Obj} ex @param {LSet} st @param {'tick'|'sheet'|'bulk'} via @param {string} nowIso */
export function confirmSet(ex, st, via, nowIso) {
  if (!canConfirm(ex, st)) return false;
  const t = /** @type {Obj} */ (st.target || {}), s = /** @type {Obj} */ (st);
  for (const k of fieldsOf(ex)) if (s[k] == null && t[k] != null) s[k] = t[k];
  st.state = 'done'; st.doneAt = nowIso; st.via = via;
  return true;
}
/* Un-ticking clears only what still equals the target, so a value Dan typed
   survives a mis-tap. */
/* A legacy set is history from a saved file, not a tick. Un-ticking it would
   let "I didn't do them" delete it, or "as shown" re-stamp it as done today,
   so it is refused. */
/** @param {LSet} st */
export function unconfirmSet(st) {
  if (st.state === 'legacy') return false;
  const t = /** @type {Obj} */ (st.target || {}), s = /** @type {Obj} */ (st);
  for (const k of Object.keys(t)) if (k !== 'src' && s[k] === t[k]) s[k] = null;
  st.state = 'planned'; st.doneAt = null; st.via = null;
  return true;
}

/* A warm-up row, inserted before the working sets and planned like any
   other set, so its ✓ records a warm-up, never a working set. Target: a ramp
   of 50 / 70 / 85% of the working target (never under the bar), 8 / 5 / 3
   reps. With no working target, the empty bar, or nothing. */
/** @param {Obj} ex */
export function warmupSet(ex) {
  const nWarm = (ex.sets || []).filter((/** @type {LSet} */ s) => s.warmup).length;
  const step = Math.min(nWarm, 2);
  let wkg = null;
  for (const s of ex.sets || []) {
    if (s.warmup) continue;
    const v = s.state === 'planned' ? (s.target && s.target.kg) : s.kg;
    if (v != null) { wkg = v; break; }
  }
  let kg = null;
  if (wkg != null && wkg > 0) {
    kg = roundTo(wkg * [0.5, 0.7, 0.85][step], 2.5);
    if (ex.bar && kg < ex.bar) kg = ex.bar;
    if (kg >= wkg) kg = ex.bar && ex.bar < wkg ? ex.bar : null;
  } else if (ex.bar) kg = ex.bar;
  const st = blankSet(ex, kg != null ? { kg, reps: [8, 5, 3][step], src: 'warmup' } : null);
  st.warmup = true;
  return st;
}
/** Where a new warm-up goes: after any warm-ups, before the first working set. @param {Obj} ex */
export const warmupIndex = ex => { const i = (ex.sets || []).findIndex((/** @type {LSet} */ s) => !s.warmup); return i < 0 ? (ex.sets || []).length : i; };
/* A set saved in the sheet with values that differ from its target becomes
   the target for the rest of the exercise. Otherwise a ✓ on set 2 would record
   the old target as if it had been lifted. ex.rec is left alone. */
/** @param {Obj} ex @param {number} j */
export function carryForward(ex, j) {
  const st = ex.sets[j];
  if (!st || st.warmup) return;
  const f = fieldsOf(ex), t = st.target || {};
  if (st.target && f.every(k => st[k] === t[k])) return;
  /** @type {Obj} */
  const vals = {};
  for (const k of f) vals[k] = st[k];
  for (let m = j + 1; m < ex.sets.length; m++) {
    const o = ex.sets[m];
    if (o.state === 'planned' && !o.warmup) o.target = { ...vals, src: 'carried' };
  }
}

/* ------------------------------------------------------------- history */
/** @param {Obj} s @param {string} dir */
export const pathOf = (s, dir) => s.file || (dir + '/' + s.date + '-' + s.key + '.json');
/** A path-independent identity for a session file. @param {Obj} s */
export const fileKey = s => String(s.file || (s.date + '-' + s.key + '.json')).split('/').pop();

/* Pre-v5 files carry no provenance. In memory only, each set is marked
   'legacy' and every original key is kept verbatim, including done:false.
   Files are never rewritten by this. */
/** @param {Obj} obj */
export function migrateSession(obj) {
  const s = clone(obj);
  if (!s || (s.schemaVersion || 0) >= SCHEMA_VERSION) return s;
  for (const ex of s.exercises || []) for (const st of ex.sets || []) {
    if (st.state == null) Object.assign(st, { state: 'legacy', doneAt: null, via: null, target: null });
  }
  return s;
}

/* The 2026-09-17 pattern: a pre-v5 session saved in under two minutes whose
   every set equals the prefilled recommendation, with no effort recorded. The
   app could not tell that apart from Finish pressed on an untouched prefill. */
/* Editing a suspect session saves it as v5 with unverified:true, so the flag
   survives the edit until Dan confirms it (verified:true) or deletes it. */
/** @param {Obj} s */
export function isSuspectPrefill(s) {
  if (s && s.unverified === true) return true;
  if (!s || s.schemaVersion || !s.startedAt || !s.endedAt) return false;
  const dt = Date.parse(s.endedAt) - Date.parse(s.startedAt);
  if (!(dt < 120000)) return false;
  const withRec = (s.exercises || []).filter((/** @type {Obj} */ e) => e.rec);
  if (!withRec.length) return false;
  return withRec.every((/** @type {Obj} */ e) => {
    const w = (e.sets || []).filter((/** @type {LSet} */ st) => hasData(st) && !st.warmup);
    return w.every((/** @type {LSet} */ st) => st.kg === e.rec.kg && st.reps === e.rec.reps && st.rir == null);
  });
}

/* Everything known: pulled files, overlaid by anything still queued on the
   phone. Keyed by file path, so two sessions on one day are both kept. A queued
   tombstone removes its path. Includes suspect sessions (History shows them). */
/** @param {Obj[]} history @param {Obj[]} queue */
export function mergedHistory(history, queue) {
  const m = new Map();
  for (const h of history || []) if (h && !h.deleted) m.set(fileKey(h), h);
  for (const q of queue || []) {
    if (!q || !q.date) continue;
    if (q.deleted) m.delete(fileKey(q)); else m.set(fileKey(q), q);
  }
  return [...m.values()].map(s => { const c = migrateSession(s); delete c.qid; return c; })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.savedAt || '').localeCompare(String(a.savedAt || ''))));
}
/* What the rules read. Suspect sessions are out until Dan confirms them. */
/** @param {Obj[]} history @param {Obj[]} queue */
export const analysisHistory = (history, queue) =>
  mergedHistory(history, queue).filter(s => !isSuspectPrefill(s) || s.verified === true);

/** @param {string} exName @param {Obj[]} history @param {string} [beforeDate] */
export function lastFor(exName, history, beforeDate) {
  for (const h of history) {
    if (h.deleted) continue;
    if (beforeDate && h.date >= beforeDate) continue;
    if (h.isDeload) continue;              // deload numbers would poison the next call
    const ex = (h.exercises || []).find((/** @type {Obj} */ e) => sameEx(e.n, exName) && !e.skipped);
    if (ex && working(ex).length) return { date: h.date, ex, session: h };
  }
  return null;
}
/** @param {string} exName @param {number} n @param {Obj[]} history @param {string} [beforeDate] */
export function lastRules(exName, n, history, beforeDate) {
  const out = [];
  for (const h of history) {
    if (beforeDate && h.date >= beforeDate) continue;
    const d = (h.decisions || []).find((/** @type {Obj} */ x) => sameEx(x.ex, exName) && x.outcome !== 'not-done');
    if (d) { out.push(d.rule); if (out.length === n) break; }
  }
  return out;
}

/* The effort that drives progression: the LAST rated working set. On straight
   sets it is the hardest one, so it is the honest reading, and it is the one
   the app asks for. */
/** @param {Obj} ex */
export function rirRef(ex) {
  const w = working(ex);
  for (let i = w.length - 1; i >= 0; i--) if (w[i].rir != null) return w[i].rir;
  return null;
}
/** @param {LSet[]} sets */
const lastBand = sets => { for (let i = sets.length - 1; i >= 0; i--) if (sets[i].band) return sets[i].band; return null; };
/** @param {LSet[]} sets */
const lastKg = sets => { for (let i = sets.length - 1; i >= 0; i--) if (sets[i].kg != null) return sets[i].kg; return null; };

/* Epley, extended by RIR so a set stopped short still estimates honestly.
   No RIR means no estimate: reading null as RIR 0 made a missing rating look
   like a strength loss. Degrades past ~12 reps, so D1 reads main lifts only. */
/** @param {number|null|undefined} kg @param {number|null|undefined} reps @param {number|null|undefined} rir */
export function e1rm(kg, reps, rir) {
  if (!kg || !reps || rir == null) return null;
  const eff = reps + rir;
  if (eff > 12) return null;
  return kg * (1 + eff / 30);
}
/** @param {Obj} ex */
export function sessionE1rm(ex) {
  const v = working(ex).map(st => e1rm(st.kg, st.reps, st.rir)).filter(x => x);
  return v.length ? Math.max(.../** @type {number[]} */ (v)) : null;
}

/* --------------------------------------------------------------- the rules */
/* Evaluated in this order, first match wins:
     R6 deload · R0 cut short · R5 stalled twice · RN no RIR · hold (bench)
     · R1 / R1b / R1v / B1 progress · R2 / B2 hold · R4 two below · R3 catch-all
   R3 (and B2 for bands) is the catch-all, so no session falls through. */
/** @param {Tpl} tpl @param {Obj[]} history @param {string} beforeDate @param {boolean} [deloadOn] @returns {Rec|null} */
export function recommend(tpl, history, beforeDate, deloadOn) {
  const kind = tpl.kind;
  if ((kind !== 'weight' && kind !== 'band') || !tpl.rep || tpl.rir == null) return null;
  const load = loadOf(tpl);
  const prev = lastFor(tpl.n, history, beforeDate);
  if (!prev) return null;
  const sets = working(prev.ex);
  const inc = tpl.inc || 2.5, bot = tpl.rep[0], top = tpl.rep[1];
  /* A legacy null kg reads as 0: for bw+ the template says 0 = bodyweight. */
  const base = Math.max(...sets.map(s => s.kg ?? 0));
  const band = lastBand(sets);
  const reps = sets.map(s => s.reps ?? 0);
  /** @param {string} rule @param {number|null} kg @param {number} r @param {string} why @returns {Rec} */
  const mk = (rule, kg, r, why) =>
    kind === 'band' ? { rule, band, reps: r, why }
    : load === 'bw' ? { rule, kg: null, reps: r, why }
    : { rule, kg, reps: r, why };

  if (deloadOn) {
    const pct = Math.round(DELOAD.loadPct * 100);
    if (kind === 'band') return mk('R6', null, bot, 'Deload week: same band, bottom of the range. Should feel easy.');
    if (load === 'bw') return mk('R6', null, bot, 'Deload week: bottom of the range. Should feel easy.');
    const kg = Math.max(0, roundTo(base * DELOAD.loadPct, load === 'bw+' ? inc : 2.5));
    return mk('R6', kg, bot, 'Deload week: ' + pct + '% for ' + bot + '. Should feel easy.');
  }

  const target = prev.ex.targetSets || sets.length;
  if (sets.length < target) return mk('R0', base, top, 'Last session was cut short: same again.');

  if (load === 'kg' || load === 'bw+') {
    const r5 = lastRules(tpl.n, 2, history, beforeDate);
    if (r5.length === 2 && r5[0] === 'R4' && r5[1] === 'R4')
      return mk('R5', roundTo(base * 0.9, inc), bot, 'Stalled twice. Down 10% to rebuild.');
  }

  const ref = rirRef(prev.ex);
  const allTop = reps.every(r => r >= top);
  const weakest = Math.min(...reps);

  if (allTop && ref == null)
    return mk('RN', base, top, 'No RIR logged last time: same weight. Log the last set\'s RIR to unlock progression.');

  if (kind === 'band') {
    if (allTop && ref != null && ref >= tpl.rir) return mk('B1', null, bot, 'Topped out: go one band heavier.');
    return mk('B2', null, Math.min(top, weakest + 1),
      allTop ? 'Topped the range but nothing left. Same band: own it first.' : 'Same band. Add a rep to the weakest set.');
  }

  if (tpl.hold && allTop) {
    const rated = sets.map(s => s.rir).filter(r => r != null);
    if (ref != null && ref >= 3 && rated.every(r => /** @type {number} */ (r) >= 3))
      return mk('R1', r2(base + inc), bot, 'Whole session at RIR 3+: the load got light on its own. Up ' + inc + ' kg.');
    return mk('R2', base, top, 'Hold, don\'t chase: add load only when the whole session is RIR 3+.');
  }

  if (allTop && ref != null && ref >= tpl.rir) {
    if (load === 'bw') return mk('R1v', null, top, 'Topped the range: make the variation harder.');
    /* One increment on a light dumbbell can be a 20% jump, so extend the reps
       first, by at most two past the top. Once every set is already two past,
       the load goes up anyway, or the exercise would never progress.
       Skipped for bw+: the system load includes bodyweight, so one increment
       is always under 10% of what is actually moved. */
    if (load === 'kg' && base > 0 && inc / base > 0.10) {
      if (weakest < top + 2)
        return mk('R1b', base, Math.min(Math.max(...reps) + 1, top + 2),
          'Topped the range, but +' + inc + ' kg is over 10% here. Add a rep first.');
      return mk('R1', r2(base + inc), bot, 'Two reps past the top on every set: up ' + inc + ' kg, back to ' + bot + '.');
    }
    return mk('R1', r2(base + inc), bot, 'Topped the range at RIR ' + tpl.rir + '+. Up ' + inc + ' kg.');
  }
  if (allTop) return mk('R2', base, top, 'Topped the range but nothing left. Same weight: own it first.');

  if (reps.filter(r => r < bot).length >= 2) return mk('R4', base, bot, 'Two or more sets below range. Same weight again.');

  return mk('R3', base, Math.min(top, weakest + 1), 'Same weight. Add a rep to the weakest set.');
}

/* The per-set target for every kind. Weight and band come from the rules;
   carries from the prescribed distance and the last load; the EMOM from the
   bottom of its range. Time and rounds have no target. */
/** @param {Tpl} tpl @param {Obj[]} history @param {string} date @param {boolean} [deloadOn] @returns {{rec:Rec|null, target:Target|null}} */
export function targets(tpl, history, date, deloadOn) {
  if (tpl.kind === 'weight' || tpl.kind === 'band') {
    const rec = recommend(tpl, history, date, deloadOn);
    if (!rec) {
      /* Never done before: the template's seed, if it has one. */
      if (tpl.seed && !lastFor(tpl.n, history, date)) return { rec: null, target: { ...tpl.seed, src: 'seed' } };
      return { rec: null, target: null };
    }
    if (tpl.kind === 'band') return { rec, target: { band: rec.band ?? null, reps: rec.reps } };
    if (loadOf(tpl) === 'bw') return { rec, target: { reps: rec.reps } };
    return { rec, target: { kg: rec.kg, reps: rec.reps } };
  }
  if (tpl.kind === 'distance') {
    const prev = lastFor(tpl.n, history, date);
    let kg = prev ? lastKg(working(prev.ex)) : null;
    if (kg != null && deloadOn) kg = roundTo(kg * DELOAD.loadPct, 2);
    const metres = tpl.dist ?? null;
    return { rec: null, target: kg == null && metres == null ? null : { kg, metres } };
  }
  if (tpl.kind === 'time') {
    if (tpl.dose != null) return { rec: null, target: { seconds: tpl.dose, src: 'dose' } };
    /* A skill hold has no fixed dose: last time's typical hold, so a steady
       day is one tap and a better one is a change in the sheet. */
    const prev = lastFor(tpl.n, history, date);
    const secs = prev ? working(prev.ex).map(s => s.seconds).filter(v => v != null) : [];
    const m = median(/** @type {number[]} */ (secs));
    return { rec: null, target: m == null ? null : { seconds: Math.round(m), src: 'last' } };
  }
  if (tpl.kind === 'rounds') return { rec: null, target: { rounds: 1, src: 'dose' } };
  if (tpl.kind === 'reps' && tpl.rep) return { rec: null, target: { reps: tpl.rep[0] } };
  return { rec: null, target: null };
}

/* Rebuilds the template from what the exercise stored at creation, so a date
   change or a swap re-recommends with the same load type and hold rule. */
/** @param {Obj} ex @returns {Tpl} */
export function tplOf(ex) {
  /** @type {Obj|undefined} */
  let base;
  if (!ex.substitutedFor) base = tplByName(ex.n);
  return {
    n: ex.n, kind: ex.kind,
    load: ex.kind === 'weight' ? (ex.load ?? (base && base.kind === 'weight' ? base.load : undefined) ?? 'kg') : undefined,
    hold: ex.hold ?? (base ? !!base.hold : false),
    dist: ex.dist ?? (base ? base.dist ?? null : null),
    rep: ex.rep, rir: ex.tplRir, inc: ex.inc,
    dose: ex.dose ?? (base && base.kind === ex.kind ? base.dose ?? null : null),
    seed: base && base.kind === ex.kind ? base.seed : undefined
  };
}

/* Re-derives rec and the targets of still-planned sets. Done and legacy sets
   are observations and never change. An edit keeps the rule Dan was shown at
   the time, which is what its decision log records, and never reads its own
   saved copy as "last time". */
/** @param {Obj} d @param {Obj[]} history */
export function retarget(d, history) {
  const own = d.editing && d.originPath ? String(d.originPath).split('/').pop() : null;
  const hist = own ? history.filter(h => fileKey(h) !== own) : history;
  for (const ex of d.exercises) {
    const { rec, target } = targets(tplOf(ex), hist, d.date, d.isDeload);
    if (!d.editing) ex.rec = rec;
    for (const st of ex.sets) if (st.state === 'planned') st.target = target ? { ...target } : null;
  }
  d.week = weekOf(d.date);
  return d;
}

/** @param {Tpl} e @param {Obj[]} history @param {string} date @param {boolean} deload */
function exerciseFrom(e, history, date, deload) {
  const { rec, target } = targets(e, history, date, deload);
  /** @type {Obj} */
  const ex = { n: e.n, kind: e.kind };
  if (e.kind === 'weight') ex.load = e.load || 'kg';
  if (e.hold) ex.hold = true;
  if (e.dist != null) ex.dist = e.dist;
  if (e.dose != null) ex.dose = e.dose;
  if (e.routine) ex.routine = e.routine;
  Object.assign(ex, {
    note: '', tplNote: e.note || '', rep: e.rep || null, tplRir: e.rir ?? null, inc: e.inc ?? null,
    rest: e.rest ?? null, bar: e.bar ?? null, key: !!e.key, targetSets: e.sets || 3, substitutedFor: null, rec: rec || null
  });
  ex.sets = Array.from({ length: ex.targetSets }, () => blankSet(ex, target));
  return ex;
}
/** @param {string} key @param {Obj[]} history @param {string} dateIso @param {string} nowIso @param {boolean} [isDeload] */
export function newSession(key, history, dateIso, nowIso, isDeload) {
  const t = TEMPLATES[/** @type {keyof typeof TEMPLATES} */ (key)];
  const deload = !!isDeload && isLiftKey(key);
  return {
    schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION,
    date: dateIso, key, name: t.name, week: weekOf(dateIso), sessionRpe: null, symptoms: null,
    isDeload: deload, notes: '', startedAt: nowIso,
    exercises: key === 'floor' ? routineExercises(floorFor(dateIso), history, dateIso)
      : t.ex.map(e => exerciseFrom(e, history, dateIso, deload)),
    decisions: []
  };
}
/* The exercises of one or more routines, each tagged with its routine key.
   An exercise already in the session (by name) is not added twice. */
/** @param {string[]} keys @param {Obj[]} history @param {string} date @param {string[]} [have] names already in the session */
export function routineExercises(keys, history, date, have) {
  const seen = new Set(have || []);
  /** @type {Obj[]} */
  const out = [];
  for (const k of keys) {
    const r = ROUTINES[/** @type {keyof typeof ROUTINES} */ (k)];
    if (!r) continue;
    for (const e of r.ex) {
      if (seen.has(e.n)) continue;
      seen.add(e.n);
      out.push(exerciseFrom({ ...e, routine: k }, history, date, false));
    }
  }
  return out;
}
/** A one-off exercise added inside a session. @param {string} name */
export function customExercise(name) {
  return exerciseFrom({ n: name, kind: 'weight', sets: 3, inc: 2.5, rest: 120 }, [], '', false);
}

/* ------------------------------------------------------------- finishing */
/** @param {Obj} ex */
function decide(ex) {
  const rec = ex.rec, w = working(ex), load = loadOf(ex);
  /** @type {Obj} */
  const d = { ex: ex.n, rule: rec.rule, recKg: rec.kg ?? null, recReps: rec.reps ?? null };
  if (ex.kind === 'band') d.recBand = rec.band ?? null;
  if (!w.length) return { ...d, actualKg: null, why: rec.why, outcome: 'not-done', rirRef: null };
  const topReps = Math.max(...w.map(s => s.reps ?? 0));
  let ok;
  if (ex.kind === 'band') {
    d.actualBand = lastBand(w);
    /* No band on record means no load was proposed: nothing to accept. */
    if (rec.band == null) return { ...d, actualKg: null, why: rec.why, outcome: 'no-rec', rirRef: rirRef(ex) };
    ok = topReps >= (rec.reps ?? 0) && d.actualBand === rec.band;
  } else if (load === 'bw') ok = topReps >= (rec.reps ?? 0);
  else {
    const topKg = Math.max(...w.map(s => s.kg ?? 0));
    d.actualKg = topKg;
    ok = rec.kg != null && Math.abs(topKg - rec.kg) < 0.01;
  }
  if (!('actualKg' in d)) d.actualKg = null;
  /* 'All as shown' copied the target without Dan choosing anything, so it is
     kept apart from a real acceptance. Exclude it from override-rate analysis. */
  const allBulk = w.every(s => s.state === 'done' && s.via === 'bulk');
  return { ...d, why: rec.why, outcome: ok ? (allBulk ? 'bulk-accepted' : 'accepted') : 'overridden', rirRef: rirRef(ex) };
}

/* Pure. Returns {session} or {blocked:reason}. Nothing planned ever reaches a
   file: unticked working sets need Dan's explicit choice ('asShown' or 'drop'),
   and 'asShown' cannot confirm a set that has no target to copy. */
/** @param {Obj} draft @param {string} nowIso @param {'asShown'|'drop'} [choice] */
export function finishSession(draft, nowIso, choice) {
  const d = clone(draft);
  /** @type {[Obj, LSet][]} */
  const pending = [];
  for (const ex of d.exercises) for (const st of ex.sets) if (st.state === 'planned' && !st.warmup) pending.push([ex, st]);
  if (pending.length) {
    const stuck = pending.filter(([e, s]) => !canConfirm(e, s)).length;
    if (choice !== 'asShown' && choice !== 'drop') return { blocked: 'unticked', count: pending.length, noTarget: stuck };
    if (choice === 'asShown') {
      if (stuck) return { blocked: 'unticked', count: stuck, noTarget: stuck };
      for (const [e, s] of pending) confirmSet(e, s, 'bulk', nowIso);
    }
  }
  for (const ex of d.exercises) ex.sets = ex.sets.filter((/** @type {LSet} */ st) => st.state !== 'planned' && hasData(st));

  const n = d.exercises.reduce((/** @type {number} */ a, /** @type {Obj} */ ex) => a + ex.sets.filter(performed).length, 0);
  if (!n && !String(d.notes || '').trim()) return { blocked: 'empty' };

  const orig = d.editing ? (d.decisions || []) : [];
  /** @type {Obj[]} */
  const decisions = [];
  d.exercises = d.exercises.map((/** @type {Obj} */ ex) => {
    const touched = ex.sets.some((/** @type {LSet} */ s) => s.state === 'done');
    /* An edit that did not touch an exercise keeps its original decision. */
    if (d.editing && !touched && ex.sets.length) decisions.push(...orig.filter((/** @type {Obj} */ x) => x.ex === ex.n));
    else if (ex.rec) decisions.push(decide(ex));
    if (ex.sets.length) return ex;
    /* A skipped exercise keeps its shape (load type, range, increment) so an
       edit asks for the right fields, and its note, which is usually why it
       was skipped. */
    return { ...ex, rec: ex.rec ?? null, targetSets: ex.targetSets ?? null, sets: [], skipped: true };
  });

  const all = d.exercises.flatMap((/** @type {Obj} */ ex) => ex.sets);
  const done = all.filter((/** @type {LSet} */ s) => s.state === 'done' && s.doneAt).map((/** @type {LSet} */ s) => /** @type {string} */ (s.doneAt)).sort();
  const doneWork = d.exercises.flatMap((/** @type {Obj} */ ex) => ex.sets.filter((/** @type {LSet} */ s) => s.state === 'done' && !s.warmup));

  const s = { ...d, schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, decisions, week: weekOf(d.date) };
  const editing = !!d.editing;
  for (const k of ['editing', 'originPath', 'origDate', 'origKey']) delete s[k];
  if (editing) { s.editedAt = nowIso; if (!s.endedAt) s.endedAt = nowIso; }
  else s.endedAt = nowIso;
  s.savedAt = nowIso;
  s.firstDoneAt = done[0] || null;
  s.lastDoneAt = done[done.length - 1] || null;
  /* Live means ticked as it happened: mostly one-by-one, spread over at least
     ten minutes, on the day the session is dated. Anything else was entered
     from memory and deserves less weight. */
  /* An edit keeps how the session was originally logged. */
  if (editing && d.logMode) s.logMode = d.logMode;
  else if (doneWork.length) {
    const live = doneWork.filter((/** @type {LSet} */ x) => x.via === 'tick' || x.via === 'sheet').length / doneWork.length >= 0.5
      && s.lastDoneAt && s.firstDoneAt && (Date.parse(s.lastDoneAt) - Date.parse(s.firstDoneAt)) >= 10 * 60000
      && localISO(new Date(s.lastDoneAt)) === s.date;
    s.logMode = live ? 'live' : 'retro';
  } else if (!editing) s.logMode = 'retro';
  return { session: s };
}

/* Where a finished session goes, and whether an edit leaves a tombstone. A
   second session on the same day gets -2, -3; an edit keeps its own path
   unless its date or key changed. */
/** @param {Obj} draft @param {Obj} session @param {Obj[]} history @param {Obj[]} queue @param {string} dir @param {string} nowIso */
export function planSave(draft, session, history, queue, dir, nowIso) {
  const s = { ...session };
  const origin = draft.editing ? (draft.originPath || null) : null;
  let path;
  if (origin && draft.origDate === s.date && draft.origKey === s.key) path = origin;
  else {
    const occupied = new Set();
    for (const x of [...history, ...queue]) {
      if (!x || x.deleted) continue;
      const p = pathOf(x, dir);
      if (p === origin) continue;
      if (s.id && x.id === s.id) continue;
      occupied.add(p);
    }
    const base = dir + '/' + s.date + '-' + s.key;
    path = base + '.json';
    for (let n = 2; occupied.has(path); n++) path = base + '-' + n + '.json';
  }
  s.file = path;
  const items = [];
  if (origin && path !== origin) {
    const orig = [...queue].reverse().find(x => !x.deleted && pathOf(x, dir) === origin)
      || history.find(h => pathOf(h, dir) === origin);
    /** @type {Obj} */
    const tomb = orig ? { ...orig, deleted: true, savedAt: nowIso }
      : { date: draft.origDate, key: draft.origKey, name: s.name, deleted: true, savedAt: nowIso };
    delete tomb.qid;
    if (pathOf(tomb, dir) !== origin) tomb.file = origin;
    items.push(tomb);
  }
  items.push(s);
  return { session: s, items };
}

/* Opens a saved session for editing. A suspect prefill stays marked
   unverified through the edit: saving an edit is not a confirmation. Skipped
   exercises get one blank set to fill in, and a legacy weight exercise gets
   its load type from the template so the sheet asks for the right fields. */
/** @param {Obj} item a merged-history session @param {string} dir */
export function editDraft(item, dir) {
  const d = migrateSession(item);
  delete d.qid;
  Object.assign(d, { editing: true, originPath: pathOf(item, dir), origDate: item.date, origKey: item.key });
  if (isSuspectPrefill(item) && item.verified !== true) d.unverified = true;
  for (const e of d.exercises || []) {
    if (e.kind === 'weight' && !e.load) e.load = shownLoad(e);
    if (!e.sets || !e.sets.length) { e.sets = [blankSet(e, null)]; delete e.skipped; }
  }
  return d;
}
/* An unfinished session left open this long gets the Finish-or-Discard
   banner. An edit of a saved session is old by design and never does. */
/** @param {Obj} d @param {number} nowMs */
export const isStaleDraft = (d, nowMs) => !!d && !d.editing && !!d.startedAt && nowMs - Date.parse(d.startedAt) > 12 * 3600e3;

/** Pinches recorded in the app's own files. @param {Obj[]} history */
export const countPinches = history => history.filter(s => Array.isArray(s.symptoms)
  && s.symptoms.some((/** @type {Obj} */ x) => x && x.area === 'low-back' && x.type === 'pinch')).length;
/* Where a pinch logged now falls. total is null while the number before the
   app is not set, so the page asks for it rather than under-counting. */
/** @param {number|null|undefined} prior @param {Obj[]} history */
export function pinchCount(prior, history) {
  const inApp = countPinches(history) + 1;
  const total = typeof prior === 'number' && prior >= 0 ? prior + inApp : null;
  return { inApp, total, physio: total != null && total >= PHYSIO_AT };
}

/* ------------------------------------------------------------- the week */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/* The schedule is the templates' own day. A session counts for its template
   anywhere in the same ISO week: moving Tuesday to Thursday is not a miss. */
/** @param {Obj[]} list merged history, suspects included @param {string} todayIso */
export function weekPlan(list, todayIso) {
  const wk = weekOf(todayIso);
  return Object.entries(TEMPLATES).filter(([, t]) => WEEKDAYS.includes(t.day)).map(([key, t]) => {
    const date = addDays(wk, WEEKDAYS.indexOf(t.day));
    const hits = list.filter(s => s.key === key && !s.deleted && weekOf(s.date) === wk);
    const real = hits.filter(s => !isSuspectPrefill(s) || s.verified === true);
    const state = real.length ? 'done' : hits.length ? 'unverified'
      : date === todayIso ? 'today' : date < todayIso ? 'missed' : 'upcoming';
    return { day: t.day, key, name: t.name, date, state };
  });
}
/* Today's template if it is due; otherwise the earliest one not yet done. */
/** @param {ReturnType<typeof weekPlan>} plan */
export function nextTemplate(plan) {
  const today = plan.find(p => p.state === 'today');
  if (today) return today.key;
  const open = plan.find(p => p.state === 'missed' || p.state === 'upcoming');
  return open ? open.key : null;
}

/* ---------------------------------------------------------- deload check */
/** @param {Obj[]} history @param {string} w */
export const sessionsInWeek = (history, w) => history.filter(h => isLift(h) && weekOf(h.date) === w && !h.isDeload);
/** @param {Obj[]} history @param {string} todayIso */
export function weeksSinceDeload(history, todayIso) {
  const lifts = history.filter(isLift);
  const d = lifts.find(h => h.isDeload);
  const first = lifts[lifts.length - 1];
  const from = d ? d.date : (first ? first.date : null);
  return from ? weeksBetween(weekOf(from), weekOf(todayIso)) : 0;
}
/** @param {Obj[]} history analysis history, newest first @param {Obj[]} bw @param {Obj} settings @param {string} todayIso */
export function deloadCheck(history, bw, settings, todayIso) {
  const lifts = history.filter(isLift);
  const codes = [];
  const thisWeek = weekOf(todayIso);
  const prevWeek = lifts.length ? weekOf(lifts[0].date) : thisWeek;
  const wk = sessionsInWeek(lifts, thisWeek).length ? thisWeek : prevWeek;
  const week = sessionsInWeek(lifts, wk);
  const daysAgo = (/** @type {string} */ iso) => daysBetween(iso, todayIso);

  /* Cadence. The coach’s rule, not a proposal: every 4–6 weeks. */
  const wsd = weeksSinceDeload(lifts, todayIso);
  if (lifts.length && wsd >= (settings.deloadWeeks || 5))
    codes.push({ c: 'CADENCE', sev: 'severe', t: wsd + ' weeks since the last deload. Programme says every 4–6.' });

  /* D1: estimated 1RM regression on the main lifts. */
  const keys = new Set(); for (const t of Object.values(TEMPLATES)) for (const e of t.ex) if (e.key) keys.add(e.n);
  const regressed = [];
  for (const k of keys) {
    const series = lifts.filter(h => !h.isDeload)
      .map(h => { const ex = (h.exercises || []).find((/** @type {Obj} */ e) => e.n === k); return ex ? { d: h.date, v: sessionE1rm(ex) } : null; })
      .filter(x => x && x.v);
    if (series.length < 5) continue;
    const recent = median(series.slice(0, 3).map(x => /** @type {number} */ (x && x.v)));
    const older = series.filter(x => x && daysAgo(x.d) <= 42).slice(3).map(x => /** @type {number} */ (x && x.v));
    if (!older.length || recent == null) continue;
    if (recent < Math.max(...older) * 0.95) regressed.push(k);
  }
  if (regressed.length >= 2) codes.push({ c: 'D1', sev: 'severe', t: 'Estimated 1RM down over 5% on ' + regressed.join(' and ') + '.' });

  /* D2: RIR compression against the programme’s own targets. */
  let compressed = 0;
  for (const h of week) for (const ex of (h.exercises || [])) {
    if (ex.tplRir == null) continue;
    const m = median(working(ex).map(s => s.rir).filter(r => r != null).map(Number));
    if (m != null && m <= ex.tplRir - 1.5) compressed++;
  }
  if (compressed >= 3) codes.push({ c: 'D2', sev: 'severe', t: 'Sets landing 1.5 RIR harder than prescribed on ' + compressed + ' exercises.' });

  /* D3: rep failure rate, over sets actually performed. */
  let tot = 0, miss = 0;
  for (const h of week) for (const ex of (h.exercises || [])) {
    if (!ex.rep || ex.kind !== 'weight') continue;
    for (const s of working(ex)) { tot++; if ((s.reps ?? 0) < ex.rep[0]) miss++; }
  }
  if (tot >= 6 && miss / tot >= 0.30) codes.push({ c: 'D3', sev: 'mod', t: Math.round(miss / tot * 100) + '% of working sets fell below the rep range.' });

  /* D4: whole-session effort, Borg CR10. A different scale from set RIR. */
  const rpes = week.map(h => h.sessionRpe).filter(v => v != null);
  if (rpes.length >= 2 && rpes.reduce((a, b) => a + b, 0) / rpes.length >= 9)
    codes.push({ c: 'D4', sev: 'mod', t: 'Session RPE averaging 9+ this week.' });

  /* D5: attendance. Context only, never evidence on its own. */
  if (lifts.length >= 4 && week.length && week.length <= 2)
    codes.push({ c: 'D5', sev: 'info', t: 'Only ' + week.length + ' of 4 sessions logged this week.' });

  /* D6: bodyweight drop. Off while the block is a deliberate cut. */
  if (settings.phase !== 'cut') {
    const w = (bw || []).filter(b => b.type === 'bw' && b.kg);
    const recent = w.filter(b => daysAgo(b.date) <= 7).map(b => b.kg);
    const before = w.filter(b => daysAgo(b.date) > 7 && daysAgo(b.date) <= 14).map(b => b.kg);
    if (recent.length >= 3 && before.length >= 3) {
      const a = /** @type {number} */ (median(before)), b = /** @type {number} */ (median(recent));
      if (b < a * 0.98) codes.push({ c: 'D6', sev: 'mod', t: 'Bodyweight down over 2% in a week outside a cut.' });
    }
  }
  const severe = codes.filter(x => x.sev === 'severe'), mods = codes.filter(x => x.sev === 'mod');
  return { codes, fire: severe.length >= 1 || mods.length >= 2 };
}

/* ------------------------------------------------------------- display */
/* Pre-v5 exercises carry no load type; for display it is read from the
   template of the same name, so a legacy leg raise reads BW, not 0. */
/** @param {Obj} ex */
function shownLoad(ex) {
  if (ex.kind !== 'weight') return null;
  if (ex.load) return ex.load;
  for (const t of Object.values(TEMPLATES)) { const e = t.ex.find(x => x.n === ex.n); if (e && e.kind === 'weight') return e.load || 'kg'; }
  return 'kg';
}
/** kg as Dan reads it for this exercise. @param {Obj} ex @param {number|null|undefined} kg */
function kgText(ex, kg) {
  if (shownLoad(ex) === 'bw+') return kg == null ? 'BW+?' : kg === 0 ? 'BW' : 'BW+' + kg;
  return (kg ?? '?') + ' kg';
}
/* What a set row shows: the observation when performed, else the target. */
/** @param {Obj} ex @param {LSet} st */
export function setText(ex, st) {
  /** @type {Obj} */
  let v = st;
  if (st.state === 'planned') {
    v = { ...(st.target || {}) };
    for (const k of fieldsOf(ex)) if (/** @type {Obj} */ (st)[k] != null) v[k] = /** @type {Obj} */ (st)[k];
  }
  if (fieldsOf(ex).every(k => v[k] == null)) return 'tap to enter';
  let t;
  switch (ex.kind) {
    case 'weight': t = shownLoad(ex) === 'bw' ? (v.reps ?? '?') + ' reps' : kgText(ex, v.kg) + ' × ' + (v.reps ?? '?'); break;
    case 'band': t = (v.band || 'band?') + ' × ' + (v.reps ?? '?'); break;
    case 'distance': t = (v.kg ?? '?') + ' kg · ' + (v.metres ?? '?') + ' m'; break;
    case 'time': t = (v.seconds ?? '?') + ' s'; break;
    case 'rounds': t = (v.rounds ?? '?') + ' rounds'; break;
    default: t = (v.reps ?? '?') + ' reps';
  }
  return t + (st.rir != null ? ' @' + st.rir : '');
}
/** Short value without RIR. @param {Obj} ex @param {Obj} s */
function shortText(ex, s) {
  switch (ex.kind) {
    case 'weight': {
      const l = shownLoad(ex);
      if (l === 'bw') return '×' + (s.reps ?? '?');
      if (l === 'bw+') return (s.kg ? 'BW+' + s.kg : 'BW') + '×' + (s.reps ?? '?');
      return (s.kg ?? '?') + '×' + (s.reps ?? '?');
    }
    case 'band': return (s.band || 'band?') + '×' + (s.reps ?? '?');
    case 'distance': return (s.kg ?? '?') + 'kg×' + (s.metres ?? '?') + 'm';
    case 'time': return (s.seconds ?? '?') + 's';
    case 'rounds': return (s.rounds ?? '?') + 'r';
    default: return String(s.reps ?? '?');
  }
}
/** Every working set, each with its RIR. @param {Obj} ex */
export const summarise = ex => working(ex).map(s => shortText(ex, s) + (s.rir != null ? ' @' + s.rir : '')).join('  ');
/** '75×5 ×4 @2': grouped, with the last-set RIR. @param {Obj} ex */
export function compact(ex) {
  const w = working(ex);
  if (!w.length) return '';
  /** @type {[string, number][]} */
  const g = [];
  for (const s of w) { const t = shortText(ex, s); if (g.length && g[g.length - 1][0] === t) g[g.length - 1][1]++; else g.push([t, 1]); }
  const r = rirRef(ex);
  return g.map(([t, n]) => t + (n > 1 ? ' ×' + n : '')).join(', ') + (r != null ? ' @' + r : '');
}

/* ------------------------------------------------------ local storage */
/** @param {Obj} prev */
function mergeSettings(prev) {
  const s = { ...clone(DEFAULTS.settings), ...(prev && typeof prev === 'object' ? prev : {}) };
  if (!Array.isArray(s.bands) || !s.bands.length) s.bands = DEFAULT_BANDS.slice();
  return s;
}
/** The template entry of the same name, if any. @param {string} n @returns {Tpl|undefined} */
function tplByName(n) {
  for (const t of [...Object.values(TEMPLATES), ...Object.values(ROUTINES)]) { const e = t.ex.find(x => x.n === n); if (e) return e; }
  return undefined;
}
/* The target a v4 draft's set gets in the v5 shape of its exercise. */
/** @param {Obj} ex @param {Obj|null|undefined} rec the v4 rec (kg/reps) */
function v4Target(ex, rec) {
  if (ex.kind === 'weight') {
    if (loadOf(ex) === 'bw') return rec && rec.reps != null ? { reps: rec.reps } : null;
    return rec && rec.kg != null ? { kg: rec.kg, reps: rec.reps } : null;
  }
  if (ex.kind === 'band') return rec && rec.reps != null ? { band: null, reps: rec.reps } : null;
  if (ex.kind === 'distance') return ex.dist != null ? { kg: null, metres: ex.dist } : null;
  return null;
}
/* A v4 draft prefilled kg/reps from rec, so a set still exactly equal to rec
   with no RIR and not ticked is the untouched prefill: it becomes a planned
   target for Dan to tick. A set ticked in v4 (done:true) was an explicit
   confirmation, so it is legacy, as is anything else with data.
   A v4 draft in progress is also re-shaped to its v5 template: Pallof becomes
   a band exercise with no kg, carries get their distance, bodyweight lifts
   their load type. An edit of a saved session is all history and is left as
   it is. */
/** @param {Obj|null|undefined} prevDraft */
export function migrateDraft(prevDraft) {
  if (!prevDraft) return null;
  const d = clone(prevDraft);
  if ((d.schemaVersion || 0) >= SCHEMA_VERSION && (d.exercises || []).every((/** @type {Obj} */ e) => (e.sets || []).every((/** @type {LSet} */ s) => s.state)))
    return d;
  if (!Array.isArray(d.exercises)) throw new Error('draft has no exercise list');
  for (const ex of d.exercises) {
    if (!Array.isArray(ex.sets)) throw new Error('exercise has no set list');
    const v4rec = ex.rec, wasWeight = ex.kind === 'weight';
    const t = !d.editing && !ex.substitutedFor ? tplByName(ex.n) : undefined;
    if (t && ex.sets.every((/** @type {LSet} */ s) => !s.state)) {
      ex.kind = t.kind;
      if (t.kind === 'weight') ex.load = t.load || 'kg'; else delete ex.load;
      if (t.hold) ex.hold = true;
      if (t.dist != null) ex.dist = t.dist;
      ex.rep ??= t.rep || null; ex.tplRir ??= t.rir ?? null; ex.inc ??= t.inc ?? null;
      ex.rest ??= t.rest ?? null; ex.bar ??= t.bar ?? null; ex.key ??= !!t.key; ex.tplNote ??= t.note || '';
      ex.targetSets ??= t.sets || 3;
      /* A kg rule means nothing for a band or a bodyweight-only lift. */
      if (ex.kind === 'band' || loadOf(ex) === 'bw') ex.rec = null;
    }
    for (const st of ex.sets) {
      if (st.state) continue;
      if (hasData(st)) {
        const prefill = !d.editing && wasWeight && v4rec && st.done !== true
          && st.kg === v4rec.kg && st.reps === v4rec.reps && st.rir == null;
        if (prefill) {
          st.kg = null; st.reps = null; delete st.done;
          Object.assign(st, { state: 'planned', target: v4Target(ex, v4rec), doneAt: null, via: null });
        } else Object.assign(st, { state: 'legacy', doneAt: null, via: null, target: null });
      } else {
        delete st.done;
        Object.assign(st, { state: 'planned', target: d.editing ? null : v4Target(ex, v4rec), doneAt: null, via: null });
      }
      if (st.state === 'planned') for (const k of fieldsOf(ex)) if (!(k in st)) st[k] = null;
    }
  }
  return d;
}
/* Migrates the draft without letting a malformed one take the rest of the
   state (token, queue, history) down with it. A draft that will not migrate
   is handed back raw as brokenDraft, for the caller to copy aside. */
/** @param {Obj} s */
function safeDraft(s) {
  if (!s.draft) { s.draft = null; return s; }
  try { s.draft = migrateDraft(s.draft); }
  catch (e) { s.brokenDraft = s.draft; s.draft = null; }
  return s;
}
/** From a ledger_v4 / ledger_v3 blob. @param {Obj} prev */
export function migrateState(prev) {
  if (!prev || typeof prev !== 'object') throw new Error('not a state object');
  /** @type {Obj} */
  const s = safeDraft({
    v: 5,
    settings: mergeSettings(prev.settings),
    draft: clone(prev.draft) || null,
    queue: clone(Array.isArray(prev.queue) ? prev.queue : []),
    bwQueue: clone(Array.isArray(prev.bwQueue) ? prev.bwQueue : []),
    history: clone(Array.isArray(prev.history) ? prev.history : []),
    bw: clone(Array.isArray(prev.bw) ? prev.bw : []),
    historyFetched: prev.historyFetched || 0
  });
  /* v4 asked for bodyweight inside the session and queued it at finish. v5
     keeps it on the Body tab, so a weight typed into an open v4 session is
     queued to bw-YYYY-MM.json now instead of landing in the session file. */
  const d = s.draft;
  if (d && !d.editing && 'bodyweight' in d) {
    const kg = typeof d.bodyweight === 'number' ? d.bodyweight : null;
    if (kg != null && kg > 0 && d.date) s.bwQueue.push({ type: 'bw', date: d.date, kg, loggedAt: d.startedAt || null });
    delete d.bodyweight;
  }
  return s;
}
/** A ledger_v5 blob, filled out with defaults. @param {Obj} obj */
export function normaliseState(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not a state object');
  const s = { ...clone(DEFAULTS), ...clone(obj), v: 5 };
  s.settings = mergeSettings(obj.settings);
  for (const k of ['queue', 'bwQueue', 'history', 'bw']) if (!Array.isArray(s[k])) s[k] = [];
  return safeDraft(s);
}

/* Which phone storage to trust. ledger_v5 wins. The older keys are read only
   when ledger_v5 has never existed (the first run after the upgrade): once v5
   exists, v4 is a frozen snapshot of upgrade day, and restoring its queue
   would re-push stale files over newer ones. So an unreadable ledger_v5 is
   copied aside and only the settings (the token) are taken from an older key;
   history then reloads from GitHub. Pure: `get` reads a key.
   backups: raw values the caller must copy aside. notice: what to tell Dan. */
export const LS_KEY = 'ledger_v5';
export const OLDER_KEYS = ['ledger_v4', 'ledger_v3'];
/** @param {(k:string)=>string|null} get */
export function loadState(get) {
  /** @type {{key:string, raw:string}[]} */
  const backups = [];
  /** @type {string|null} */
  let notice = null;
  /** @param {Obj} s */
  const done = s => {
    if ('brokenDraft' in s) {
      backups.push({ key: 'draft', raw: JSON.stringify(s.brokenDraft) });
      delete s.brokenDraft;
      notice = notice || 'draft-unreadable';
    }
    return { state: s, backups, notice };
  };
  const raw5 = get(LS_KEY);
  if (raw5) {
    try { return done(normaliseState(JSON.parse(raw5))); }
    catch (e) {
      backups.push({ key: LS_KEY, raw: raw5 });
      const s = normaliseState(clone(DEFAULTS));
      for (const k of OLDER_KEYS) {
        try {
          const o = JSON.parse(get(k) || 'null');
          if (o && typeof o === 'object' && o.settings && typeof o.settings === 'object') { s.settings = mergeSettings(o.settings); break; }
        } catch (e2) { /* nothing usable there either */ }
      }
      notice = 'v5-unreadable';
      return done(s);
    }
  }
  for (const k of OLDER_KEYS) {
    const raw = get(k);
    if (!raw) continue;
    try { return done(migrateState(JSON.parse(raw))); }
    catch (e) { backups.push({ key: k, raw }); }
  }
  return done(normaliseState(clone(DEFAULTS)));
}
