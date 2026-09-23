// @ts-check
/* Ledger sync: the GitHub contents API and the phone's upload queue.
   Built by a factory so the tests can hand it a fake fetch and no network.

   The rules that keep a session from being lost:
   - a PUT counts only on 200 or 201; anything else keeps the item queued
   - one flush at a time; a second call joins it and runs once more after
   - each queue item has its own qid and is removed only after its own PUT
   - every GET is cache:'no-store', so a stale sha never reaches a PUT      */

/** @typedef {Record<string, any>} Obj */

/**
 * @param {{fetch: (url:string, init?:Obj)=>Promise<any>, getState: ()=>Obj, save: ()=>void, onStatus?: (cls:string, msg:string)=>void}} deps
 */
export function makeSync({ fetch, getState, save, onStatus }) {
  const API = 'https://api.github.com';
  /** @type {Set<string>} */
  const inflight = new Set();
  /** @type {Promise<void>|null} */
  let running = null;
  let rerun = false;
  /* A pull replaces history wholesale, so it must not overlap a flush: a
     session pushed (and merged) mid-pull would vanish from history. Each
     waits for the other. */
  /** @type {Promise<boolean>|null} */
  let pulling = null;

  const status = (/** @type {string} */ c, /** @type {string} */ m) => { try { onStatus && onStatus(c, m); } catch (e) { /* display only */ } };
  const cfg = () => getState().settings;
  const dir = () => String(cfg().path || '').replace(/^\/+|\/+$/g, '');
  const cfgOk = () => { const c = cfg(); return !!(c.token && c.owner && c.repo && c.path); };
  const pathOf = (/** @type {Obj} */ s) => s.file || (dir() + '/' + s.date + '-' + s.key + '.json');
  const baseName = (/** @type {Obj} */ s) => String(pathOf(s)).split('/').pop();
  const newQid = () => 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const strip = (/** @type {Obj} */ item) => { const { qid, ...body } = item; return body; };
  const short = (/** @type {any} */ e) => String(e && e.message || e).slice(0, 28);

  /** @param {string} str */
  function b64enc(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  /** @param {string} b64 */
  function b64dec(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }

  /** @param {string} path @param {Obj} [opts] */
  async function gh(path, opts = {}) {
    const c = cfg();
    const method = String(opts.method || 'GET').toUpperCase();
    /** @type {Obj} */
    const init = {
      ...opts, method,
      headers: {
        'Authorization': 'Bearer ' + c.token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {})
      }
    };
    if (method === 'GET') init.cache = 'no-store';
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(20000);
    const res = await fetch(API + path, init);
    if (method === 'GET') {
      if (res.status === 404) return null;               // no such file: a fact, not an error
      if (!res.ok) throw new Error((res.status + ' ' + await detail(res)).trim());
      return res.json();
    }
    /* A write is done only when GitHub says it is. A 404 here means the token
       cannot see the repo, and treating it as "no file" used to drop sessions. */
    if (res.status !== 200 && res.status !== 201) throw new Error((res.status + ' ' + await detail(res)).trim());
    try { return await res.json(); } catch (e) { return true; }
  }
  /** @param {any} res */
  async function detail(res) { try { return (await res.json()).message || ''; } catch (e) { return ''; } }

  const repoPath = () => '/repos/' + cfg().owner + '/' + cfg().repo;
  const ref = () => '?ref=' + encodeURIComponent(cfg().branch);

  /** @param {string} p @param {Obj} obj @param {string} msg */
  async function putFile(p, obj, msg) {
    const existing = await gh(repoPath() + '/contents/' + p + ref());
    const sha = existing && existing.sha;
    await gh(repoPath() + '/contents/' + p, {
      method: 'PUT',
      body: JSON.stringify({ message: msg, content: b64enc(JSON.stringify(obj, null, 2)), branch: cfg().branch, ...(sha ? { sha } : {}) })
    });
    return true;
  }
  /** @param {string} p */
  async function getFile(p) {
    const blob = await gh(repoPath() + '/contents/' + p + ref());
    if (!blob || !blob.content) return null;
    try { return JSON.parse(b64dec(blob.content)); } catch (e) { return null; }
  }
  const testRepo = () => gh(repoPath());

  /* Queued items are pushed exactly as stored, minus the queue's own qid. */
  /** @param {Obj} s */
  const pushSession = s => putFile(pathOf(s), strip(s), 'Training: ' + s.name + ' — ' + s.date + (s.deleted ? ' (deleted)' : ''));

  /* Bodyweight and floor benchmarks go one file per month: a year of daily
     weigh-ins is 12 files, not 365. */
  /** @param {Obj} item */
  async function pushBw(item) {
    const entry = strip(item);
    const p = dir() + '/bw-' + entry.date.slice(0, 7) + '.json';
    const cur = (await getFile(p)) || { month: entry.date.slice(0, 7), entries: [] };
    cur.entries = (cur.entries || []).filter((/** @type {Obj} */ e) => !(e.date === entry.date && e.type === entry.type));
    cur.entries.push(entry);
    cur.entries.sort((/** @type {Obj} */ a, /** @type {Obj} */ b) => (a.date < b.date ? 1 : -1));
    await putFile(p, cur, 'Training: ' + (entry.type === 'bw' ? 'bodyweight' : 'floor benchmark') + ' — ' + entry.date);
  }

  /** @param {Obj[]} list @param {string} qid */
  const removeQ = (list, qid) => { const i = list.findIndex(x => x.qid === qid); if (i >= 0) list.splice(i, 1); };

  /** @param {Obj} s */
  function mergeHistory(s) {
    const S = getState(), k = baseName(s);
    S.history = S.history.filter((/** @type {Obj} */ h) => baseName(h) !== k);
    if (!s.deleted) S.history.push(strip(s));
    S.history.sort((/** @type {Obj} */ a, /** @type {Obj} */ b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }
  /** @param {Obj} b */
  function mergeBw(b) {
    const S = getState(), e = strip(b);
    S.bw = S.bw.filter((/** @type {Obj} */ x) => !(x.date === e.date && x.type === e.type));
    S.bw.push(e);
    S.bw.sort((/** @type {Obj} */ a, /** @type {Obj} */ c) => (a.date < c.date ? 1 : -1));
  }

  /* A newer version of the same file replaces an older one that is not yet
     on its way; one already being pushed is left to finish.
     A tombstone for a path GitHub has never confirmed (not in history, and
     not being pushed right now) only cancels the queued copy: pushing it would
     create a deleted:true file where no file ever was. Returns null then. */
  /** @param {Obj} item */
  function enqueue(item) {
    const S = getState(), p = pathOf(item);
    let busy = false;
    for (let i = S.queue.length - 1; i >= 0; i--) {
      const q = S.queue[i];
      if (pathOf(q) !== p) continue;
      if (inflight.has(q.qid)) busy = true; else S.queue.splice(i, 1);
    }
    if (item.deleted && !busy && !S.history.some((/** @type {Obj} */ h) => pathOf(h) === p)) { save(); return null; }
    const q = { ...item, qid: newQid() };
    S.queue.push(q); save();
    return q;
  }
  /** @param {Obj} entry */
  function enqueueBw(entry) { const q = { ...entry, qid: newQid() }; getState().bwQueue.push(q); save(); return q; }

  /** @param {{quiet?:boolean}} opts */
  async function flushOnce({ quiet = false } = {}) {
    const S = getState();
    const total = S.queue.length + S.bwQueue.length;
    if (!cfgOk()) { if (total) status('bad', 'no token'); return; }
    if (!total) { if (!quiet) status('ok', 'synced'); return; }
    status('pending', 'syncing ' + total + '…');
    let err = '';
    /** @param {string} key @param {(x:Obj)=>Promise<any>} push @param {(x:Obj)=>void} merge */
    const drain = async (key, push, merge) => {
      for (const item of getState()[key].slice()) {
        if (!getState()[key].includes(item)) continue;     // collapsed meanwhile
        if (!item.qid) item.qid = newQid();                // items queued before v5
        const qid = item.qid;
        inflight.add(qid);
        try { await push(item); removeQ(getState()[key], qid); merge(item); save(); }
        catch (e) { err = short(e); status('bad', err); }
        finally { inflight.delete(qid); }
      }
    };
    await drain('queue', pushSession, mergeHistory);
    await drain('bwQueue', pushBw, mergeBw);
    const left = getState().queue.length + getState().bwQueue.length;
    if (err) status('bad', err + (left ? ' · ' + left + ' held' : ''));
    else status(left ? 'pending' : 'ok', left ? left + ' pending' : 'synced');
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

  /* Replaces the pulled copy of the log. Anything still queued is not touched:
     the views read history and queue merged. */
  function pullHistory() {
    if (pulling) return pulling;
    const wait = running;
    const p = (async () => {
      if (wait) await wait.catch(() => {});
      return pullOnce();
    })();
    pulling = p;
    p.finally(() => { if (pulling === p) pulling = null; }).catch(() => {});
    return p;
  }
  async function pullOnce() {
    if (!cfgOk()) return false;
    status('pending', 'loading…');
    try {
      const list = await gh(repoPath() + '/contents/' + dir() + ref());
      const S = getState();
      if (!list) { status('ok', 'no log yet'); return true; }
      const files = list.filter((/** @type {Obj} */ f) => f.type === 'file' && f.name.endsWith('.json') && f.name !== 'README.json')
        .sort((/** @type {Obj} */ a, /** @type {Obj} */ b) => (a.name < b.name ? 1 : -1));
      const sessions = files.filter((/** @type {Obj} */ f) => !f.name.startsWith('bw-')).slice(0, 80);
      const months = files.filter((/** @type {Obj} */ f) => f.name.startsWith('bw-')).slice(0, 18);
      const out = [];
      for (const f of sessions) {
        const j = await getFile(f.path).catch(() => null);
        if (!j || j.deleted || !j.date) continue;
        if (!j.file && pathOf(j) !== f.path) j.file = f.path;   // a -2 file written before its own path was recorded
        out.push(j);
      }
      const bw = [];
      for (const f of months) {
        const j = await getFile(f.path).catch(() => null);
        if (j && Array.isArray(j.entries)) bw.push(...j.entries);
      }
      S.history = out;
      S.bw = bw.sort((a, b) => (a.date < b.date ? 1 : -1));
      S.historyFetched = Date.now(); save();
      status('ok', 'synced');
      return true;
    } catch (e) { status('bad', short(e)); return false; }
  }

  return { flushQueue, pullHistory, putFile, getFile, testRepo, enqueue, enqueueBw, cfgOk, dir, pathOf };
}
