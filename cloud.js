// @ts-check
/* Ledger account mode (beta): email-code sign-in and session storage in
   Supabase, by plain fetch against GoTrue (/auth/v1) and PostgREST (/rest/v1).
   Opt-in. The GitHub sync in sync.js stays the default and is not touched.
   Built by a factory so the tests can hand it a fake fetch and no network.

   The rules that keep a session from being lost (the same as sync.js):
   - a write counts only on 200, 201 or 204; anything else keeps it queued
   - one flush at a time; a second call joins it and runs once more after
   - each queue item has its own qid and is removed only after its own write
   - signing out, or a refresh the server refuses, clears the tokens only:
     history and the queue stay on the phone and go up after the next sign-in
   - no network is not a sign-out: the tokens are kept for when signal returns

   Only the project URL and the publishable key are here. Both are public by
   design; the database's row-level security is what keeps rows private. */

/** @typedef {Record<string, any>} Obj */

export const SUPABASE_URL = 'https://widuygqbkpyerqhgbvos.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Oy4Gzdmq89sQ0S3TX3H_Vg_76rZqYms';
/** The coach call's own timeout (spec: 60 s; every other call aborts at 20 s). */
export const COACH_TIMEOUT = 60000;

/** The row key for a session: its file base name, as sync.js names it. @param {Obj} s */
export const clientId = s => String(s.file || (s.date + '-' + s.key + '.json')).split('/').pop();

/* Where this phone keeps its log: an explicit, sticky mode, never inferred
   from whether a token happens to be there right now (clearing an expired
   token before pasting a new one must not move Dan's sessions anywhere).
   - 'github': GitHub settings have been valid on this phone at least once, or
     the state already holds GitHub data. Never flips back by itself.
   - 'account': someone signed in on a phone where GitHub was never set up.
   - null: neither yet (a fresh phone).
   State saved before the mode existed is decided once, preferring 'github'
   whenever there is any sign of it. Mutates S.storage; returns the mode. */
/** @param {Obj} S @param {boolean} githubOk */
export function resolveStorage(S, githubOk) {
  if (S.storage !== 'github' && S.storage !== 'account' && S.storage !== null) {
    const ghData = [S.queue, S.history, S.bwQueue, S.bw].some(a => Array.isArray(a) && a.length);
    S.storage = githubOk || ghData ? 'github' : S.cloud ? 'account' : null;
  }
  if (S.storage === null && githubOk) S.storage = 'github';
  return S.storage;
}
/* The mode moves one way only: account → github, never back. When GitHub
   settings become valid on an 'account' phone, everything the account holds
   for its owner (history rows, overlaid by the owner's queued changes) is set
   aside in S.adoptPending, to be offered to GitHub once a pull shows what
   GitHub already has (adoptAfterPull). Rows deleted by a queued change leave
   history now, so they cannot reappear. The account stays a copy.
   Returns true when it promoted. */
/** @param {Obj} S @param {string|null} me the account owner on this phone @param {number} nowMs */
export function promoteToGithub(S, me, nowMs) {
  if (S.storage !== 'account') return false;
  const ownerOf = (/** @type {Obj} */ q) => q._owner || (S.cloudOwner && S.cloudOwner.id) || null;
  /** @type {Map<string, Obj>} */
  const m = new Map();
  for (const h of S.history || []) if (h && h.date && !h.deleted) m.set(clientId(h), h);
  for (const q of S.cloudQueue || []) {
    if (!q || !q.date || ownerOf(q) !== me) continue;
    const { qid, _owner, ...b } = q;
    m.set(clientId(q), b);                           // a queued change overlays its row
  }
  const gone = new Set([...m.entries()].filter(([, v]) => v.deleted).map(([k]) => k));
  S.history = (S.history || []).filter((/** @type {Obj} */ h) => !gone.has(clientId(h)));
  const prev = S.adoptPending && Array.isArray(S.adoptPending.items) ? S.adoptPending.items : [];
  S.adoptPending = { since: nowMs, items: [...prev, ...m.values()] };
  S.storage = 'github';
  return true;
}
/* After a successful GitHub pull: which set-aside sessions GitHub needs. A
   session goes to the GitHub queue when GitHub has no copy or an older one;
   a deletion only when GitHub has the file. Nothing is offered when a newer
   copy is already queued for GitHub. If the pull found no log folder at all,
   GitHub has nothing and every session is offered. Clears S.adoptPending. */
/** @param {Obj} S @param {boolean} pulled */
export function adoptAfterPull(S, pulled) {
  const p = S.adoptPending;
  if (!p || !pulled) return [];
  const at = (/** @type {Obj} */ x) => String(x && x.savedAt || '');
  const known = (S.historyFetched || 0) >= p.since;     // the pull replaced history with GitHub's
  /** @type {Map<string, Obj>} */
  const gh = new Map(), queued = new Map();
  if (known) for (const h of S.history || []) if (h) gh.set(clientId(h), h);
  for (const q of S.queue || []) if (q && q.date) queued.set(clientId(q), q);
  /** @type {Map<string, Obj>} */
  const out = new Map();
  for (const it of p.items || []) {
    const k = clientId(it), g = gh.get(k), q = queued.get(k);
    if (q && at(q) >= at(it)) continue;
    if (it.deleted) { if (g) out.set(k, it); else out.delete(k); continue; }
    if (!g || at(g) < at(it)) out.set(k, it);
  }
  delete S.adoptPending;
  return [...out.values()];
}

