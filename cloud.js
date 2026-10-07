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
 */
export function makeCloud({ fetch, getState, save, onStatus, now = () => Date.now(), ownsHistory = () => true, url = SUPABASE_URL, key = SUPABASE_KEY }) {
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
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(20000);
    try { return await fetch(url + path, init); }
    catch (e) { throw offlineError(e); }
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
  function signOut() { dropTokens(); status('', 'signed out'); }

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

  return {
    requestCode, verifyCode, signOut, signedIn, refresh, pushSession, pullSessions, pullHistory,
    importHistory, enqueue, adoptItems, flushQueue, userId, inUse, foreign, ownerId: () => currentOwner(),
    owner: () => S().cloudOwner || null,
    email: () => { const a = auth(); return a ? (a.user && a.user.email) || a.signedOutEmail || '' : ''; },
    lastError: () => lastError
  };
}
