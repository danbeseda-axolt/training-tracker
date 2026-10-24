// @ts-check
/* Liftless: progress per lift, as pure rules (build 5-21). No DOM, no network,
   no clock: dates and the engine's e1rm are passed in, so node tests cover it.
   Spec: projects/ledger-ux-research-2026-10-24.md (Home = progress, lift page). */

/** @typedef {Record<string, any>} Obj */
/** @typedef {{date:string, v:number, kg:number, reps:number, pr:boolean}} Point */

/* "Bench press (heavy)" and "Bench press (volume)" are one lift on a chart. */
/** @param {string} n */
export const baseName = n => String(n || '').replace(/\s*\((heavy|volume)\)\s*$/i, '').trim();

const performed = (/** @type {Obj} */ st) => st && !st.warmup && st.state !== 'planned' && st.kg != null && st.reps;

/* One estimated max per session: the engine's (RIR-aware) where a set has
   RIR, else Epley at RIR 0, which can only under-read. Sets past 12
   effective reps are ignored, as in the engine. */
/** @param {Obj} ex @param {(kg:number, reps:number, rir:number|null)=>number|null} e1rm */
export function exerciseBest(ex, e1rm) {
  let best = null;
  for (const st of ex.sets || []) {
    if (!performed(st) || !(st.kg > 0)) continue;
    const v = e1rm(st.kg, st.reps, st.rir ?? 0);
    if (v && (!best || v > best.v)) best = { v, kg: st.kg, reps: st.reps };
  }
  return best;
}

/* Oldest first; one point per session date (the better one if two sessions
   share a date); pr marks each new best. Deleted and unverified sessions are
   left out, as everywhere the app reads progress. */
/** @param {Obj[]} history @param {string} base @param {(kg:number, reps:number, rir:number|null)=>number|null} e1rm @returns {Point[]} */
export function liftSeries(history, base, e1rm) {
  /** @type {Map<string, Point>} */
  const byDate = new Map();
  for (const h of history || []) {
    if (!h || h.deleted || h.unverified) continue;
    for (const ex of h.exercises || []) {
      if (baseName(ex.n) !== base) continue;
      const b = exerciseBest(ex, e1rm);
      if (!b) continue;
      const cur = byDate.get(h.date);
      if (!cur || b.v > cur.v) byDate.set(h.date, { date: h.date, v: Math.round(b.v * 10) / 10, kg: b.kg, reps: b.reps, pr: false });
    }
  }
  const pts = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  let best = 0;
  for (const p of pts) if (p.v > best) { p.pr = true; best = p.v; }
  return pts;
}

/* The lift card: latest, change since the last point at least 28 days back
   (or the first point), and whether the latest is the best. */
/** @param {Point[]} pts @param {string} today ISO date @param {(iso:string, n:number)=>string} addDays */
export function cardStats(pts, today, addDays) {
  if (!pts.length) return null;
  const last = pts[pts.length - 1], cut = addDays(today, -28);
  const ref = [...pts].reverse().find(p => p.date <= cut) || pts[0];
  const best = Math.max(...pts.map(p => p.v));
  return { last: last.v, change: Math.round((last.v - ref.v) * 10) / 10, since: ref.date, isBest: last.v >= best, n: pts.length };
}

/* Which lifts get a card on Home: the programme's main lifts (key: true) in
   programme order, then other weighted lifts with data, at most `max`, each
   with at least two sessions so a card always has a line. */
/** @param {Obj[]} days programme days or templates, each {ex:[...]} @param {(base:string)=>number} countFor @param {number} [max] */
export function homeLifts(days, countFor, max = 4) {
  const keyN = [], other = [];
  for (const d of days || []) for (const e of d.ex || []) {
    if (e.kind !== 'weight' || e.load === 'bw') continue;
    const b = baseName(e.n);
    if (keyN.includes(b) || other.includes(b)) continue;
    (e.key ? keyN : other).push(b);
  }
  return [...keyN, ...other].filter(b => countFor(b) >= 2).slice(0, max);
}

/* Best kg at each rep count 1–12, newest date on a tie. */
/** @param {Obj[]} history @param {string} base @returns {{reps:number, kg:number, date:string}[]} */
export function repRecords(history, base) {
  /** @type {Map<number, {reps:number, kg:number, date:string}>} */
  const m = new Map();
  for (const h of history || []) {
    if (!h || h.deleted || h.unverified) continue;
    for (const ex of h.exercises || []) {
      if (baseName(ex.n) !== base) continue;
      for (const st of ex.sets || []) {
        if (!performed(st) || st.reps > 12 || !(st.kg > 0)) continue;
        const cur = m.get(st.reps);
        if (!cur || st.kg > cur.kg || (st.kg === cur.kg && h.date > cur.date)) m.set(st.reps, { reps: st.reps, kg: st.kg, date: h.date });
      }
    }
  }
  return [...m.values()].sort((a, b) => a.reps - b.reps);
}

/* Points inside a range: '1m' 31 days, '3m' 92, '1y' 366, 'all'. */
/** @param {Point[]} pts @param {string} range @param {string} today @param {(iso:string, n:number)=>string} addDays */
export function inRange(pts, range, today, addDays) {
  const days = { '1m': 31, '3m': 92, '1y': 366 }[range];
  if (!days) return pts;
  const cut = addDays(today, -days);
  return pts.filter(p => p.date >= cut);
}

/* Weeks in a row, ending this week or last, with at least one lift session.
   A week not yet over never breaks the streak. weekOf returns the Monday. */
/** @param {string[]} dates lift-session dates @param {string} today @param {(iso:string)=>string} weekOf @param {(iso:string, n:number)=>string} addDays */
export function weekStreak(dates, today, weekOf, addDays) {
  const weeks = new Set(dates.map(weekOf));
  let wk = weekOf(today);
  if (!weeks.has(wk)) wk = addDays(wk, -7);
  let n = 0;
  while (weeks.has(wk)) { n++; wk = addDays(wk, -7); }
  return n;
}
