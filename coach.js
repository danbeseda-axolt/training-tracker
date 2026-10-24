// @ts-check
/* Ledger coach chat (release 2): the pure parts of the Coach tab. No DOM, no
   network, no clock; imports nothing (the engine's helpers it needs are passed
   in), so node tests cover every rule. The network calls are in cloud.js
   (askCoach, chatHistory, deleteChat, acceptCoach); the screen is index.html.
   Screens and copy: projects/ledger-ux-chat.md. */

/** @typedef {Record<string, any>} Obj */

/* First-run copy version: bump when the disclosure changes materially, and
   everyone sees it again. Stored in profiles.settings.coachChat.ok. */
export const COPY_V = 1;
export const MAX_CHARS = 1000;
export const DAILY = 20;

/* Fixed copy, never written by the AI. The function has the same strings
   (dev/coach-app.test.mjs checks they match). */
export const SAFETY = {
  banner: 'Stop the exercise that hurts and see a physiotherapist.',
  footer: 'Chest pain, dizziness or numbness: see a doctor now. In an emergency, call 155.'
};
export const CUT_MARK = '(cut short)';

/* What each failure says, in the coach's card (UX 4.9 / 4.10). */
/** @param {any} e */
/* By the function's own error code. A status without our JSON code (a
   gateway 503 or 429, say) is "busy", never "off" or "limit". */
export function errorKind(e) {
  const code = String(e && e.code || '');
  if (e && e.offline) return 'offline';
  if (e && e.timeout) return 'timeout';
  if (code === 'limit') return 'limit';
  if (code === 'off') return 'off';
  if (code === 'no_access') return 'no_access';
  if (code === 'week_not_done') return 'week_not_done';
  if (code === 'signed_out' || code === 'no_user' || (e && e.status === 401)) return 'signed_out';
  if (code === 'too_long') return 'too_long';
  if (code === 'timeout' || (e && e.status === 504)) return 'timeout';
  return 'busy';
}
/* "Off" (Dan's kill switch, no key) is checked again after a minute. */
export const OFF_RETRY_MS = 60000;
/** @param {number|false|null|undefined} offAt @param {number} nowMs */
export const offNow = (offAt, nowMs) => !!offAt && nowMs - offAt < OFF_RETRY_MS;
export const ERROR_COPY = {
  offline: { cls: 'bad', text: 'Not sent. Check your connection and try again.', retry: true },
  timeout: { cls: 'bad', text: 'The coach took too long to answer. Try again in a minute.', retry: true },
  busy: { cls: 'bad', text: 'The coach is busy. Try again in a minute.', retry: true },
  signed_out: { cls: 'warn', text: "You're signed out. Sign in again to use the coach.", retry: false },
  too_long: { cls: 'bad', text: 'That message is too long. Keep it under 1,000 characters.', retry: false },
  off: { cls: 'info', text: 'The coach is off for now. Your training log works as usual.', retry: false },
  limit: { cls: 'info', text: 'That’s today’s limit. Back tomorrow.', retry: false },
  no_access: { cls: 'info', text: 'The coach is invite-only for now. Ask Dan to switch it on for you.', retry: false },
  week_not_done: { cls: 'info', text: 'Your week isn’t finished yet, so there is no review for it. Ask how it’s going instead.', retry: false }
};
export const NO_ACCESS = ERROR_COPY.no_access.text;
/** @param {number|null|undefined} n */
export const limitText = n => n ? 'That’s today’s ' + n + ' messages. Ask again tomorrow. Your log works as usual.' : ERROR_COPY.limit.text;
/** @param {number|null|undefined} n */
export const leftText = n => n != null && n > 0 && n <= 3 ? n + (n === 1 ? ' message' : ' messages') + ' left today.' : '';

/* The loading line, by time waited (UX 4.5). */
/** @param {number} ms */
export const waitText = ms => ms < 3000 ? 'Reading your log…' : ms < 15000 ? 'Coach is thinking…' : 'Still working. This can take up to a minute.';

/* ------------------------------------------------------------ answers */
/* The answer as safe HTML: **bold**, line breaks and "- " bullets only; the
   "In Ledger:" line is pulled out into its own block (UX 4.7). The cut-short
   marker is dropped (the card says it in a hint instead). */
