// The app side of the coach chat: cloud.js's coach calls against a fake
// Supabase, and the pure rules in coach.js. No network. node --test "tracker/dev/*.test.mjs"
// Every fixture here is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCloud, forgetUser, PER_USER, SUPABASE_URL, SUPABASE_KEY, COACH_TIMEOUT } from '../cloud.js';
import * as C from '../coach.js';
import * as E from '../engine.js';

const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = sub => 'h.' + b64u({ sub, role: 'authenticated' }) + '.sig';
const USER = '00000000-0000-4000-8000-00000000000a';
const T0 = Date.UTC(2026, 9, 19, 8, 0, 0);
const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => { if (body === undefined) throw new Error('no body'); return body; } });
const signedIn = () => ({ access_token: jwt(USER), refresh_token: 'rt-1', expires_at: Math.floor(T0 / 1000) + 3600, user: { id: USER, email: 'tester@example.com' } });
const sess = (date, key, more = {}) => ({ schemaVersion: 5, date, key, name: key, exercises: [], decisions: [], savedAt: date + 'T18:00:00Z', ...more });
const ANSWER = { answer: '**Went up:** bench', id: 'a1', questionId: 'q1', created_at: '2026-10-19T08:00:01Z', kind: 'chat', week: null, safety: false, cut: false, refusal: false, weeks: 3, sessions: 7, remaining: 19, saved: true };

function fakeSupabase({ coach = () => res(200, ANSWER), rest = 201, profile = null, chat = [], first401 = 0, access = true } = {}) {
  const calls = [];
  let n401 = first401;
  const state = { profile, chat: [...chat], access };
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    const u = new URL(url), method = init.method || 'GET';
    if (u.pathname === '/auth/v1/token') return res(200, { access_token: jwt(USER) + 'x', refresh_token: 'rt-2', expires_in: 3600, user: { id: USER } });
    if (n401 > 0 && u.pathname.startsWith('/functions/')) { n401--; return res(401, { error: 'signed_out' }); }
    if (u.pathname === '/functions/v1/coach') return typeof coach === 'function' ? coach(JSON.parse(init.body), init) : coach;
    if (u.pathname === '/rest/v1/sessions') return res(rest, rest < 300 ? undefined : { message: 'fail' });
    if (u.pathname === '/rest/v1/rpc/settings_merge') {
      /* As the SQL: settings || patch, one statement, the row created if missing. */
      const patch = JSON.parse(init.body).patch;
      state.profile = { ...(state.profile || {}), settings: { ...((state.profile && state.profile.settings) || {}), ...patch } };
      return res(204);
    }
    if (u.pathname === '/rest/v1/coach_access') return res(200, state.access ? [{ user_id: USER }] : []);
    if (u.pathname === '/rest/v1/profiles') {
      if (method === 'GET') return res(200, state.profile ? [state.profile] : []);
      state.profile = { ...(state.profile || {}), ...JSON.parse(init.body)[0] };
      return res(201);
    }
    if (u.pathname === '/rest/v1/chat_messages') {
      if (method === 'DELETE') { state.chat = []; return res(204); }
      return res(200, state.chat, { 'content-range': '0-' + (state.chat.length - 1) + '/' + state.chat.length });
    }
    return res(404, {});
  };
  return { fetch, calls, state, coachCalls: () => calls.filter(c => c.url.includes('/functions/v1/coach')) };
}
function setup(sb, state = {}) {
  const S = { settings: {}, queue: [], bwQueue: [], history: [], bw: [], cloudQueue: [], cloud: signedIn(), ...state };
  const cloud = makeCloud({ fetch: sb.fetch, getState: () => S, save: () => {}, now: () => T0 });
  return { S, cloud };
}

/* ------------------------------------------------------------ cloud.js */
test('askCoach flushes the account queue first, then posts the question with the user’s token', async () => {
  const sb = fakeSupabase();
  const { S, cloud } = setup(sb);
  cloud.enqueue(sess('2026-10-18', 'g-full-a'));
  const r = await cloud.askCoach({ question: 'How was my week?', kind: 'week_review', week: '2026-10-12' });
  const iSess = sb.calls.findIndex(c => c.url.includes('/rest/v1/sessions')), iCoach = sb.calls.findIndex(c => c.url.includes('/functions/v1/coach'));
  assert.ok(iSess >= 0 && iSess < iCoach, 'the session went up before the question');
  const c = sb.calls[iCoach];
  assert.equal(c.url, SUPABASE_URL + '/functions/v1/coach');
  assert.equal(c.init.headers.Authorization, 'Bearer ' + jwt(USER));
  assert.equal(c.init.headers.apikey, SUPABASE_KEY);
  assert.deepEqual(JSON.parse(c.init.body), { question: 'How was my week?', kind: 'week_review', week: '2026-10-12' });
  assert.equal(r.answer, '**Went up:** bench');
  assert.equal(r.unsynced, 0);
  assert.equal(S.cloudQueue.length, 0);
});