/* Called on a successful sign-in: a phone that has never had GitHub becomes
   an account phone. A GitHub phone stays one. */
/** @param {Obj} S @param {boolean} githubOk */
export function claimStorage(S, githubOk) {
  if (resolveStorage(S, githubOk) === null) S.storage = 'account';
  return S.storage;
}

/* What is pending, for the views. In 'github' mode the account queue is only
   a copy: it never feeds the views, so a held copy can never bring back a
   deleted session or hide a newer edit. In 'account' mode its queue overlays
   history like any queue, the last queued copy winning. */
/** @param {Obj[]} history @param {Obj[]} queue @param {Obj[]} cloudQueue @param {boolean} accountOwns */
export function pendingView(history, queue, cloudQueue, accountOwns) {
  if (!accountOwns || !cloudQueue || !cloudQueue.length) return queue || [];
  return [...(queue || []), ...cloudQueue.filter(c => c && c.date).map(({ _owner, ...c }) => c)];
}

/* Where a save, edit, verify or delete is queued. 'account' mode: the account
   only. Otherwise GitHub exactly as before (a blank token just holds the
   queue), plus the account as a copy once it has been used on this phone
   (held while signed out, so a later change replaces the held copy). */
/** @param {string|null} mode @param {boolean} accountInUse */
export const routeSave = (mode, accountInUse) => mode === 'account'
  ? { github: false, account: true }
  : { github: true, account: !!accountInUse };

/* Export must never carry a credential, even inside a raw copy of corrupt
   state: token fields are blanked and token-shaped strings are replaced. */
/** @param {string} raw */
export function redactSecrets(raw) {
  return String(raw)
    /* Up to the closing quote, or to the end of a truncated copy. */
    .replace(/("(?:token|access_token|refresh_token|provider_token|provider_refresh_token)"\s*:\s*)"(?:[^"\\]|\\.)*(?:"|\\?$)/g, '$1"[removed]"')
    .replace(/github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]{20,}/g, '[removed]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[removed]');
}

/* Everything on the phone that belongs to the person signed in, not to the
   phone: their programme (and whether it is held / whose it is), the coach
   flag, half-answered questions, a code waiting to be typed. Cleared on an
   explicit sign-out and whenever a different account takes the phone over. */
export const PER_USER = ['programme', 'programmeDirty', 'programmeOwner', 'coach', 'onboard', 'signin',
  /* the coach chat (release 2): the phone's copy of the thread, first-run OK, Log card state */
  'chat', 'chatTotal', 'coachOk', 'coachDismiss', 'coachLimitDay',
  /* health from the phone (5-22): personal, so it leaves with the person */
  'health'];
/** @param {Obj} S */
export function forgetUser(S) { for (const k of PER_USER) delete S[k]; return S; }
/** Whose the cached programme is (pre-5-12 caches: the phone's owner). @param {Obj} S */
export const progOwner = S => S.programmeOwner || (S.cloudOwner && S.cloudOwner.id) || null;
/** @param {Obj} S */
const clearProgramme = S => { delete S.programme; delete S.programmeDirty; delete S.programmeOwner; };
/** a was saved later than b (both programmes; no stamp = oldest). @param {Obj} a @param {Obj} b */
export const newer = (a, b) => !!(a && a.updatedAt) && (!(b && b.updatedAt) || String(a.updatedAt) > String(b.updatedAt));

/* Plain words for what went wrong, with what to do next. */
/** @param {any} e */
export function explain(e) {
  const st = e && e.status, code = String(e && e.code || ''), msg = String(e && e.message || e || '');
  if (e && e.offline) return 'No connection. Your sessions are kept on this phone; try again when you have signal.';
  if (st === 429 || /rate_limit/.test(code)) return 'Too many requests. Wait a few minutes, then try again. Emails are limited to a few an hour.';
  if (code === 'otp_expired' || (st === 403 && /expired|invalid/i.test(msg))) return 'That code is wrong or has expired. Check the newest email, or send a new code.';
  if (code === 'email_address_invalid' || code === 'validation_failed' || (st === 400 && /email/i.test(msg))) return 'That email address does not look right. Check it and send the code again.';
  if (code === 'foreign') return msg;
  if (code === 'no_user') return 'Your sign-in is incomplete. Sign out and sign in again; nothing on this phone is lost.';
  if (code === 'signed_out' || st === 401) return 'You are signed out. Sign in again; nothing on this phone is lost.';
  if (st >= 500) return 'The server had a problem (' + st + '). Try again in a few minutes.';
  return 'Something went wrong' + (st ? ' (' + st + ')' : '') + (msg ? ': ' + msg.slice(0, 80) : '') + '. Try again.';
}

/**
 * @param {{fetch: (url:string, init?:Obj)=>Promise<any>, getState: ()=>Obj, save: ()=>void,
 *          onStatus?: (cls:string, msg:string)=>void, now?: ()=>number,
 *          ownsHistory?: ()=>boolean, url?: string, key?: string}} deps
 * ownsHistory: true when the account, not GitHub, is where history comes
 * from (no GitHub configured). Only then does a confirmed write or a pull
 * change history; otherwise GitHub stays the source, as before.
 * checkProgramme: returns a clean programme or throws (the page passes
 * engine's normaliseProgramme; this module imports nothing).
 */
