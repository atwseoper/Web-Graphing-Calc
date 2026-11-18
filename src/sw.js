// Service worker for the GitHub Pages site (D45): lets the installed app start with no
// connection. build/build.mjs copies this file to dist/sw.js, replacing __CACHE_NAME__
// with the build stamp and a hash of the page, so every deploy changes this file and the
// browser installs the new worker in the background.
//
// This is a classic worker script, not an ES module, and it isn't bundled. It must stay
// tiny: it caches only the page itself and fetches nothing else.
//   install   save the page (the scope URL, "./") in a cache named for this build
//   fetch     pages in the scope (./, ./index.html, ./graphcalc.html, any query string)
//             come from that cache; every other request goes to the network untouched
//   message   "skip-waiting" from the page's "New version / Reload" toast activates it
//   activate  delete this app's caches from earlier builds
// A new worker waits until the page asks it to take over (or every window is closed), so
// nothing reloads without the user's tap.

const PREFIX = 'web-graphing-calc ';
const CACHE = '__CACHE_NAME__';
const PAGE_NAMES = ['', 'index.html', 'graphcalc.html'];

const scope = () => self.registration.scope;

function isPage(url) {
  const base = scope();
  if (!url.startsWith(base)) return false;
  return PAGE_NAMES.includes(url.slice(base.length).split(/[?#]/)[0]);
}

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the HTTP cache, so the new worker saves the new page.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(scope(), { cache: 'reload' }))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)),
  )));
});

async function page(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(scope());
  if (saved) return saved;
  // The saved copy was cleared (storage pressure): use the network and save it again.
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') await cache.put(scope(), response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !isPage(request.url)) return;
  event.respondWith(page(request));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});
