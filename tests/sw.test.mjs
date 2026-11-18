// The service worker (D45) runs here against fake caches, fetch and events, to check it
// saves only the page, answers only page requests in its scope and cleans up only its own
// old caches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build } from '../build/build.mjs';

const SCOPE = 'https://atwseoper.github.io/Web-Graphing-Calc/';

function fakeResponse(body, { ok = true, type = 'basic' } = {}) {
  return { body, ok, type, clone() { return fakeResponse(body, { ok, type }); } };
}

function worker(source, { stored = {}, network = (url) => fakeResponse(`net:${url}`) } = {}) {
  const listeners = {};
  const caches = new Map(Object.entries(stored).map(([name, entries]) => [name, new Map(Object.entries(entries))]));
  const fetched = [];
  let skipped = false;
  const keyOf = (r) => (typeof r === 'string' ? r : r.url);
  const cacheApi = (map) => ({
    async add(req) {
      fetched.push({ url: keyOf(req), cache: req.cache });
      map.set(keyOf(req), fakeResponse(`page@install`));
    },
    async put(req, res) { map.set(keyOf(req), res); },
    async match(req) { return map.get(keyOf(req)); },
  });
  const ctx = {
    self: {
      registration: { scope: SCOPE },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: () => { skipped = true; },
    },
    caches: {
      async open(name) {
        if (!caches.has(name)) caches.set(name, new Map());
        return cacheApi(caches.get(name));
      },
      async keys() { return [...caches.keys()]; },
      async delete(name) { return caches.delete(name); },
    },
    Request: class { constructor(url, init = {}) { this.url = url; this.cache = init.cache; } },
    fetch: async (req) => {
      fetched.push({ url: keyOf(req) });
      return network(keyOf(req));
    },
    Promise,
  };
  vm.runInNewContext(source, ctx);

  async function dispatch(type, extra = {}) {
    let waited = null;
    let response = null;
    const event = {
      ...extra,
      waitUntil(p) { waited = p; },
      respondWith(p) { response = p; },
    };
    listeners[type](event);
    if (waited) await waited;
    return { responded: response !== null, response: response && await response };
  }
  return {
    listeners, caches, fetched, dispatch,
    get skipped() { return skipped; },
    fetchEvent: (url, method = 'GET') => dispatch('fetch', { request: { url, method } }),
  };
}

const built = build();
const source = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');

test('sw.js is stamped with the build and is plain ASCII', () => {
  assert.doesNotMatch(source, /__CACHE_NAME__/);
  assert.ok(source.includes(`'${built.cacheName}'`));
  const sha = built.info.split(' · ')[1];
  assert.ok(sha && built.cacheName.includes(sha), 'cache name carries the commit');
  assert.match(built.cacheName, /^web-graphing-calc [\x20-\x7e]+ [0-9a-f]{12}$/);
  assert.match(source, /^[\x00-\x7f]*$/, 'no non-ASCII characters');
  // It fetches only through the handlers below: no importScripts or extra URLs.
  assert.doesNotMatch(source, /importScripts|https?:\/\//);
});

test('install saves only the page, bypassing the HTTP cache', async () => {
  const w = worker(source);
  await w.dispatch('install');
  assert.deepEqual([...w.caches.keys()], [built.cacheName]);
  assert.deepEqual([...w.caches.get(built.cacheName).keys()], [SCOPE]);
  assert.deepEqual(w.fetched, [{ url: SCOPE, cache: 'reload' }]);
});

test('pages in the scope come from the cache, ignoring query strings', async () => {
  const w = worker(source);
  await w.dispatch('install');
  for (const path of ['', 'index.html', 'graphcalc.html', 'graphcalc.html?x=1', '?utm=a', 'index.html#g=abc']) {
    const r = await w.fetchEvent(SCOPE + path);
    assert.ok(r.responded, `answers ${path || '(scope)'}`);
    assert.equal(r.response.body, 'page@install');
  }
  assert.equal(w.fetched.length, 1, 'no network requests after install');
});

test('everything else goes straight to the network', async () => {
  const w = worker(source);
  await w.dispatch('install');
  const others = [
    `${SCOPE}sw.js`, `${SCOPE}other.html`, `${SCOPE}sub/index.html`, `${SCOPE}graphcalc.html.bak`,
    'https://atwseoper.github.io/', 'https://atwseoper.github.io/Other-Project/',
    'https://atwseoper.github.io/Web-Graphing-Calc', 'https://example.com/Web-Graphing-Calc/',
  ];
  for (const url of others) assert.equal((await w.fetchEvent(url)).responded, false, url);
  assert.equal((await w.fetchEvent(SCOPE, 'POST')).responded, false, 'POST');
});

test('a cleared cache falls back to the network and is saved again', async () => {
  const w = worker(source);
  const r = await w.fetchEvent(`${SCOPE}graphcalc.html`);
  assert.equal(r.response.body, `net:${SCOPE}graphcalc.html`);
  assert.equal(w.caches.get(built.cacheName).get(SCOPE).body, `net:${SCOPE}graphcalc.html`);
  // Failed or cross-origin answers aren't saved.
  const w2 = worker(source, { network: () => fakeResponse('err', { ok: false }) });
  await w2.fetchEvent(SCOPE);
  assert.equal(w2.caches.get(built.cacheName).size, 0);
});

test('activate deletes only this app\'s older caches', async () => {
  const w = worker(source, {
    stored: {
      'web-graphing-calc v1.0.0 old 2026-11-01 0123456789ab': { [SCOPE]: fakeResponse('old') },
      [built.cacheName]: { [SCOPE]: fakeResponse('new') },
      'another-project-cache': {},
    },
  });
  await w.dispatch('activate');
  assert.deepEqual([...w.caches.keys()].sort(), ['another-project-cache', built.cacheName].sort());
});

test('the waiting worker takes over only when the page asks', async () => {
  const w = worker(source);
  await w.dispatch('message', { data: { type: 'something-else' } });
  assert.equal(w.skipped, false);
  await w.dispatch('message', { data: null });
  assert.equal(w.skipped, false);
  await w.dispatch('message', { data: { type: 'skip-waiting' } });
  assert.equal(w.skipped, true);
});
