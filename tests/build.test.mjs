import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  // No runtime network references other than the licence/repo links.
  const urls = html.match(/https?:\/\/[^\s"'<>)]+/g) || [];
  for (const url of urls) {
    assert.match(url, /^https:\/\/(github\.com\/atwseoper|polyformproject\.org)(\/|$)/, `unexpected URL ${url}`);
  }
});
