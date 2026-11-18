import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { build } from '../build/build.mjs';

test('build produces a single self-contained HTML file', () => {
  build();
  const html = readFileSync(new URL('../dist/graphcalc.html', import.meta.url), 'utf8');
  assert.match(html, /^<!DOCTYPE html>/);
  assert.doesNotMatch(html, /<link\s+rel="stylesheet"/, 'stylesheets must be inlined');
  assert.doesNotMatch(html, /<script[^>]+src=/, 'scripts must be inlined');
  assert.doesNotMatch(html, /\b(?:import|export)\s*\{/, 'module syntax must be bundled away');
  assert.doesNotMatch(html, /__BUILD_INFO__/);
  assert.match(html, /^Required Notice: Copyright/m, 'licence notice must be present');
  // No runtime network references other than the licence/repo links and the app's own
  // Pages address (used as the base of share links made from a downloaded copy).
  const urls = html.match(/https?:\/\/[^\s"'<>)]+/g) || [];
  for (const url of urls) {
    assert.match(url, /^https:\/\/(github\.com\/atwseoper|polyformproject\.org|atwseoper\.github\.io\/Web-Graphing-Calc)(\/|$)/, `unexpected URL ${url}`);
  }
});

test('build writes the service worker beside the page (D45)', () => {
  const { cacheName } = build();
  const sw = new URL('../dist/sw.js', import.meta.url);
  assert.ok(existsSync(sw), 'dist/sw.js exists');
  assert.ok(readFileSync(sw, 'utf8').includes(cacheName), 'sw.js carries the build stamp');
  const html = readFileSync(new URL('../dist/graphcalc.html', import.meta.url), 'utf8');
  // The page refers to the worker only by its relative name, and only to register it.
  assert.deepEqual(html.match(/['"`][^'"`\n]*sw\.js['"`]/g), ["'./sw.js'"]);
  assert.match(html, /\.register\('\.\/sw\.js'\)/);
});
