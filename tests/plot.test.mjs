import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createViewport, toScreen, toWorld, worldBounds, zoomAt, panBy, anchor, homeViewport,
  niceStep, minorStep, ticks, formatTick,
} from '../src/js/plot/viewport.js';
import {
  sampleCurve, sampleCartesian, sampleCartesianX, sampleParametric, samplePolar, nearestOnLines,
} from '../src/js/plot/sample.js';
import { gridSteps } from '../src/js/plot/grid.js';

const vp = createViewport({ width: 400, height: 300, cx: 0, cy: 0, scale: 40 });

// ---- viewport --------------------------------------------------------------------

test('toScreen and toWorld are inverses, with separate x and y scales', () => {
  const v = createViewport({ width: 400, height: 300, cx: 1.5, cy: -2, scaleX: 37, scaleY: 12 });
  for (const [x, y] of [[0, 0], [1.5, -2], [-10, 7.25], [3e3, -4e-3]]) {
    const [sx, sy] = toScreen(v, x, y);
    const [wx, wy] = toWorld(v, sx, sy);
    assert.ok(Math.abs(wx - x) < 1e-9 && Math.abs(wy - y) < 1e-9);
  }
});

test('worldBounds and home view', () => {
  assert.deepEqual(worldBounds(createViewport({ width: 200, height: 100, scale: 10 })), { xMin: -10, xMax: 10, yMin: -5, yMax: 5 });
  const h = homeViewport(390, 420);
  assert.equal(h.scaleX, h.scaleY);
  assert.equal(h.cx, 0);
});

test('zoomAt keeps the point under the cursor fixed', () => {
  const z = zoomAt(vp, 100, 50, 2.5);
  assert.deepEqual(toWorld(z, 100, 50).map((v) => +v.toFixed(9)), toWorld(vp, 100, 50).map((v) => +v.toFixed(9)));
  assert.equal(z.scaleX, 100);
  const zy = zoomAt(vp, 200, 150, 1, 2);
  assert.equal(zy.scaleX, 40);
  assert.equal(zy.scaleY, 80);
});

test('panBy and anchor', () => {
  const p = panBy(vp, 40, -40); // drag right and up by one unit
  assert.deepEqual([p.cx, p.cy], [-1, -1]);
  const a = anchor(vp, 3, 4, 200, 150);
  assert.deepEqual([a.cx, a.cy], [3, 4]);
});

test('niceStep, minorStep, ticks, formatTick', () => {
  const cases = [[0.7, 1], [1, 1], [1.01, 2], [2.5, 5], [6, 10], [0.013, 0.02], [420, 500], [9e-7, 1e-6]];
  for (const [input, expected] of cases) assert.ok(Math.abs(niceStep(input) - expected) < expected * 1e-12, `niceStep(${input})`);
  assert.throws(() => niceStep(0), RangeError);
  assert.equal(minorStep(2), 0.5);
  assert.equal(minorStep(1), 0.2);
  assert.equal(minorStep(5), 1);
  assert.equal(minorStep(20), 5);
  assert.deepEqual(ticks(-2.5, 2.5, 1), [-2, -1, 0, 1, 2]);
  assert.equal(formatTick(0.1 + 0.2, 0.1), '0.3');
  assert.equal(formatTick(-4, 2), '−4');
  assert.equal(formatTick(2000000, 1000000), '2e6');
  assert.equal(formatTick(-0.00002, 0.00001), '−2e−5');
  const g = gridSteps(createViewport({ scaleX: 40, scaleY: 4 }));
  assert.equal(g.majorX, 2);
  assert.equal(g.majorY, 20);
});

// ---- sampling --------------------------------------------------------------------

const total = (lines) => lines.reduce((n, l) => n + l.x.length, 0);

test('a straight line needs few points and is one polyline', () => {
  const lines = sampleCartesian((x) => 2 * x + 1, vp);
  assert.equal(lines.length, 1);
  assert.ok(total(lines) < 600);
  // every point lies on the line
  for (let i = 0; i < lines[0].x.length; i++) {
    const [x, y] = toWorld(vp, lines[0].x[i], lines[0].y[i]);
    assert.ok(Math.abs(y - (2 * x + 1)) < 1e-9);
  }
});

test('tan(x) is broken at its asymptotes (no false vertical lines)', () => {
  const lines = sampleCartesian(Math.tan, vp); // x in [-5, 5]: asymptotes at ±π/2, ±3π/2
  assert.equal(lines.length, 5);
  for (const l of lines) {
    for (let i = 1; i < l.x.length; i++) {
      // within a branch tan is increasing, so screen y must decrease (y axis points down)
      assert.ok(l.y[i] < l.y[i - 1] + 1e-9, 'branch is monotonic');
    }
  }
});

