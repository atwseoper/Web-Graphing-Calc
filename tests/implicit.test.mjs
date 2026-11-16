import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewport, toWorld } from '../src/js/plot/viewport.js';
import { contour, regionRects, snapToCurve } from '../src/js/plot/implicit.js';
import { rk4Path, solutionThrough } from '../src/js/numerics/ode.js';
import { analyse } from '../src/js/expr/model.js';

const vp = createViewport({ width: 400, height: 300, scale: 40 }); // x in [-5, 5], y in [-3.75, 3.75]

function worldPoints(lines) {
  const out = [];
  for (const l of lines) for (let i = 0; i < l.x.length; i++) out.push(toWorld(vp, l.x[i], l.y[i]));
  return out;
}

test('a circle is one closed polyline lying on the circle', () => {
  const lines = contour((x, y) => x * x + y * y - 4, vp);
  assert.equal(lines.length, 1);
  const l = lines[0];
  assert.ok(l.x.length > 100);
  assert.equal(l.x[0], l.x[l.x.length - 1], 'closed');
  for (const [x, y] of worldPoints(lines)) assert.ok(Math.abs(Math.hypot(x, y) - 2) < 0.01, 'within half a pixel');
});

test('poles are not drawn as curves', () => {
  // tan(x) = y crosses sign at the asymptotes x = ±π/2 without being zero there.
  const lines = contour((x, y) => Math.tan(x) - y, vp);
  for (const [x, y] of worldPoints(lines)) {
    const k = Math.round((x - Math.atan(y)) / Math.PI);
    assert.ok(Math.abs(x - Math.atan(y) - k * Math.PI) < 0.01, `${x}, ${y}`);
  }
  // y = 1/x as x·y = 1 has two branches, and 1/x - y = 0 must not join them at x = 0.
  const hyper = contour((x, y) => 1 / x - y, vp);
  for (const [x, y] of worldPoints(hyper)) assert.ok(Math.abs(x * y - 1) < 0.05, `${x}, ${y}`);
});

test('crossing curves (saddles) stay correct: x·y = 0 gives both axes', () => {
  const pts = worldPoints(contour((x, y) => x * y, createViewport({ width: 400, height: 300, cx: 0.013, cy: 0.017, scale: 40 })));
  assert.ok(pts.length > 20);
  for (const [x, y] of pts) assert.ok(Math.min(Math.abs(x), Math.abs(y)) < 0.02);
});

test('keep() clips segments', () => {
  const lines = contour((x, y) => x * x + y * y - 4, vp, { keep: (x, y) => y > 0 });
  for (const [, y] of worldPoints(lines)) assert.ok(y > -0.1);
});

test('regionRects covers the region and nothing else', () => {
  const rects = regionRects((x, y) => x * x + y * y < 4, vp, { cell: 5 });
  let area = 0;
  for (const [, , w, h] of rects) area += w * h;
  const expected = Math.PI * 4 * 40 * 40; // px²
  assert.ok(Math.abs(area - expected) / expected < 0.03, `${area} vs ${expected}`);
});

test('snapToCurve moves a nearby point onto the curve', () => {
  const [x, y] = snapToCurve((a, b) => a * a + b * b - 4, 1.5, 1.5);
  assert.ok(Math.abs(Math.hypot(x, y) - 2) < 1e-9);
});

test('RK4 solves dy/dx = y and dy/dx = x accurately', () => {
  const p = rk4Path((x, y) => y, 0, 1, 1, { steps: 100 });
  assert.ok(Math.abs(p.y[p.y.length - 1] - Math.E) < 1e-8);
  const s = solutionThrough((x) => x, 0, 0, -2, 2, { steps: 200 });
  assert.ok(s.x[0] <= -2 + 1e-9 && s.x[s.x.length - 1] >= 2 - 1e-9);
  for (let i = 1; i < s.x.length; i++) assert.ok(s.x[i] > s.x[i - 1], 'increasing x');
  for (let i = 0; i < s.x.length; i++) assert.ok(Math.abs(s.y[i] - s.x[i] ** 2 / 2) < 1e-9);
});

test('RK4 stops at a vertical tangent instead of oscillating', () => {
  // dy/dx = −x/y: circles, with vertical tangents at y = 0.
  const p = rk4Path((x, y) => -x / y, 0, 2, 3, { steps: 600, maxJump: 0.05 });
  const last = p.x.length - 1;
  assert.ok(p.x[last] < 2.01 && p.x[last] > 1.9, `stopped near x = 2 (at ${p.x[last]})`);
  for (let i = 0; i <= last; i++) assert.ok(Math.abs(Math.hypot(p.x[i], p.y[i]) - 2) < 0.01);
});

test('RK4 stops when the solution leaves the window', () => {
  const p = rk4Path((x, y) => y * y, 0, 1, 2, { steps: 400, yMax: 100 }); // blows up at x = 1
  assert.ok(p.x[p.x.length - 1] < 1);
  assert.ok(p.y[p.y.length - 1] > 100);
});

test('graph rows: implicit curves, inequalities and slope fields', () => {
  const kinds = (texts) => analyse(texts.map((text) => ({ text }))).rows;
  const [c, h, iy, ix, g, chain, s1, s2, s3] = kinds([
    'x^2 + y^2 = 4', 'y = x + sin(y)', 'y > x^2', '1 > x - y^2', 'x^2 + y^2 <= 4', '0 < y < x', "y' = x - y", 'dy/dx = y', 'y = sin(x)',
  ]);
  assert.equal(c.kind, 'implicit');
  assert.equal(c.F(2, 0), 0);
  assert.equal(h.kind, 'implicit');
  assert.deepEqual([iy.kind, iy.form, iy.above, iy.strict], ['inequality', 'y', true, true]);
  assert.equal(iy.f(3), 9);
  // 1 > x - y^2 has no lone x or y: general form.
  assert.equal(ix.form, 'general');
  assert.equal(ix.test(0, 0), true);
  assert.equal(ix.test(5, 0), false);
  assert.deepEqual([g.form, g.edges.length, g.edges[0].strict], ['general', 1, false]);
  assert.equal(chain.test(2, 1), true);
  assert.equal(chain.test(1, 2), false);
  assert.equal(chain.edges.length, 2);
  assert.equal(chain.testExcept(0, 2, -1), true, 'only y < x is checked');
  assert.equal(s1.kind, 'slope');
  assert.equal(s1.f(3, 1), 2);
  assert.equal(s2.kind, 'slope');
  assert.equal(s3.kind, 'cartesian');

  const flipped = kinds(['x^2 <= y', '3 >= x'])
  assert.deepEqual([flipped[0].form, flipped[0].above, flipped[0].strict], ['y', true, false]);
  assert.deepEqual([flipped[1].form, flipped[1].above, flipped[1].f(0)], ['x', false, 3]);
});
