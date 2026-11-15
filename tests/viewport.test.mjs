import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createViewport, toScreen, toWorld, worldBounds, niceStep, ticks, formatTick,
} from '../src/js/plot/viewport.js';

test('toScreen and toWorld are inverses', () => {
  const vp = createViewport({ width: 400, height: 300, cx: 1.5, cy: -2, scale: 37 });
  for (const [x, y] of [[0, 0], [1.5, -2], [-10, 7.25], [3e3, -4e-3]]) {
    const [sx, sy] = toScreen(vp, x, y);
    const [wx, wy] = toWorld(vp, sx, sy);
    assert.ok(Math.abs(wx - x) < 1e-9 && Math.abs(wy - y) < 1e-9, `round trip ${x},${y}`);
  }
});

test('centre of viewport maps to centre of screen; y axis points up', () => {
  const vp = createViewport({ width: 200, height: 100, cx: 5, cy: 5, scale: 10 });
  assert.deepEqual(toScreen(vp, 5, 5), [100, 50]);
  assert.ok(toScreen(vp, 5, 6)[1] < 50);
});

test('worldBounds', () => {
  const vp = createViewport({ width: 200, height: 100, cx: 0, cy: 0, scale: 10 });
  assert.deepEqual(worldBounds(vp), { xMin: -10, xMax: 10, yMin: -5, yMax: 5 });
});

test('niceStep returns 1, 2 or 5 times a power of ten', () => {
  const cases = [[0.7, 1], [1, 1], [1.01, 2], [2.5, 5], [6, 10], [0.013, 0.02], [420, 500], [9e-7, 1e-6]];
  for (const [input, expected] of cases) {
    assert.ok(Math.abs(niceStep(input) - expected) < expected * 1e-12, `niceStep(${input})`);
  }
  assert.throws(() => niceStep(0), RangeError);
  assert.throws(() => niceStep(NaN), RangeError);
});

test('ticks are multiples of step inside the range', () => {
  assert.deepEqual(ticks(-2.5, 2.5, 1), [-2, -1, 0, 1, 2]);
  assert.deepEqual(ticks(0.1, 0.9, 0.5), [0.5]);
});

test('formatTick avoids floating-point noise', () => {
  assert.equal(formatTick(0.1 + 0.2, 0.1), '0.3');
  assert.equal(formatTick(1e-17, 0.1), '0');
  assert.equal(formatTick(-4, 2), '-4');
  assert.equal(formatTick(0.25, 0.05), '0.25');
});