export function makeCloud({ fetch, getState, save, onStatus, now = () => Date.now(), ownsHistory = () => true, url = SUPABASE_URL, key = SUPABASE_KEY,
                            checkProgramme = (/** @type {any} */ p) => { if (!p || typeof p !== 'object' || !Array.isArray(p.days)) throw new Error('programme: not an object'); return p; } }) {
  /** @type {Set<string>} */
  const inflight = new Set();
  /** @type {Promise<void>|null} */
  let running = null;
  let rerun = false;
  /** @type {Promise<boolean>|null} */
  let pulling = null;
  /** @type {Promise<boolean>|null} */
  let refreshing = null;
  /** @type {any} */
  let lastError = null;
  /* Bumped by every sign-out and sign-in: a refresh that started before one
     must not store its tokens after it. */
  let gen = 0;

  const status = (/** @type {string} */ c, /** @type {string} */ m) => { try { onStatus && onStatus(c, m); } catch (e) { /* display only */ } };
  const S = () => {
    const s = getState();
    if (!Array.isArray(s.cloudQueue)) s.cloudQueue = [];
    if (!Array.isArray(s.history)) s.history = [];
    /* The account this phone's held data belongs to (set by v5-5 sign-ins
       before the owner was recorded, too). */
    if (!s.cloudOwner && s.cloud && s.cloud.user && s.cloud.user.id) s.cloudOwner = { id: s.cloud.user.id, email: s.cloud.user.email || null };
    return s;
  };
  const auth = () => S().cloud || null;
  const signedIn = () => { const a = auth(); return !!(a && a.access_token && a.refresh_token); };
  /** The account has been used on this phone (signed in now, or signed out since). */
  const inUse = () => !!S().cloud;
  /** Signed in as someone other than the owner of what this phone holds. */
  const foreign = () => { const o = S().cloudOwner; return !!(signedIn() && o && o.id && userId() !== o.id); };
  const foreignError = () => {
    const o = S().cloudOwner || {};
    return httpError(403, { error_code: 'foreign', msg: 'What is on this phone belongs to another account' + (o.email ? ' (' + o.email + ')' : '')
      + '. It stays on this phone and is not uploaded. Sign out, then sign in as that account to send it.' });
  };
  const newQid = () => 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const strip = (/** @type {Obj} */ item) => { const { qid, _owner, ...body } = item; return body; };
  /* Each queued item records whose it is: the signed-in user, or the last one
     signed in on this phone. Only the owner's items are ever uploaded. */
  const currentOwner = () => userId() || (auth() && auth().lastUserId) || (S().cloudOwner && S().cloudOwner.id) || null;
  const ownerOf = (/** @type {Obj} */ q) => q._owner || (S().cloudOwner && S().cloudOwner.id) || null;

  /** An error carrying the HTTP status and Supabase's error code. */
  /** @param {number} status @param {Obj|null} body */
  function httpError(status, body) {
    const b = body || {};
    const e = /** @type {any} */ (new Error(String(b.msg || b.message || b.error_description || b.error || ('HTTP ' + status))));
    e.status = status; e.code = b.error_code || b.code || (typeof b.error === 'string' ? b.error : '');
    return e;
  }
  /** @param {any} e */
  const offlineError = e => { const x = /** @type {any} */ (new Error('offline: ' + String(e && e.message || e))); x.offline = true; return x; };
  /** @param {any} res */
  async function bodyOf(res) { try { return await res.json(); } catch (e) { return null; } }

  /** @param {string} path @param {Obj} [opts] @param {string|null} [token] */
  async function call(path, opts = {}, token = null) {
    const method = String(opts.method || 'GET').toUpperCase();
    /** @type {Obj} */
    const init = {
      method,
      headers: {
        'apikey': key,
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
        ...(opts.body != null ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {})
      },
      ...(opts.body != null ? { body: JSON.stringify(opts.body) } : {})
    };
    if (method === 'GET') init.cache = 'no-store';
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(opts.timeout || 20000);
    try { return await fetch(url + path, init); }
    catch (e) {
      /* Our own timeout is not "no signal": the coach says "took too long". */
      const x = offlineError(e);
      if (e && /** @type {any} */ (e).name === 'TimeoutError') { x.offline = false; x.timeout = true; }
      throw x;
    }
  }

  /* --------------------------------------------------------------- auth */
  /** @param {Obj} j */
  function storeTokens(j) {
    const prev = auth() || {};
    const exp = Number(j.expires_at) || (Math.floor(now() / 1000) + (Number(j.expires_in) || 3600));
    const u = j.user || {};
    S().cloud = {
      access_token: j.access_token, refresh_token: j.refresh_token, expires_at: exp,
      user: { id: u.id || (prev.user && prev.user.id) || null, email: u.email || (prev.user && prev.user.email) || null }
    };
    save();
  }
  function dropTokens() {
    const a = auth() || {};
    gen++;
    /* Not null: the account stays in use, so saves keep being held for it.
       The email stays so the form can offer it again; no token does. */
    S().cloud = { signedOut: true, signedOutEmail: (a.user && a.user.email) || a.signedOutEmail || null,
      lastUserId: userId() || a.lastUserId || null };
    save();
  }

  /** @param {string} email */
  async function requestCode(email) {
    const res = await call('/auth/v1/otp', { method: 'POST', body: { email: String(email).trim(), create_user: true } });
    if (res.status !== 200) throw httpError(res.status, await bodyOf(res));
    return true;
  }
  /** @param {string} email @param {string} code */
  async function verifyCode(email, code) {
    const res = await call('/auth/v1/verify', { method: 'POST', body: { type: 'email', email: String(email).trim(), token: String(code).replace(/\D/g, '') } });
    const j = await bodyOf(res);
    if (res.status !== 200 || !j || !j.access_token || !j.refresh_token) throw httpError(res.status === 200 ? 500 : res.status, j);
    gen++;
    storeTokens(j);
    const st = S(), id = userId(), mail = st.cloud.user.email;
    /* Whoever signs in first owns what the phone holds. Another account is
       adopted only when there is nothing on the phone to mix up. */
    if (!st.cloudOwner || (st.cloudOwner.id !== id && !st.cloudQueue.length && !st.history.length && !(st.queue || []).length)) {
      /* A different account takes the phone over: nothing of the last one's
         programme, coach flag or answers stays. */
      if ((st.cloudOwner && st.cloudOwner.id !== id) || (st.programmeOwner && st.programmeOwner !== id)) forgetUser(st);
      st.cloudOwner = { id, email: mail }; save();
    }
    const isForeign = foreign();
    status(isForeign ? 'bad' : 'ok', isForeign ? 'held: other account' : 'signed in');
    return { id, email: mail, foreign: isForeign };
  }

  /* Returns true with fresh tokens stored. A refusal from the server (the
     refresh token is revoked or used up) signs out; no network keeps the
     tokens and throws, so the item simply stays queued. */
  function refresh() {
    if (refreshing) return refreshing;
    const p = (async () => {
      const a = auth(), g = gen;
      if (!a || !a.refresh_token) return false;
      const res = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: a.refresh_token } });
      const j = await bodyOf(res);
      if (g !== gen) return signedIn();                     // signed out or in meanwhile: this answer is stale
      if (res.status === 200 && j && j.access_token && j.refresh_token) { storeTokens(j); return true; }
      if (res.status >= 400 && res.status < 500 && res.status !== 429) { dropTokens(); status('bad', 'signed out'); return false; }
      throw httpError(res.status, j);
    })();
    refreshing = p;
    p.finally(() => { if (refreshing === p) refreshing = null; }).catch(() => {});
    return p;
  }
  async function freshToken() {
    if (!signedIn()) throw httpError(401, { error_code: 'signed_out', msg: 'signed out' });
    const a = auth();
    if (!(Number(a.expires_at) * 1000 - now() > 60000)) {
      if (!(await refresh())) throw httpError(401, { error_code: 'signed_out', msg: 'signed out' });
    }
    return auth().access_token;
  }
  /* A call as the signed-in user: refreshed first if near expiry, and on a
     401 refreshed once and retried once. */
  /** @param {string} path @param {Obj} [opts] */
  async function authed(path, opts = {}) {
    let res = await call(path, opts, await freshToken());
    if (res.status === 401) {
      if (!(await refresh())) throw httpError(401, { error_code: 'signed_out', msg: 'signed out' });
      res = await call(path, opts, auth().access_token);
    }
    return res;
  }
  /* An explicit sign-out also forgets the person's programme and answers, so
     the next account on this phone never sees or sends them. Sessions and
     the queue stay, as before. (A refused refresh is not a sign-out: it only
     drops the tokens.) */
  function signOut() { dropTokens(); forgetUser(S()); save(); status('', 'signed out'); }

  /** The user id the token was issued for. */
  function userId() {
    const a = auth() || {};
    if (!a.access_token) return a.user && a.user.id || null;
    try {
      const part = String(a.access_token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const sub = JSON.parse(atob(part + '='.repeat((4 - part.length % 4) % 4))).sub;
      if (sub) return sub;
    } catch (e) { /* not a JWT we can read: fall back to the stored id */ }
    return (a.user && a.user.id) || null;
  }

  /* --------------------------------------------------------------- sessions */
  /** @param {Obj} item */
  async function pushSession(item) {
    const s = strip(item), id = clientId(s), uid = userId();
    /* Never a filter or a row with no user: hold the item instead. */
    if (!uid) throw httpError(0, { error_code: 'no_user', msg: 'no user id' });
    let res;
    if (s.deleted) {
      /* Row-level security already limits this to the user's rows; the
         user_id filter is a second guard. */
      res = await authed('/rest/v1/sessions?client_id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(uid),
        { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
    } else {
      const row = { user_id: uid, client_id: id, session_date: s.date, template_key: s.key || null,
        schema_version: Number.isFinite(s.schemaVersion) ? s.schemaVersion : null, body: s };
      res = await authed('/rest/v1/sessions?on_conflict=user_id,client_id', {
        method: 'POST', body: [row], headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' }
      });
    }
    if (res.status !== 200 && res.status !== 201 && res.status !== 204) throw httpError(res.status, await bodyOf(res));
    return true;
  }

  /** @param {Obj[]} list @param {string} qid */
  const removeQ = (list, qid) => { const i = list.findIndex(x => x.qid === qid); if (i >= 0) list.splice(i, 1); };
  /** Same merge as sync.js, used only when the account owns history. @param {Obj} s */
  function mergeHistory(s) {
    if (!ownsHistory()) return;
    const st = S(), k = clientId(s);
    st.history = st.history.filter((/** @type {Obj} */ h) => clientId(h) !== k);
    if (!s.deleted) st.history.push(strip(s));
    st.history.sort((/** @type {Obj} */ a, /** @type {Obj} */ b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  /* A newer version of the same session replaces an older one that is not
     yet on its way; one already being sent is left to finish. */
  /** @param {Obj} item */
  function enqueue(item) {
    const st = S(), k = clientId(item), who = currentOwner();
    for (let i = st.cloudQueue.length - 1; i >= 0; i--) {
      const q = st.cloudQueue[i];
      if (clientId(q) === k && ownerOf(q) === who && !inflight.has(q.qid)) st.cloudQueue.splice(i, 1);
    }
    const { qid, _owner, ...body } = item;
    const q = { ...body, qid: newQid(), _owner: who };
    st.cloudQueue.push(q); save();
    return q;
  }

  /* Moves items into the account queue without ever dropping one because a
     same-named copy is there: against the owner's own queued copy the newer
     savedAt wins (the queued one on a tie); anyone else's copy is left alone.
     Returns the items that are now accounted for, so the caller removes from
     its own queue exactly those, after all are placed. */
  /** @param {Obj[]} items */
  function adoptItems(items) {
    const at = (/** @type {Obj} */ x) => String(x && x.savedAt || '');
    const who = currentOwner(), placed = [];
    for (const it of items || []) {
      if (!it || !it.date) continue;
      const mine = S().cloudQueue.filter((/** @type {Obj} */ q) => clientId(q) === clientId(it) && ownerOf(q) === who);
      const newest = mine.reduce((/** @type {Obj|null} */ a, /** @type {Obj} */ q) => (!a || at(q) >= at(a) ? q : a), null);
      if (!(newest && at(newest) >= at(it))) enqueue(it);
      placed.push(it);
    }
    return placed;
  }

  /** @param {{quiet?:boolean}} opts */
  async function flushOnce({ quiet = false } = {}) {
    const total = S().cloudQueue.length;
    if (!signedIn()) { if (total) status('bad', 'signed out · ' + total + ' held'); return; }
    const me = userId();
    if (!me) { lastError = httpError(0, { error_code: 'no_user', msg: 'no user id' }); if (total) status('bad', 'held: sign in again'); return; }
    const mine = S().cloudQueue.filter((/** @type {Obj} */ q) => ownerOf(q) === me);
    const others = total - mine.length;
    if (!mine.length) {
      if (others) { lastError = foreignError(); status('bad', 'held: other account'); }
      else if (!quiet) status('ok', 'saved');
      return;
    }
    status('pending', 'saving ' + mine.length + '…');
    /** @type {any} */
    let err = null;
    for (const item of mine) {
      if (!S().cloudQueue.includes(item)) continue;        // replaced meanwhile
      if (!item.qid) item.qid = newQid();
      const qid = item.qid;
      inflight.add(qid);
      try { await pushSession(item); removeQ(S().cloudQueue, qid); mergeHistory(item); save(); }
      catch (e) { err = e; }
      finally { inflight.delete(qid); }
      if (!signedIn()) break;                                // the rest waits for the next sign-in
    }
    const left = S().cloudQueue.filter((/** @type {Obj} */ q) => ownerOf(q) === me).length;
    if (!signedIn()) status('bad', 'signed out' + (left ? ' · ' + left + ' held' : ''));
    else if (err) status('bad', (err.offline ? 'offline' : String(err.status || 'error')) + (left ? ' · ' + left + ' held' : ''));
    else if (others && !left) status('bad', 'held: other account · ' + others);
    else status(left ? 'pending' : 'ok', left ? left + ' pending' : 'saved');
    if (err) lastError = err;
  }

  /** @param {{quiet?:boolean}} [opts] */
  function flushQueue(opts = {}) {
    if (running) { rerun = true; return running; }
    const wait = pulling;
    running = (async () => {
      try {
        if (wait) await wait.catch(() => {});
        do { rerun = false; await flushOnce(opts); } while (rerun);
      }
      finally { running = null; }
    })();
    return running;
  }

  /** Every session row this user owns, as the session bodies. */
  async function pullSessions() {
    const res = await authed('/rest/v1/sessions?select=client_id,body&order=session_date.desc,client_id.desc');
    if (res.status !== 200) throw httpError(res.status, await bodyOf(res));
    const rows = await res.json();
    return (Array.isArray(rows) ? rows : []).map(r => r && r.body).filter(b => b && b.date && !b.deleted);
  }
  /* Like sync.js's pull: replaces the pulled copy of history (only when the
     account owns it), never the queue, and never overlaps a flush. */
  function pullHistory() {
    if (pulling) return pulling;
    const wait = running;
    const p = (async () => {
      if (wait) await wait.catch(() => {});
      if (!signedIn() || !ownsHistory()) return false;
      if (foreign()) { lastError = foreignError(); status('bad', 'held: other account'); return false; }
      status('pending', 'loading…');
      try {
        const bodies = await pullSessions();
        const st = S();
        st.history = bodies.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        st.historyFetched = now(); save();
        status('ok', 'saved');
        return true;
      } catch (e) { lastError = e; status('bad', /** @type {any} */ (e).offline ? 'offline' : 'load failed'); return false; }
    })();
    pulling = p;
    p.finally(() => { if (pulling === p) pulling = null; }).catch(() => {});
    return p;
  }

  /* ------------------------------------------------------------- body (5-21)
     Bodyweight and floor benchmarks, one row per user, date and type. The
     whole set is sent in one upsert: it is small, and a second send only
     updates. Never sent for another account's data. */
  /** @param {Obj[]} entries {type:'bw'|'floor', date, ...} */
  async function pushBody(entries) {
    if (foreign()) throw foreignError();
    const uid = userId();
    if (!uid) throw httpError(0, { error_code: 'no_user', msg: 'no user id' });
    const rows = (entries || []).filter(e => e && e.date && (e.type === 'bw' || e.type === 'floor'))
      .map(e => { const { qid, _owner, ...body } = e; return { user_id: uid, entry_date: e.date, entry_type: e.type, body }; });
    if (!rows.length) return 0;
    /* One row per key: the last one given wins (the queue comes after history). */
    const byKey = new Map(rows.map(r => [r.entry_date + '|' + r.entry_type, r]));
    const res = await authed('/rest/v1/body_entries?on_conflict=user_id,entry_date,entry_type', {
      method: 'POST', body: [...byKey.values()], headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' }
    });
    if (res.status !== 200 && res.status !== 201 && res.status !== 204) throw httpError(res.status, await bodyOf(res));
    return byKey.size;
  }
  /** Every body entry this user owns, newest first. */
  async function pullBody() {
    const res = await authed('/rest/v1/body_entries?select=body&order=entry_date.desc');
    if (res.status !== 200) throw httpError(res.status, await bodyOf(res));
    const rows = await res.json();
    return (Array.isArray(rows) ? rows : []).map(r => r && r.body).filter(b => b && b.date && b.type);
  }

  /* ------------------------------------------------------------ health (5-22)
     Daily rows from Health Connect: one upsert per sync, keyed by day. */
  /** @param {Obj[]} rows {day, sleep_min, resting_hr, hrv_ms, steps, weight_kg} @param {string} [source] */
  async function pushHealth(rows, source = 'health-connect') {
    if (foreign()) throw foreignError();
    const uid = userId();
    if (!uid) throw httpError(0, { error_code: 'no_user', msg: 'no user id' });
    const body = (rows || []).filter(r => r && /^\d{4}-\d{2}-\d{2}$/.test(r.day)).map(r => ({
      user_id: uid, day: r.day, sleep_min: r.sleep_min ?? null, resting_hr: r.resting_hr ?? null, hrv_ms: r.hrv_ms ?? null,
      steps: r.steps ?? null, weight_kg: r.weight_kg ?? null, source }));
    if (!body.length) return 0;
    const res = await authed('/rest/v1/health_daily?on_conflict=user_id,day', {
      method: 'POST', body, headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' }
    });
    if (res.status !== 200 && res.status !== 201 && res.status !== 204) throw httpError(res.status, await bodyOf(res));
    return body.length;
  }
  /** @param {string} since YYYY-MM-DD */
  async function pullHealth(since) {
    const res = await authed('/rest/v1/health_daily?select=day,sleep_min,resting_hr,hrv_ms,steps,weight_kg&day=gte.' + encodeURIComponent(since) + '&order=day.asc');
    if (res.status !== 200) throw httpError(res.status, await bodyOf(res));
    const rows = await res.json();
    return (Array.isArray(rows) ? rows : []).map(r => ({ ...r, resting_hr: r.resting_hr == null ? null : Number(r.resting_hr), hrv_ms: r.hrv_ms == null ? null : Number(r.hrv_ms), weight_kg: r.weight_kg == null ? null : Number(r.weight_kg) }));
  }

  /* S7: copies every local session to the account. Safe to run twice: each
     row is keyed by its file name, so a second run updates rather than adds. */
  /** @param {Obj[]} history raw session files (not migrated copies) */
  async function importHistory(history) {
    if (foreign()) throw foreignError();
    const items = (history || []).filter(s => s && s.date && !s.deleted);
    /* A copy already queued (a save not yet sent) is newer: it is kept. */
    const qids = items.map(s => {
      const q = S().cloudQueue.find((/** @type {Obj} */ x) => clientId(x) === clientId(s) && ownerOf(x) === currentOwner());
      return (q || enqueue(s)).qid;
    });
    await flushQueue();
    if (running) await running;
    const held = S().cloudQueue.filter((/** @type {Obj} */ q) => qids.includes(q.qid)).length;
    return { total: items.length, saved: items.length - held, held };
  }

  /* ------------------------------------------------------------ programme */
  /* The user's programme lives in their profiles row: settings.programme (the
     JSON), programme_key (its id). No migration: settings is jsonb. The phone
     keeps the copy the engine runs on in S.programme; S.programmeDirty marks
     a change made here and not yet confirmed by the server, so a pull never
     overwrites it and the next sync sends it. Same guarantees as sessions:
     only 200/201/204 counts, signed out or another account holds it. */
  const ready = () => {
    if (!signedIn()) throw httpError(401, { error_code: 'signed_out', msg: 'signed out' });
    if (foreign()) throw foreignError();
    const uid = userId();
    if (!uid) throw httpError(0, { error_code: 'no_user', msg: 'no user id' });
    return uid;
  };
  /** The profile row, or null when the user has none yet. @param {string} uid */
  async function getProfile(uid) {
    const res = await authed('/rest/v1/profiles?select=programme_key,settings&id=eq.' + encodeURIComponent(uid));
    if (res.status !== 200) throw httpError(res.status, await bodyOf(res));
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  /* The server's programme, checked. Cached on the phone unless a local
     change is still waiting to go up. Null when the account has none (the
     phone's copy, if any, is kept). An unreadable one is not cached. */
  async function pullProgramme() {
    const uid = ready();
    const row = await getProfile(uid);
    const raw = row && row.settings && typeof row.settings === 'object' ? row.settings.programme : null;
    const st = S();
    /* Dan's own account: programme_key 'coach' and no programme JSON means the
       coach programme in the code. Re-derived on every pull, so it never
       sticks to a phone after another account signs in. */
    if (!raw && row && row.programme_key === 'coach') st.coach = true; else delete st.coach;
    /* The phone's copy counts only if it is this user's: a held change of
       theirs waits to go up; anyone else's is dropped, never shown or sent. */
    const mine = !!st.programme && progOwner(st) === uid;
    if (!mine) clearProgramme(st);
    const held = mine && !!st.programmeDirty;
    if (!raw) { if (!held) clearProgramme(st); save(); return null; }
    save();
    const p = checkProgramme(raw);
    /* Two phones: a held change is kept unless the account's copy is newer. */
    if (held && !newer(p, st.programme)) return p;
    st.programme = p; st.programmeOwner = uid; delete st.programmeDirty; save();
    return p;
  }

  /** @type {Promise<boolean>|null} */
  let progRunning = null;
  let progRerun = false;
  /* Sends the phone's programme. The other keys in settings are kept: the row
     is read first and only settings.programme is replaced. An upsert, so the
     first save creates the row. One at a time; a call during one runs again
     after it, so the newest programme is the last one sent. */
  function pushProgramme() {
    if (progRunning) { progRerun = true; return progRunning; }
    const p = (async () => {
      let ok = false;
      do {
        progRerun = false;
        const st = S(), sent = st.programme;
        if (!sent) return false;
        const uid = ready();
        /* Never send a programme cached for another user to this user's row. */
        if (progOwner(st) !== uid) throw httpError(403, { error_code: 'foreign', msg: 'This programme belongs to another account. It is not sent.' });
        const row = await getProfile(uid);
        const cur = row && row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings) ? row.settings : {};
        /* Another phone saved a newer programme meanwhile: keep that one and
           drop this phone's older change, rather than overwrite it silently. */
        if (cur.programme && newer(cur.programme, sent)) {
          let theirs = null;
          try { theirs = checkProgramme(cur.programme); } catch (e) { /* unreadable: ours replaces it */ }
          if (theirs) {
            if (S().programme === sent) { st.programme = theirs; st.programmeOwner = uid; delete st.programmeDirty; save(); }
            lastError = httpError(409, { error_code: 'superseded', msg: 'A newer programme from another phone was kept.' });
            ok = true;
            continue;
          }
        }
        const res = await authed('/rest/v1/profiles?on_conflict=id', {
          method: 'POST', headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: [{ id: uid, programme_key: sent.id, settings: { ...cur, programme: sent } }]
        });
        if (res.status !== 200 && res.status !== 201 && res.status !== 204) throw httpError(res.status, await bodyOf(res));
        if (S().programme === sent) { delete S().programmeDirty; save(); }
        ok = true;
      } while (progRerun);
      return ok;
    })();
    progRunning = p;
    p.finally(() => { if (progRunning === p) progRunning = null; }).catch(() => {});
    return p;
  }

  /* Sets the programme on this phone now (the engine can use it at once) and
     sends it when it can. Resolves true when the server has it, false when it
     is held (signed out, offline, another account); never rejects for that.
     Throws only for a programme that fails the check. */
  /** @param {Obj} prog */
  async function setProgramme(prog) {
    const p = checkProgramme(prog);
    p.updatedAt = new Date(now()).toISOString();
    const st = S();
    st.programme = p; st.programmeDirty = true; st.programmeOwner = currentOwner(); save();
    try { return await pushProgramme(); }
    catch (e) { lastError = e; return false; }
  }

  /* On open or after sign-in: a held local change goes up; otherwise the
     server's copy comes down. Resolves to the programme in use, or null. */
  async function syncProgramme() {
    try {
      if (S().programmeDirty) await pushProgramme();
      else await pullProgramme();
    } catch (e) { lastError = e; }
    return S().programme || null;
  }

  /* --------------------------------------------------------------- coach */
  /* The coach chat (release 2). The question goes to the `coach` Edge
     Function with the user's token; the function reads the log from the
     account, so the account queue is flushed first. If that leaves the
     user's sessions held, the question is still sent and the result says so
     (unsynced), so the answer can warn the coach didn't see them. 60 s, not
     the 20 s of other calls. Errors carry the function's code: limit (429),
     off (503), signed_out (401), too_long (413), busy (502), timeout (504,
     or our own abort: e.timeout), and e.offline for no signal. */
  /** @param {{question:string, kind?:string, week?:string|null, scope?:Obj|null}} req */
  async function askCoach(req) {
    const uid = ready();
    try { await flushQueue({ quiet: true }); } catch (e) { /* sent anyway */ }
    const unsynced = S().cloudQueue.filter((/** @type {Obj} */ q) => ownerOf(q) === uid).length;
    const body = { question: String(req.question || ''), kind: req.kind === 'week_review' ? 'week_review' : 'chat',
      ...(req.week ? { week: req.week } : {}), ...(req.scope ? { scope: req.scope } : {}) };
    const res = await authed('/functions/v1/coach', { method: 'POST', body, timeout: COACH_TIMEOUT });
    const j = await bodyOf(res);
    if (res.status !== 200 || !j || typeof j.answer !== 'string') {
      const e = httpError(res.status, { error_code: (j && j.error) || (res.status === 200 ? 'server' : ''), msg: 'coach ' + res.status });
      /** @type {any} */ (e).remaining = j && typeof j.remaining === 'number' ? j.remaining : null;
      throw e;
    }
    return { ...j, unsynced };
  }
  /* 5-25: read an existing plan (text, photo or a public Google Doc/Sheet)
     into a programme. Returns {programme, warnings, unmatched}; saves nothing. */
  /** @param {{text?:string, image?:{media_type:string, data:string}, link?:string, library?:string[]}} req */
  async function importPlan(req) {
    ready();
    const body = { kind: 'import', ...(req.text ? { text: req.text } : {}), ...(req.image ? { image: req.image } : {}), ...(req.link ? { link: req.link } : {}), library: req.library || [] };
    const res = await authed('/functions/v1/coach', { method: 'POST', body, timeout: COACH_TIMEOUT });
    const j = await bodyOf(res);
    if (res.status !== 200 || !j) throw httpError(res.status, { error_code: (j && j.error) || 'server', msg: 'import ' + res.status });
    return j;
  }
  /* The user's messages, newest first, 30 at a time (RLS: only their own). */
  /** @param {{before?:string|null, limit?:number}} [o] */
  async function chatHistory(o = {}) {
    ready();
    const lim = o.limit || 30;
    const res = await authed('/rest/v1/chat_messages?select=id,role,kind,week,content,safety,meta,created_at&order=created_at.desc&limit=' + lim
      + (o.before ? '&created_at=lt.' + encodeURIComponent(o.before) : ''), { headers: { 'Prefer': 'count=exact' } });
    if (res.status !== 200 && res.status !== 206) throw httpError(res.status, await bodyOf(res));
    const rows = await res.json();
    const range = res.headers && typeof res.headers.get === 'function' ? String(res.headers.get('content-range') || '') : '';
    const m = /\/(\d+)$/.exec(range);
    return { rows: Array.isArray(rows) ? rows : [], total: m ? Number(m[1]) : null };
  }
  /* C6: every chat row of this user, at once. The usage counter is not
     touched (no grant allows it). The user_id filter is a second guard. */
  async function deleteChat() {
    const uid = ready();
    const res = await authed('/rest/v1/chat_messages?user_id=eq.' + encodeURIComponent(uid), { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
    if (res.status !== 200 && res.status !== 204) throw httpError(res.status, await bodyOf(res));
    return true;
  }
  /* The coach's first-run "OK, got it" is kept in the account
     (profiles.settings.coachChat = { ok: copy version, at }), so a second
     phone doesn't ask again. Other settings keys are kept as they are. */
  async function coachAccepted() {
    const row = await getProfile(ready());
    const c = row && row.settings && typeof row.settings === 'object' ? row.settings.coachChat : null;
    return c && typeof c.ok === 'number' ? c.ok : 0;
  }
  /* One statement on the server (settings_merge: settings || patch), so it
     can't drop a key another write (the programme) put there meanwhile. */
  /** @param {number} version */
  async function acceptCoach(version) {
    ready();
    const res = await authed('/rest/v1/rpc/settings_merge', {
      method: 'POST', headers: { 'Prefer': 'return=minimal' },
      body: { patch: { coachChat: { ok: version, at: new Date(now()).toISOString() } } }
    });
    if (res.status !== 200 && res.status !== 201 && res.status !== 204) throw httpError(res.status, await bodyOf(res));
    return true;
  }
  /* Invite-only: true when this user has a coach_access row (RLS: only
     their own row is visible). */
  async function coachAccess() {
    ready();
    const res = await authed('/rest/v1/coach_access?select=user_id&limit=1');
    if (res.status !== 200) throw httpError(res.status, await bodyOf(res));
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  }

  return {
    askCoach, importPlan, chatHistory, deleteChat, coachAccepted, acceptCoach, coachAccess,
    requestCode, verifyCode, signOut, signedIn, refresh, pushSession, pullSessions, pullHistory, pushBody, pullBody, pushHealth, pullHealth,
    pullProgramme, pushProgramme, setProgramme, syncProgramme,
    importHistory, enqueue, adoptItems, flushQueue, userId, inUse, foreign, ownerId: () => currentOwner(),
    owner: () => S().cloudOwner || null,
    email: () => { const a = auth(); return a ? (a.user && a.user.email) || a.signedOutEmail || '' : ''; },
    lastError: () => lastError
  };
}