test('floor(x) steps are not joined; continuous steep curves are', () => {
  const steps = sampleCartesian(Math.floor, vp);
  assert.equal(steps.length, 12); // x in [-5.05, 5.05] covers floors -6..5
  const cbrt = sampleCartesian(Math.cbrt, createViewport({ width: 400, height: 300, scale: 400 }));
  assert.equal(cbrt.length, 1, 'cube root is continuous through 0');
  const sign = sampleCartesian((x) => 1 / x, vp);
  assert.equal(sign.length, 2);
});

test('domain edges: sqrt(x) starts at x = 0, sqrt(1 - x^2) is one arc', () => {
  const lines = sampleCartesian(Math.sqrt, vp);
  assert.equal(lines.length, 1);
  const [x0] = toWorld(vp, lines[0].x[0], lines[0].y[0]);
  assert.ok(Math.abs(x0) < 0.01, `starts near 0 (got ${x0})`);
  const arc = sampleCartesian((x) => Math.sqrt(1 - x * x), vp);
  assert.equal(arc.length, 1);
  const [a] = toWorld(vp, arc[0].x[0], arc[0].y[0]);
  const [b] = toWorld(vp, arc[0].x.at(-1), arc[0].y.at(-1));
  assert.ok(Math.abs(a + 1) < 0.01 && Math.abs(b - 1) < 0.01);
});

test('undefined everywhere gives nothing', () => {
  assert.deepEqual(sampleCartesian(() => NaN, vp), []);
});

test('x = g(y), parametric circle and polar rose', () => {
  const xg = sampleCartesianX((y) => y * y, vp);
  assert.equal(xg.length, 1);

  const circle = sampleParametric(Math.cos, Math.sin, 0, 2 * Math.PI, vp);
  assert.equal(circle.length, 1);
  const c = circle[0];
  for (let i = 0; i < c.x.length; i++) {
    const [x, y] = toWorld(vp, c.x[i], c.y[i]);
    assert.ok(Math.abs(Math.hypot(x, y) - 1) < 1e-9);
  }
  assert.ok(Math.hypot(c.x[0] - c.x.at(-1), c.y[0] - c.y.at(-1)) < 1e-6, 'closed');

  const rose = samplePolar((th) => 3 * Math.sin(2 * th), 0, 2 * Math.PI, vp);
  assert.equal(rose.length, 1);
  const deg = samplePolar(() => 2, 0, 360, vp, Math.PI / 180);
  const [x, y] = toWorld(vp, deg[0].x.at(-1), deg[0].y.at(-1));
  assert.ok(Math.abs(x - 2) < 1e-9 && Math.abs(y) < 1e-9);
});

test('evaluation budget is respected for pathological curves', () => {
  let calls = 0;
  sampleCartesian((x) => { calls++; return Math.sin(1 / x); }, vp, { budget: 5000 });
  assert.ok(calls < 5600, `calls = ${calls}`);
});

test('sampleCurve emits parameter values for tracing', () => {
  const lines = sampleCurve((t) => [t, t], 0, 10, { initial: 10 });
  assert.equal(lines[0].t[0], 0);
  assert.equal(lines[0].t.at(-1), 10);
});

test('nearestOnLines finds the closest point and interpolates t', () => {
  const lines = [{ x: [0, 100], y: [0, 0], t: [0, 1] }, { x: [0, 100], y: [50, 50], t: [5, 6] }];
  const h = nearestOnLines(lines, 25, 10);
  assert.equal(h.line, 0);
  assert.equal(h.dist, 10);
  assert.equal(h.t, 0.25);
  assert.equal(nearestOnLines([], 0, 0), null);
});

test('formatTick shows enough digits to tell large and small ticks apart', () => {
  assert.deepEqual([1e6, 1.2e6, 1.4e6, 1.6e6, 1.8e6, 2e6].map((v) => formatTick(v, 2e5)),
    ['1.0e6', '1.2e6', '1.4e6', '1.6e6', '1.8e6', '2.0e6']);
  assert.deepEqual([1e6, 1.5e6, 2e6, 2.5e6].map((v) => formatTick(v, 5e5)), ['1.0e6', '1.5e6', '2.0e6', '2.5e6']);
  assert.deepEqual([1.1e7, 1.2e7].map((v) => formatTick(v, 1e6)), ['1.1e7', '1.2e7']);
  assert.deepEqual([1.2e-5, 1.4e-5, 2e-5].map((v) => formatTick(v, 2e-6)), ['1.2e−5', '1.4e−5', '2.0e−5']);
  assert.equal(formatTick(-1.5e6, 5e5), '−1.5e6');
  // Labels on one axis are all different.
  const labels = ticks(1e6, 3e6, 2e5).map((v) => formatTick(v, 2e5));
  assert.equal(new Set(labels).size, labels.length);
});
