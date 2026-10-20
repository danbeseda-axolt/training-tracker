// @ts-check
/* Ledger: what the Log tab shows, as pure rules (build 5-16). No DOM, no
   network, no clock; imports nothing (engine results are passed in), so node
   tests cover every case. Spec: projects/ledger-ux-log-declutter.md. The
   engine (deloadCheck, blockInfo, weekPlan) is not changed: these functions
   only choose which of its results the screen shows. */

/** @typedef {Record<string, any>} Obj */
/** @typedef {{c:string, sev:string, t:string}} Code */

/* The deload banner (spec section 2): shown exactly when Start would start a
   deload (the engine's `fire`). A scheduled deload week (BLOCK) is a calm
   info banner, hidden once the week's sessions are all done; otherwise the
   reasons are the codes that made it fire (the severe ones, or the moderate
   ones when no severe one is there). No banner for no codes, D5 alone or a
   single moderate code. */
/** @param {{codes: Code[], fire: boolean}} dc @param {{weekDone?: boolean}} [o] @returns {null | {kind:'week'|'due', reasons:string[]}} */
export function deloadBanner(dc, o = {}) {
  if (!dc || !dc.fire) return null;
  if (dc.codes.some(c => c.c === 'BLOCK')) return o.weekDone ? null : { kind: 'week', reasons: [] };
  const severe = dc.codes.filter(c => c.sev === 'severe');
  const why = severe.length ? severe : dc.codes.filter(c => c.sev === 'mod');
  return { kind: 'due', reasons: why.map(c => c.t) };
}
/** @param {number} pct e.g. 65 */
export const deloadCopy = pct => ({
  week: '<b>Deload week.</b> Every session this week starts lighter: ' + pct + '% of working load, half the accessory sets, RIR 3–4. It should feel easy.',
  due: '<b>Time to deload.</b> Sessions start lighter while this shows: ' + pct + '% of working load, at the bottom of each rep range.'
});

/* Settings → Programme → Fatigue check (Dan only): every code, and a verdict. */
/** @param {{codes: Code[], fire: boolean}} dc */
export function fatigueCheck(dc) {
  const items = (dc && dc.codes) || [];
  return { items, verdict: !items.length ? 'Nothing to flag.' : dc.fire ? 'Deload due: the next session starts lighter.' : 'Not enough for a deload.' };
}

/* The one line under Start, only in weeks where the kind of work changes
   (spec 3.1). Deload weeks get none: their banner says it. */
export const PHASE_NOTES = /** @type {Record<number, string>} */ ({
  1: 'Week 1: ramp each main lift to one top set at RIR 2. No kg targets.',
  7: 'New phase: Build. Heavy lifts are now one top set and two lighter back-offs, 3×4.',
  13: 'New phase: Intensify. Heavy lifts drop to 3×3, back-offs 10% lighter.',
  19: 'Test week: triples on the heavy lifts. No kg targets: work up by feel.',
  20: 'Test week: a single on bench and squat, a triple on the deadlift. Volume days are half the sets.',
  21: 'The 20-week block is over. Nothing new is scheduled.'
});
/** @param {{week:number}|null} info blockInfo for today */
export const phaseNote = info => (info && PHASE_NOTES[info.week]) || '';

/* Settings → Programme, first line (spec 3.2). */
/**
 * @param {{week:number, phaseName:string|null, deload:boolean, over:boolean}|null} info
 * @param {{start:string, weeks:number, deloadWeeks:number[]}} block
 * @param {{n:number, name:string, from:number, to:number}[]} phases
 * @param {(iso:string, n:number)=>string} addDays @param {(iso:string)=>string} niceDate
 */
export function blockSummary(info, block, phases, addDays, niceDate) {
  if (!info) return 'The winter block starts ' + niceDate(block.start) + '.';
  if (info.over) return 'The ' + block.weeks + '-week block is over.';
  const ph = phases.find(p => info.week >= p.from && info.week <= p.to);
  let s = 'Block week ' + info.week + ' of ' + block.weeks + (ph ? ' · ' + ph.name + ' (weeks ' + ph.from + '–' + ph.to + ')' : '');
  if (info.deload) return s + ' · deload week.';
  const next = block.deloadWeeks.find(w => w > info.week);
  return s + '.' + (next ? ' Next deload: week ' + next + ', from ' + niceDate(addDays(block.start, (next - 1) * 7)).slice(4) + '.' : '');
}

/* Dan's week rows (spec 4.2): the block days that aren't the Start button,
   in plan order, each with its pill. Never "missed". */
/** @param {{key:string, name:string, day:string, state:string}[]} plan @param {string|null} next */
export function weekRows(plan, next) {
  return plan.filter(p => p.key !== next).map(p => ({
    key: p.key, name: p.name,
    pill: p.state === 'done' ? { cls: 'ok', text: '✓ ' + p.day } : p.state === 'unverified' ? { cls: 'warn', text: p.day + ' · check' } : { cls: '', text: p.day }
  }));
}
/** @param {{state:string}[]} plan */
export const weekHeading = plan => 'This week · ' + plan.filter(p => p.state === 'done').length + ' of ' + plan.length + ' done';

/* The upload banner only after an upload has failed (or with no signal and
   something held). While it is just uploading the header pill says so. */
/** @param {{github:number, account:number, githubBad:boolean, accountBad:boolean, online:boolean}} a */
export const showQueueBanner = a => (a.github > 0 && a.githubBad) || (a.account > 0 && a.accountBad) || (!a.online && a.github + a.account > 0);