/** @param {string} text @param {(s:any)=>string} esc */
export function formatAnswer(text, esc) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let inLedger = '';
  const body = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (l === CUT_MARK) continue;
    const m = /^(\*\*)?In (?:Liftless|Ledger):(\*\*)?\s*(.*)$/i.exec(l);
    if (m) { inLedger = m[3]; continue; }
    body.push(l);
  }
  while (body.length && !body[body.length - 1]) body.pop();
  const inline = (/** @type {string} */ s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  let html = '', list = false;
  for (const l of body) {
    const b = /^[-•*]\s+(.*)$/.exec(l);
    if (b) { if (!list) { html += '<ul class="cl">'; list = true; } html += '<li>' + inline(b[1]) + '</li>'; continue; }
    if (list) { html += '</ul>'; list = false; }
    html += l ? '<div>' + inline(l) + '</div>' : '<div class="gap"></div>';
  }
  if (list) html += '</ul>';
  return { html, inLedger: inLedger ? '<b>In Liftless:</b> ' + inline(inLedger) : '' };
}
/** "From 8 weeks, 27 sessions." @param {number|null|undefined} weeks @param {number|null|undefined} sessions */
export function fromLine(weeks, sessions) {
  if (weeks == null || sessions == null) return '';
  if (!sessions) return 'From your log: no sessions in the last 8 weeks.';
  return 'From ' + weeks + (weeks === 1 ? ' week, ' : ' weeks, ') + sessions + (sessions === 1 ? ' session.' : ' sessions.');
}

/* ------------------------------------------------------------ the thread */
/* Stored rows (newest first, from the server or the phone's copy) as the
   thread: oldest first, one entry per message, with a date divider when the
   day changes. A row is never shown twice (by id). */
/** @param {Obj[]} rows @param {(iso:string)=>string} dayLabel */
export function thread(rows, dayLabel) {
  const seen = new Set(), out = [];
  const asc = [...(rows || [])].filter(r => r && r.content != null).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || (a.role === 'user' ? -1 : 1));
  let day = '';
  for (const r of asc) {
    if (r.id && seen.has(r.id)) continue;
    if (r.id) seen.add(r.id);
    const d = dayLabel(String(r.created_at));
    if (d !== day) { out.push({ divider: d }); day = d; }
    out.push(r);
  }
  return out;
}
/* Merge new rows into the phone's copy (newest first, last `keep` kept). */
/** @param {Obj[]} cache @param {Obj[]} rows @param {number} [keep] */
export function mergeRows(cache, rows, keep = 60) {
  const m = new Map();
  for (const r of [...(cache || []), ...(rows || [])]) if (r && r.id) m.set(r.id, r);
  const noId = [...(cache || []), ...(rows || [])].filter(r => r && !r.id);
  return [...m.values(), ...noId].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || (a.role === 'assistant' ? -1 : 1)).slice(0, keep);
}
/* The rows an answer from the function adds to the thread. */
/** @param {string} question @param {Obj} r the function's answer @param {string} nowIso */
export function rowsFromAnswer(question, r, nowIso) {
  const at = String(r.created_at || nowIso);
  const meta = { weeks: r.weeks, sessions: r.sessions, ...(r.cut ? { cut: true } : {}), ...(r.refusal ? { refusal: true } : {}) };
  const a = { id: r.id || 'local-a-' + at, role: 'assistant', kind: r.kind || 'chat', week: r.week || null, content: r.answer, safety: !!r.safety, meta, created_at: at, unsynced: r.unsynced || 0 };
  if (r.stored) return [a];
  /* The question sorts just before its answer. */
  const q = { id: r.questionId || 'local-q-' + at, role: 'user', kind: r.kind || 'chat', week: r.week || null, content: question, created_at: at };
  return [q, a];
}
/** The stored review for a week, if the phone has it. @param {Obj[]} rows @param {string} week */
export const reviewFor = (rows, week) => (rows || []).find(r => r && r.role === 'assistant' && r.kind === 'week_review' && r.week === week) || null;

/* ------------------------------------------------------------ suggestions */
/**
 * The suggested questions (UX 4.3), max 4, chosen from the person's own log.
 * Never a question about something they don't do.
 * @param {{list: Obj[], today: string, weekOf: (iso:string)=>string, addDays: (iso:string, n:number)=>string,
 *          mainLifts: string[], lowerToday?: boolean, isLift: (s:Obj)=>boolean, week?: {done:number, target:number}}} a
 * week: this week's done against target. Its review is offered only when the
 * week is done (the server refuses it before); mid-week the chip is a plain
 * question, so a tap can't use up the one review.
 * @returns {{q:string, kind:string, week?:string}[]}
 */