test('askCoach: a flush that fails still sends, and says how many sessions the coach could not see', async () => {
  const sb = fakeSupabase({ rest: 500 });
  const { cloud } = setup(sb);
  cloud.enqueue(sess('2026-10-18', 'g-full-a'));
  const r = await cloud.askCoach({ question: 'q' });
  assert.equal(r.unsynced, 1);
  assert.equal(sb.coachCalls().length, 1);
});

test('askCoach waits 60 s, not the 20 s of other calls; our own timeout reads as "took too long", not offline', async () => {
  const seen = [];
  const orig = AbortSignal.timeout;
  AbortSignal.timeout = ms => { seen.push(ms); return orig.call(AbortSignal, ms); };
  try {
    const sb = fakeSupabase();
    await setup(sb).cloud.askCoach({ question: 'q' });
    assert.deepEqual(seen, [COACH_TIMEOUT]);
    assert.equal(COACH_TIMEOUT, 60000);
  } finally { AbortSignal.timeout = orig; }
  const slow = fakeSupabase({ coach: () => { throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' }); } });
  const e = await setup(slow).cloud.askCoach({ question: 'q' }).catch(x => x);
  assert.equal(e.timeout, true);
  assert.notEqual(e.offline, true);
  assert.equal(C.errorKind(e), 'timeout');
});

test('askCoach errors carry the function’s code: limit, off, too long, busy; no signal is offline', async () => {
  const cases = [[res(429, { error: 'limit', limit: 20, remaining: 0 }), 'limit'], [res(503, { error: 'off' }), 'off'], [res(413, { error: 'too_long' }), 'too_long'],
    [res(502, { error: 'busy' }), 'busy'], [res(504, { error: 'timeout' }), 'timeout'], [res(500, { error: 'server' }), 'busy'],
    [res(403, { error: 'no_access' }), 'no_access'], [res(409, { error: 'week_not_done', done: 1, target: 3 }), 'week_not_done'],
    /* a gateway error without our JSON code is "busy": never "off" (it would hide the composer) or "limit" */
    [res(503, undefined), 'busy'], [res(503, { message: 'Service Unavailable' }), 'busy'], [res(429, { message: 'Too many requests' }), 'busy'], [res(413, undefined), 'busy']];
  for (const [r, kind] of cases) {
    const e = await setup(fakeSupabase({ coach: r })).cloud.askCoach({ question: 'q' }).catch(x => x);
    assert.equal(C.errorKind(e), kind, kind);
  }
  const lim = await setup(fakeSupabase({ coach: res(429, { error: 'limit', remaining: 0 }) })).cloud.askCoach({ question: 'q' }).catch(x => x);
  assert.equal(lim.remaining, 0);
  const off = await setup({ fetch: async () => { throw new TypeError('Failed to fetch'); } }).cloud.askCoach({ question: 'q' }).catch(x => x);
  assert.equal(C.errorKind(off), 'offline');
});

test('askCoach: an expired token is refreshed once and the question retried; signed out never calls', async () => {
  const sb = fakeSupabase({ first401: 1 });
  const r = await setup(sb).cloud.askCoach({ question: 'q' });
  assert.equal(r.id, 'a1');
  assert.equal(sb.coachCalls().length, 2);
  const out = fakeSupabase();
  const e = await setup(out, { cloud: { signedOut: true } }).cloud.askCoach({ question: 'q' }).catch(x => x);
  assert.equal(C.errorKind(e), 'signed_out');
  assert.equal(out.calls.length, 0);
});

test('chatHistory reads the user’s rows newest first, with the total; "earlier" pages by date', async () => {
  const rows = [{ id: 'b', role: 'assistant', content: 'x', created_at: '2026-10-18T10:00:01Z' }, { id: 'a', role: 'user', content: 'q', created_at: '2026-10-18T10:00:00Z' }];
  const sb = fakeSupabase({ chat: rows });
  const { cloud } = setup(sb);
  const r = await cloud.chatHistory();
  assert.deepEqual(r, { rows, total: 2 });
  assert.match(sb.calls[0].url, /chat_messages\?select=id,role,kind,week,content,safety,meta,created_at&order=created_at\.desc&limit=30$/);
  assert.equal(sb.calls[0].init.headers.Prefer, 'count=exact');
  await cloud.chatHistory({ before: '2026-10-18T10:00:00Z' });
  assert.match(sb.calls[1].url, /&created_at=lt\.2026-10-18T10%3A00%3A00Z$/);
});

test('C6: deleteChat removes every row of the user’s chat at once; a failure throws, nothing assumed', async () => {
  const sb = fakeSupabase({ chat: [{ id: 'a' }] });
  await setup(sb).cloud.deleteChat();
  assert.equal(sb.calls[0].init.method, 'DELETE');
  assert.match(sb.calls[0].url, new RegExp('/rest/v1/chat_messages\\?user_id=eq\\.' + USER + '$'));
  assert.deepEqual(sb.state.chat, []);
  assert.ok(!sb.calls.some(c => /chat_usage|chat_take/.test(c.url)), 'the usage counter is not touched');
  const bad = { fetch: async () => res(500, { message: 'x' }) };
  assert.equal((await setup(bad).cloud.deleteChat().catch(x => x)).status, 500);
});

test('first run: accepting is kept in the account next to the programme, which stays', async () => {
  const sb = fakeSupabase({ profile: { programme_key: 'gen-1', settings: { programme: { id: 'gen-1' }, other: 1 } } });
  const { cloud } = setup(sb);
  assert.equal(await cloud.coachAccepted(), 0);
  await cloud.acceptCoach(C.COPY_V);
  assert.deepEqual(sb.state.profile.settings.programme, { id: 'gen-1' });
  assert.equal(sb.state.profile.settings.other, 1);
  assert.equal(sb.state.profile.settings.coachChat.ok, C.COPY_V);
  assert.equal(sb.state.profile.programme_key, 'gen-1', 'programme_key is not sent, so not changed');
  assert.equal(await cloud.coachAccepted(), C.COPY_V);
  const w = sb.calls.find(c => (c.init.method || 'GET') === 'POST');
  assert.equal(w.url, SUPABASE_URL + '/rest/v1/rpc/settings_merge', 'one merge on the server, not a read-modify-write');
  assert.deepEqual(Object.keys(JSON.parse(w.init.body).patch), ['coachChat'], 'only its own key is sent');
});

test('invite-only: coachAccess reads the user’s own allow-list row', async () => {
  assert.equal(await setup(fakeSupabase({ access: true })).cloud.coachAccess(), true);
  const sb = fakeSupabase({ access: false });
  assert.equal(await setup(sb).cloud.coachAccess(), false);
  assert.equal(sb.calls[0].url, SUPABASE_URL + '/rest/v1/coach_access?select=user_id&limit=1');
  assert.equal(C.NO_ACCESS, 'The coach is invite-only for now. Ask Dan to switch it on for you.');
});

test('"off" clears: it holds for a minute, then the coach is tried again', () => {
  assert.equal(C.offNow(false, T0), false);
  assert.equal(C.offNow(T0, T0 + 59000), true);
  assert.equal(C.offNow(T0, T0 + 60000), false);
});

test('signing out (or another account taking the phone) forgets the phone’s copy of the chat', () => {
  for (const k of ['chat', 'chatTotal', 'coachOk', 'coachDismiss', 'coachLimitDay']) assert.ok(PER_USER.includes(k), k);
  const S = { chat: [{ id: 'a' }], chatTotal: 4, coachOk: 1, history: [1] };
  forgetUser(S);
  assert.deepEqual(S, { history: [1] });
});

/* ------------------------------------------------------------ coach.js */
const W = (kg, reps, rir) => ({ kg, reps, rir, state: 'done', warmup: false });
const lift = (date, n = 'Goblet squat') => sess(date, 'g-full-a', { exercises: [{ n, kind: 'weight', sets: [W(20, 10, 2)] }] });
const sugg = (list, more = {}) => C.suggestions({ list, today: '2026-10-19', weekOf: E.weekOf, addDays: E.addDays, mainLifts: ['Goblet squat', 'Bench press (heavy)'], isLift: s => E.isLiftKey(s.key), ...more });

test('suggested questions: a new person gets first-steps questions, never one about a lift they don’t do', () => {
  assert.deepEqual(sugg([]).map(s => s.q), ['How do I choose my first weights?', 'What does RIR mean?', 'What is in my programme?']);
  assert.deepEqual(sugg([sess('2026-10-19', 'skill')]).map(s => s.q)[0], 'How do I choose my first weights?', 'a skill day is not a lift');
});

test('suggested questions from the log: this week or last, the most-done main lift (3+), next session, deload after 3 weeks', () => {
  const list = [lift('2026-10-19'), lift('2026-10-15'), lift('2026-10-08'), lift('2026-10-01', 'Bench press (heavy)')];
  assert.deepEqual(sugg(list, { week: { done: 3, target: 3 } }), [
    { q: 'How was my week?', kind: 'week_review', week: '2026-10-19' },
    { q: 'Is my goblet squat progressing?', kind: 'chat' },
    { q: 'What should I focus on next session?', kind: 'chat' },
    { q: 'Should I deload?', kind: 'chat' }]);
  /* Mid-week the chip is a plain question: a tap must not use up the week's one review. */
  assert.deepEqual(sugg(list, { week: { done: 1, target: 3 } })[0], { q: 'How is my week going so far?', kind: 'chat' });
  assert.deepEqual(sugg(list)[0], { q: 'How is my week going so far?', kind: 'chat' }, 'target unknown: never the review');
  const lastWeekOnly = [lift('2026-10-15'), lift('2026-10-13')];
  assert.deepEqual(sugg(lastWeekOnly, { lowerToday: true }).map(s => s.q), ['How was last week?', 'Why is today’s weight lower?', 'What does RIR mean?']);
  assert.equal(sugg(lastWeekOnly)[0].week, '2026-10-12');
  assert.equal(C.liftWord('High-bar back squat (volume)'), 'high-bar back squat');
});

test('follow-ups: safety → only "Explain it more simply"; cut short → "Tell me the rest" first; never a repeat of today', () => {
  const s = sugg([lift('2026-10-19'), lift('2026-10-15'), lift('2026-10-08'), lift('2026-10-01')]);
  assert.deepEqual(C.followUps({ safety: true }, s, []), ['Explain it more simply']);
  assert.deepEqual(C.followUps({ meta: { cut: true } }, s, []), ['Tell me the rest', 'Explain it more simply', 'What should I do next session?']);
  assert.deepEqual(C.followUps({ meta: {} }, s, ['Is my goblet squat progressing?']), ['Explain it more simply', 'What should I do next session?', 'Should I deload?']);
  assert.deepEqual(C.followUps({ meta: {} }, s, []), ['Explain it more simply', 'What should I do next session?', 'Is my goblet squat progressing?']);
  assert.deepEqual(C.followUps(null, s, []), []);
});

test('week review card: only when the planned sessions are all saved; Not now hides it; once asked it reads "Read your week review"', () => {
  assert.equal(C.weekCard({ done: 2, target: 3, reviewed: false, dismissed: false }), null);
  assert.equal(C.weekCard({ done: 3, target: 3, reviewed: false, dismissed: false }), 'ask');
  assert.equal(C.weekCard({ done: 4, target: 3, reviewed: false, dismissed: true }), null);
  assert.equal(C.weekCard({ done: 3, target: 3, reviewed: true, dismissed: true }), 'read');
  assert.equal(C.weekCard({ done: 0, target: 0, reviewed: false, dismissed: false }), null);
  assert.equal(C.weekDoneToast(2, 3, 3), 'Saved. Week done: 3 of 3.');
  assert.equal(C.weekDoneToast(3, 4, 3), null, 'only the save that completes the week');
  assert.equal(C.weekDoneToast(1, 2, 3), null);
});

test('answers render as escaped text with bold, line breaks and bullets only; "In Ledger:" gets its own block', () => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f = C.formatAnswer('**Went up:** bench <script>x</script>\n- row 50 kg\n- squat\n\nIn Ledger: start the session, then ⋯ → Deload session\n\n(cut short)', esc);
  assert.equal(f.html, '<div><b>Went up:</b> bench &lt;script&gt;x&lt;/script&gt;</div><ul class="cl"><li>row 50 kg</li><li>squat</li></ul>', 'trailing blank lines dropped');
  assert.equal(f.inLedger, '<b>In Liftless:</b> start the session, then ⋯ → Deload session');
  assert.equal(C.formatAnswer('[link](javascript:x) **a** <img src=x onerror=1>', esc).html, '<div>[link](javascript:x) <b>a</b> &lt;img src=x onerror=1&gt;</div>');
});

test('the thread: oldest first, a date divider when the day changes, never a message twice', () => {
  const rows = [
    { id: 'a2', role: 'assistant', content: 'A2', created_at: '2026-10-19T08:00:01Z' }, { id: 'q2', role: 'user', content: 'Q2', created_at: '2026-10-19T08:00:00Z' },
    { id: 'a1', role: 'assistant', content: 'A1', created_at: '2026-10-17T08:00:01Z' }, { id: 'q1', role: 'user', content: 'Q1', created_at: '2026-10-17T08:00:00Z' },
    { id: 'q1', role: 'user', content: 'Q1', created_at: '2026-10-17T08:00:00Z' }];
  const t = C.thread(rows, iso => iso.slice(0, 10));
  assert.deepEqual(t.map(x => x.divider || x.content), ['2026-10-17', 'Q1', 'A1', '2026-10-19', 'Q2', 'A2']);
});

test('an answer adds the question and the answer to the phone’s copy; a stored review adds only itself', () => {
  const add = C.rowsFromAnswer('How was my week?', { ...ANSWER, unsynced: 1 }, '2026-10-19T08:00:05Z');
  assert.deepEqual(add.map(r => [r.id, r.role, r.content]), [['q1', 'user', 'How was my week?'], ['a1', 'assistant', '**Went up:** bench']]);
  assert.equal(add[1].unsynced, 1);
  assert.deepEqual(add[1].meta, { weeks: 3, sessions: 7 });
  const stored = C.rowsFromAnswer('How was my week?', { ...ANSWER, stored: true, kind: 'week_review', week: '2026-10-12' }, 'x');
  assert.equal(stored.length, 1);
  assert.equal(C.reviewFor(C.mergeRows([], stored), '2026-10-12').id, 'a1');
  assert.equal(C.mergeRows(add, add).length, 2, 'merged by id');
});

test('copy: waiting by time, messages left, the limit, "From N weeks, M sessions."', () => {
  assert.equal(C.waitText(1000), 'Reading your log…');
  assert.equal(C.waitText(5000), 'Coach is thinking…');
  assert.equal(C.waitText(20000), 'Still working. This can take up to a minute.');
  assert.equal(C.leftText(19), '');
  assert.equal(C.leftText(3), '3 messages left today.');
  assert.equal(C.leftText(1), '1 message left today.');
  assert.equal(C.limitText(20), 'That’s today’s 20 messages. Ask again tomorrow. Your log works as usual.');
  assert.equal(C.fromLine(8, 27), 'From 8 weeks, 27 sessions.');
  assert.equal(C.fromLine(1, 2), 'From 1 week, 2 sessions.');
  assert.equal(C.fromLine(null, null), '');
});

/* The page is one inline module (no DOM in node), so this checks the wiring
   statically; the browser check covers the rendering. */
test('signed out on a GitHub phone: the Coach tab starts hidden and only an account sign-in shows it; no call when signed out', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<button data-act="tab" data-tab="coach" hidden>Coach<\/button>/);
  assert.match(html, /const coachLive = \(\) => cloud\.signedIn\(\) && !cloud\.foreign\(\);/);
  assert.match(html, /const coachTab = \(\) => coachLive\(\) \|\| \(mode\(\) === 'account' && cloud\.inUse\(\) && !cloud\.signedIn\(\)\);/);
  assert.match(html, /\$\('#tabs \[data-tab="coach"\]'\)\.hidden = !coachTab\(\);/);
  assert.match(html, /if\(coachLive\(\) && online\(\)\) coachLoad\(\);/, 'the boot load is gated on a sign-in');
  for (const f of ['weekCardHTML', 'askWeekLink', 'askSessionButton', 'coachCard'])
    assert.match(html, new RegExp('function ' + f + '\\([^)]*\\)\\{\\n\\s+if\\(!(coachLive|coachTab)\\(\\)'), f + ' renders nothing unless signed in');
});
