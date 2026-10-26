// @ts-check
/* Liftless: health data from the phone (Health Connect), as pure rules
   (build 5-22). No DOM, no network: samples and the date are passed in.
   Spec: Sprint 3 item l-health (board) and the research of 2026-10-25.
   Readiness follows the evidence: sleep as a run of nights, resting heart
   rate and HRV against the person's own usual level, never one-day scores. */

/** @typedef {Record<string, any>} Obj */
/** @typedef {{day:string, sleep_min:number|null, resting_hr:number|null, hrv_ms:number|null, steps:number|null, weight_kg:number|null}} Day */

/** Calendar date of an instant in a time zone, YYYY-MM-DD. @param {string} iso @param {string} tz */
export function localDay(iso, tz) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const ASLEEP = new Set(['asleep', 'light', 'deep', 'rem']);
/* Minutes asleep in one sleep sample: its stages when it has them (awake
   and in-bed time left out), else its own value unless it is marked awake. */
/** @param {Obj} s */
export function asleepMinutes(s) {
  if (Array.isArray(s.stages) && s.stages.length)
    return s.stages.filter(st => ASLEEP.has(st.stage)).reduce((a, st) => a + (Number(st.durationMinutes) || 0), 0);
  if (s.sleepState && !ASLEEP.has(s.sleepState)) return 0;
  return Number(s.value) || 0;
}

const avg = (/** @type {number[]} */ a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const r1 = (/** @type {number|null} */ v) => v == null ? null : Math.round(v * 10) / 10;

/* One row per day from the plugin's samples. Sleep counts on the day it
   ends (the morning you wake up); steps come pre-summed per day. Values
   outside believable ranges are dropped, never stored. */
/** @param {{sleep?:Obj[], restingHeartRate?:Obj[], heartRateVariability?:Obj[], steps?:Obj[], weight?:Obj[]}} s @param {string} tz @returns {Day[]} */
export function dailyRows(s, tz) {
  /** @type {Map<string, {sleep:number[], rhr:number[], hrv:number[], steps:number[], w:{t:string, v:number}[]}>} */
  const m = new Map();
  const at = (/** @type {string|null} */ d) => { if (!d) return null; if (!m.has(d)) m.set(d, { sleep: [], rhr: [], hrv: [], steps: [], w: [] }); return m.get(d); };
  for (const x of s.sleep || []) { const b = at(localDay(x.endDate, tz)); if (b) b.sleep.push(asleepMinutes(x)); }
  for (const x of s.restingHeartRate || []) { const b = at(localDay(x.startDate, tz)); if (b && x.value >= 20 && x.value <= 200) b.rhr.push(x.value); }
  for (const x of s.heartRateVariability || []) { const b = at(localDay(x.startDate, tz)); if (b && x.value >= 1 && x.value <= 400) b.hrv.push(x.value); }
  for (const x of s.steps || []) { const b = at(localDay(x.startDate, tz)); if (b && x.value >= 0) b.steps.push(x.value); }
  for (const x of s.weight || []) { const b = at(localDay(x.startDate, tz)); if (b && x.value >= 20 && x.value <= 400) b.w.push({ t: x.startDate, v: x.value }); }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, b]) => {
    const sl = b.sleep.reduce((x, y) => x + y, 0), st = b.steps.reduce((x, y) => x + y, 0);
    const w = b.w.sort((p, q) => p.t.localeCompare(q.t)).pop();
    return {
      day,
      sleep_min: b.sleep.length && sl > 0 ? Math.min(1440, Math.round(sl)) : null,
      resting_hr: r1(avg(b.rhr)),
      hrv_ms: r1(avg(b.hrv)),
      steps: b.steps.length ? Math.min(200000, Math.round(st)) : null,
      weight_kg: w ? r1(w.v) : null
    };
  });
}

const median = (/** @type {number[]} */ a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

/* What Home and the coach read: last night, the week, and the person's own
   usual level (median of the 28 days before the last 7). Flags only on a
   pattern: two short nights in the last three, or the 7-day resting heart
   rate at least 5 bpm over usual, or the 7-day HRV 15% under usual. */
/** @param {Day[]} rows @param {string} today @param {(iso:string, n:number)=>string} addDays */
export function recovery(rows, today, addDays) {
  const by = new Map(rows.map(r => [r.day, r]));
  const last = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => by.get(addDays(today, -i))).filter(Boolean);
  const vals = (/** @type {Day[]} */ list, /** @type {keyof Day} */ k) => list.map(r => r[k]).filter(v => typeof v === 'number');
  const week = last(7), base = Array.from({ length: 28 }, (_, i) => by.get(addDays(today, -7 - i))).filter(Boolean);
  const night = by.get(today) && by.get(today).sleep_min != null ? by.get(today) : by.get(addDays(today, -1));
  const out = {
    lastNight: night && night.sleep_min != null ? night.sleep_min : null,
    sleepAvg7: r1(avg(/** @type {number[]} */ (vals(week, 'sleep_min')))),
    rhr7: r1(avg(/** @type {number[]} */ (vals(week, 'resting_hr')))), rhrUsual: r1(median(/** @type {number[]} */ (vals(base, 'resting_hr')))),
    hrv7: r1(avg(/** @type {number[]} */ (vals(week, 'hrv_ms')))), hrvUsual: r1(median(/** @type {number[]} */ (vals(base, 'hrv_ms')))),
    flags: /** @type {string[]} */ ([])
  };
  const short = last(3).filter(r => r.sleep_min != null && r.sleep_min < 360).length;
  if (short >= 2) out.flags.push('short-sleep');
  if (out.rhr7 != null && out.rhrUsual != null && out.rhr7 >= out.rhrUsual + 5) out.flags.push('rhr-high');
  if (out.hrv7 != null && out.hrvUsual != null && out.hrv7 <= out.hrvUsual * 0.85) out.flags.push('hrv-low');
  return out;
}

/** 6 h 40 min. @param {number|null} min */
export const hm = min => min == null ? '—' : Math.floor(min / 60) + ' h ' + String(Math.round(min % 60)).padStart(2, '0');

/* What the session preview says (5-23). A pattern offers a lighter session,
   with the numbers that led to it; one short night gets a note only. */
/** @param {Day[]} rows @param {string} today @param {(iso:string, n:number)=>string} addDays @returns {null | {level:'lighter'|'note', why:string[]}} */
export function advice(rows, today, addDays) {
  if (!rows || !rows.length) return null;
  const r = recovery(rows, today, addDays), why = [];
  if (r.flags.includes('short-sleep')) {
    const nights = [0, 1, 2].map(i => rows.find(x => x.day === addDays(today, -i))).filter(x => x && x.sleep_min != null).map(x => hm(/** @type {number} */ (x.sleep_min)));
    why.push('Short sleep: ' + nights.join(', ') + ' in the last three nights.');
  }
  if (r.flags.includes('rhr-high')) why.push('Resting heart rate ' + r.rhr7 + ' this week against your usual ' + r.rhrUsual + '.');
  if (r.flags.includes('hrv-low')) why.push('HRV ' + r.hrv7 + ' ms this week against your usual ' + r.hrvUsual + ' ms.');
  if (why.length) return { level: 'lighter', why };
  if (r.lastNight != null && r.lastNight < 360) return { level: 'note', why: ['Short night: ' + hm(r.lastNight) + '. Fine to train; end a set when form breaks.'] };
  return null;
}