export function suggestions({ list, today, weekOf, addDays, mainLifts, lowerToday = false, isLift, week = { done: 0, target: 0 } }) {
  const lifts = (list || []).filter(s => s && s.date && !s.deleted && isLift(s));
  if (!lifts.length) return [
    { q: 'How do I choose my first weights?', kind: 'chat' },
    { q: 'What does RIR mean?', kind: 'chat' },
    { q: 'What is in my programme?', kind: 'chat' }
  ];
  const wk = weekOf(today), last = addDays(wk, -7), since = addDays(wk, -49);
  const out = [];
  if (week.target > 0 && week.done >= week.target) out.push({ q: 'How was my week?', kind: 'week_review', week: wk });
  else if (lifts.some(s => weekOf(s.date) === wk)) out.push({ q: WEEK_SO_FAR, kind: 'chat' });
  else if (lifts.some(s => weekOf(s.date) === last)) out.push({ q: 'How was last week?', kind: 'week_review', week: last });
  /* The main lift done most often in 8 weeks, at least 3 times. */
  let best = null, bestN = 0;
  for (const n of mainLifts) {
    const c = lifts.filter(s => s.date >= since && (s.exercises || []).some((/** @type {Obj} */ e) => e.n === n && (e.sets || []).some((/** @type {Obj} */ st) => !st.warmup && (st.state === 'done' || st.state === 'legacy' || st.state == null) && (st.kg != null || st.reps != null)))).length;
    if (c > bestN) { best = n; bestN = c; }
  }
  if (best && bestN >= 3) out.push({ q: 'Is my ' + liftWord(best) + ' progressing?', kind: 'chat' });
  out.push({ q: lowerToday ? 'Why is today’s weight lower?' : 'What should I focus on next session?', kind: 'chat' });
  const weeks = new Set(lifts.map(s => weekOf(s.date))).size;
  out.push(weeks >= 3 ? { q: 'Should I deload?', kind: 'chat' } : { q: 'What does RIR mean?', kind: 'chat' });
  return out.slice(0, 4);
}
export const WEEK_SO_FAR = 'How is my week going so far?';
/** "High-bar back squat (volume)" → "high-bar back squat". @param {string} n */
export const liftWord = n => String(n).replace(/\s*\(.*?\)\s*/g, ' ').trim().replace(/^./, c => c.toLowerCase());

/* Under the latest answer only, max 3 (UX 4.3): after a safety answer only
   "Explain it more simply"; after a cut answer "Tell me the rest" first. */
/** @param {Obj|null} last the latest answer row @param {{q:string}[]} sugg @param {string[]} askedToday */
export function followUps(last, sugg, askedToday) {
  if (!last) return [];
  if (last.safety) return ['Explain it more simply'];
  const out = [];
  if (last.meta && last.meta.cut) out.push('Tell me the rest');
  out.push('Explain it more simply', 'What should I do next session?');
  const asked = new Set((askedToday || []).map(s => s.toLowerCase()));
  /* Not a second "next session" question, and not the week review (one tap on Log does that). */
  const extra = (sugg || []).find(s => !asked.has(s.q.toLowerCase()) && !out.includes(s.q) && !/^How (was|is) (my|last) week|next session/.test(s.q));
  if (extra) out.push(extra.q);
  return out.slice(0, 3);
}

/* ------------------------------------------------------------ the Log card */
/* Week review card on Log (UX 2): only once the week's planned sessions are
   all saved (Builder: no Monday card for last week). 'ask' = the review
   button, 'read' = Read your week review, null = nothing. */
/** @param {{done:number, target:number, reviewed:boolean, dismissed:boolean}} a */
export function weekCard({ done, target, reviewed, dismissed }) {
  if (!(target > 0) || done < target) return null;
  if (reviewed) return 'read';
  return dismissed ? null : 'ask';
}
/* The toast after the save that completes the week. */
/** @param {number} before @param {number} after @param {number} target */
export const weekDoneToast = (before, after, target) => target > 0 && before < target && after >= target ? 'Saved. Week done: ' + after + ' of ' + target + '.' : null;
