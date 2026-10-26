/* Ledger service worker: app shell only. Never touches the GitHub API or
   Supabase: only same-origin GETs are handled, so both always hit the network.

   The modules are imported with a version query (engine.js?v=5-25), and the
   same URLs are listed here, so a page can never run with a module from a
   different build. Bump VERSION and the ?v= in index.html together. */
const VERSION = 'ledger-v5-25';
const SHELL = ['./', './index.html', './engine.js?v=5-25', './sync.js?v=5-25', './cloud.js?v=5-25', './library.js?v=5-25', './programme.js?v=5-25', './coach.js?v=5-25', './logview.js?v=5-25', './progress.js?v=5-25', './health.js?v=5-25', './manifest.json', './icon.svg', './privacy.html'];
const NET_TIMEOUT = 3000;

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Never intercept the GitHub API: writes and reads must always hit the network.
  if (url.hostname === 'api.github.com') return;
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(serve(e));
});

/* Network first, so a redeploy is picked up when online. If the network is
   slow (3 s) or gone, the cached copy for this VERSION is served and the
   network response still refreshes the cache in the background. Only OK
   responses are cached. Only a page navigation ever falls back to
   index.html: a script request answered with HTML would blank the app. */
async function serve(e) {
  const req = e.request;
  const cache = await caches.open(VERSION);
  /* no-cache: revalidate with the server every time. GitHub Pages sends
     max-age=600, so a plain fetch kept serving the old build for 10 minutes
     after a deploy. A navigation request can't be re-made with options, hence
     the URL. */
  const net = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  e.waitUntil(net.then(() => {}, () => {}));
  const timeout = new Promise(r => setTimeout(() => r(null), NET_TIMEOUT));
  try {
    const first = await Promise.race([net, timeout]);
    if (first) return first;
  } catch (err) { /* offline: fall through to the cache */ }
  const hit = (await cache.match(req)) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
  if (hit) return hit;
  try { return await net; } catch (err) { return Response.error(); }
}
