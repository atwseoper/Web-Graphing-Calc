// Log and log-log axes (Phase 7a): the viewport mapping, ticks, sampling and framing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createViewport, toScreen, toWorld, worldBounds, zoomAt, panBy, anchor, homeViewport, resizeViewport,
  axisX, axisY, axisRange, pxPerUnitX, pxPerUnitY, slopeInAxes, setAxes, axisFit, logTicks, axisTicks,
  logLabel, powerOfTen, LOG_LIMIT, MIN_LOG_SCALE,
} from '../src/js/plot/viewport.js';
import { sampleCartesian, sampleCartesianX, sampleXRange } from '../src/js/plot/sample.js';
import { dataBounds } from '../src/js/data/table.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// 400 × 300 px, x from 0.1 to 1000 (100 px per decade), y from 0.1 to 100 (100 px per decade).
const loglog = createViewport({ width: 400, height: 300, cx: 1, cy: 0.5, scaleX: 100, scaleY: 100, logX: true, logY: true });

test('a log axis maps decades to equal distances, and values ≤ 0 to NaN', () => {
  assert.deepEqual(toScreen(loglog, 10, 10).map((v) => +v.toFixed(9)), [200, 100]);
  assert.ok(close(toScreen(loglog, 100, 1)[0] - toScreen(loglog, 10, 1)[0], 100));
  assert.ok(close(toScreen(loglog, 2, 1)[0] - toScreen(loglog, 1, 1)[0], 100 * Math.log10(2)));
  const [nx, ny] = toScreen(loglog, 0, -3);
  assert.ok(Number.isNaN(nx) && Number.isNaN(ny));
  assert.ok(Number.isNaN(axisX(loglog, -1)) && Number.isNaN(axisY(loglog, 0)));
});

test('toScreen and toWorld are inverses on log and semi-log axes', () => {
  for (const v of [loglog, { ...loglog, logY: false, cy: 3, scaleY: 20 }, { ...loglog, logX: false, cx: -2, scaleX: 15 }]) {
    for (const [x, y] of [[0.5, 3], [7, 40], [123.4, 0.25]]) {
      if (!v.logX && x <= 0) continue;
      const [sx, sy] = toScreen(v, x, y);
      const [wx, wy] = toWorld(v, sx, sy);
      assert.ok(close(wx, x) && close(wy, y), `${x}, ${y}`);
    }
  }
});

test('worldBounds and axisRange on log axes', () => {
  const b = worldBounds(loglog);
  assert.ok(close(b.xMin, 0.1) && close(b.xMax, 1000) && close(b.yMin, 0.1) && close(b.yMax, 100));
  assert.deepEqual(axisRange(loglog, 'x'), [-1, 3]);
  assert.deepEqual(axisRange(loglog, 'y'), [-1, 2]);
});

test('zoom and pan are multiplicative on a log axis', () => {
  // Zooming in ×2 about the centre (x = 10) halves the decades shown: 1 to 100.
  const z = zoomAt(loglog, 200, 150, 2);
  const b = worldBounds(z);
  assert.ok(close(b.xMin, 1) && close(b.xMax, 100));
  // The point under the cursor stays put.
  const p = [120, 70];
  const before = toWorld(loglog, ...p);
  const after = toWorld(zoomAt(loglog, ...p, 3), ...p);
  assert.ok(close(before[0], after[0]) && close(before[1], after[1]));
  // Dragging one decade to the right divides every x by 10.
  const q = panBy(loglog, 100, 0);
  assert.ok(close(worldBounds(q).xMin, 0.01) && close(worldBounds(q).xMax, 100));
  // anchor puts a world value at a pixel.
  const a = anchor(loglog, 50, 2, 10, 20);
  const back = toScreen(a, 50, 2);
  assert.ok(close(back[0], 10) && close(back[1], 20));
});

test('log views stay within reach of floating point', () => {
  const far = panBy(loglog, -1e9, 1e9);
  assert.ok(far.cx <= LOG_LIMIT && far.cy >= -LOG_LIMIT);
  const out = zoomAt(loglog, 200, 150, 1e-9);
  assert.equal(out.scaleX, MIN_LOG_SCALE);
  const b = worldBounds(out);
  assert.ok(Number.isFinite(b.xMax) && b.xMin > 0);
});

test('resizeViewport keeps the top edge of a log y axis', () => {
  const r = resizeViewport(loglog, 400, 500);
  assert.ok(close(toWorld(r, 0, 0)[1], toWorld(loglog, 0, 0)[1]));
});

test('home view: 0.1 to 1000 on a log axis, as before on a linear one', () => {
  const h = homeViewport(400, 300, { logX: true });
  const b = worldBounds(h);
  assert.ok(close(b.xMin, 0.1) && close(b.xMax, 1000));
  assert.equal(h.logX, true);
  assert.equal(h.logY, false);
  assert.equal(h.cy, 0);
  assert.equal(h.scaleY, homeViewport(400, 300).scaleY);
});

test('pixels per unit vary across a log axis', () => {
  assert.ok(close(pxPerUnitX(loglog, 1), 100 / Math.LN10));
  assert.ok(close(pxPerUnitX(loglog, 10), 10 / Math.LN10));
  assert.equal(pxPerUnitY({ ...loglog, logY: false, scaleY: 33 }, 5), 33);
});

test('slopes in axis coordinates: d(log y)/d(log x) = (x / y) · f on log-log', () => {
  const f = (x, y) => x + y;
  const g = slopeInAxes(loglog, f);
  const u = Math.log10(4);
  const v = Math.log10(2);
  assert.ok(close(g(u, v), (4 / 2) * 6));
  // Semi-log y: dv/dx = f / (y ln 10).
  const semi = { ...loglog, logX: false };
  assert.ok(close(slopeInAxes(semi, f)(3, v), 5 / (2 * Math.LN10)));
  // Linear axes: unchanged.
  assert.equal(slopeInAxes(createViewport(), f), f);
  // y = x² is a straight line of slope 2 on log-log axes.
  assert.ok(close(slopeInAxes(loglog, (x) => 2 * x)(0.7, 1.4), 2));
});

test('switching axes keeps the visible range where it can', () => {
  const lin = createViewport({ width: 400, height: 300, cx: 50, cy: 0, scaleX: 4, scaleY: 30 }); // x from 0 to 100
  const s = setAxes(lin, true, false);
  assert.equal(s.logX, true);
  const b = worldBounds(s);
  // x from 0: three decades below the top.
  assert.ok(close(b.xMax, 100) && close(b.xMin, 0.1));
  assert.equal(s.cy, 0);
  // Back to linear: the log range, linearly.
  const back = worldBounds(setAxes(s, false, false));
  assert.ok(close(back.xMin, 0.1) && close(back.xMax, 100));
  // A y range entirely ≤ 0 can't be shown on a log axis: the home range instead.
  const neg = createViewport({ width: 400, height: 300, cx: 0, cy: -10, scaleX: 40, scaleY: 40 });
  const h = setAxes(neg, false, true);
  assert.equal(h.cy, homeViewport(400, 300, { logY: true }).cy);
});

test('axisFit: margins, log ranges reaching 0, nothing to show', () => {
  assert.deepEqual(axisFit(false, 0, 10, 100, 0), { c: 5, scale: 10 });
  const f = axisFit(true, 1, 1000, 300, 0);
  assert.ok(close(f.c, 1.5) && close(f.scale, 100));
  const g = axisFit(true, -5, 100, 300, 0);
  assert.ok(close(g.c, 0.5)); // 0.1 to 100
  assert.equal(axisFit(true, -5, -1, 300), null);
  assert.equal(axisFit(true, 10, 10, 300).scale, null);
});

test('log ticks: powers of ten, then 1-2-5, then linear steps as you zoom in', () => {
  // 100 px per decade: labelled powers of ten, minor lines at 2…9.
  const a = logTicks(-1, 3, 100);
  assert.deepEqual(a.major, [0.1, 1, 10, 100, 1000]);
  assert.deepEqual(a.labels, ['0.1', '1', '10', '100', '1000']);
  assert.equal(a.minor.length, 8 * 4);
  assert.ok(a.minor.includes(20) && a.minor.includes(0.9));
  // 400 px per decade: 1, 2 and 5 labelled.
  const b = logTicks(0, 1, 400);
  assert.deepEqual(b.major, [1, 2, 5, 10]);
  assert.deepEqual(b.minor, [3, 4, 6, 7, 8, 9]);
  // Far in (≥ 1500 px per decade): evenly spaced steps, like a linear axis.
  const c = logTicks(Math.log10(2), Math.log10(2.5), 3000);
  assert.ok(c.major.length >= 2);
  const steps = c.major.slice(1).map((v, i) => +(v - c.major[i]).toFixed(12));
  assert.ok(steps.every((d) => d === steps[0]));
  assert.ok(c.major.every((v) => v >= 2 && v <= 2.5));
  // Far out: a labelled line every few decades, in powers of ten.
  const d = logTicks(-20, 40, 8);
  assert.deepEqual(d.major.map((v) => Math.round(Math.log10(v))), [-20, -10, 0, 10, 20, 30, 40]); // every 80 px
  assert.ok(d.labels.every((l) => l.startsWith('10')));
  assert.ok(d.major.every((v, i) => i === 0 || close(Math.log10(v) - Math.log10(d.major[i - 1]), Math.log10(d.major[1] / d.major[0]))));
});

test('log labels: decimals near 1, powers of ten over wide ranges', () => {
  assert.equal(powerOfTen(6), '10⁶');
  assert.equal(powerOfTen(-12), '10⁻¹²');
  assert.equal(logLabel(1, -3, false), '0.001');
  assert.equal(logLabel(5, 2, false), '500');
  assert.equal(logLabel(2, 7, true), '2×10⁷');
  const wide = logTicks(0, 8, 50);
  assert.ok(wide.labels.includes('10⁴'));
  assert.ok(!wide.labels.includes('10000'));
});

test('axisTicks: linear axes as before, log axes from logTicks', () => {
  const lin = axisTicks(createViewport({ width: 400, height: 300, scale: 40 }), 'x');
  assert.equal(lin.step, 2);
  assert.ok(lin.major.includes(0) && lin.labels[lin.major.indexOf(0)] === '');
  assert.equal(lin.labels[lin.major.indexOf(4)], '4');
  const lg = axisTicks(loglog, 'y');
  assert.equal(lg.step, null);
  assert.deepEqual(lg.major, [0.1, 1, 10, 100]);
});

test('y = f(x) is sampled evenly in log x on a log axis', () => {
  const v = createViewport({ width: 600, height: 300, cx: 0, cy: 0, scaleX: 50, scaleY: 30, logX: true }); // 10^-6 to 10^6
  const lines = sampleCartesian((x) => Math.log10(x), v);
  assert.equal(lines.length, 1);
  const ts = lines[0].t;
  // Every decade gets points, and the t values are x values.
  for (let n = -5; n < 5; n++) assert.ok(ts.some((t) => t >= 10 ** n && t < 10 ** (n + 1)), `decade ${n}`);
  // log10(x) is a straight line on a semi-log x axis.
  const { x, y } = lines[0];
  const m = (y[y.length - 1] - y[0]) / (x[x.length - 1] - x[0]);
  for (let i = 0; i < x.length; i += 20) assert.ok(Math.abs(y[0] + m * (x[i] - x[0]) - y[i]) < 0.5);
});

test('curves leave a log y axis where they reach 0 or below', () => {
  const v = createViewport({ width: 400, height: 300, cx: 0, cy: 0, scaleX: 40, scaleY: 50, logY: true });
  const lines = sampleCartesian((x) => x, v); // undefined for x ≤ 0
  assert.ok(lines.length >= 1);
  assert.ok(lines.every((l) => l.t.every((t) => t > 0)));
  const xs = sampleCartesianX((y) => Math.log10(y), v);
  assert.ok(xs.length >= 1 && xs[0].t.every((t) => t > 0));
  // A range on a log x axis that starts at 0 can't be sampled from there.
  assert.deepEqual(sampleXRange((x) => x, -1, 5, { ...v, logX: true }), []);
});

test('dataBounds on log axes counts only positive values', () => {
  const set = {
    hidden: false, hasSigma: true,
    points: [{ x: -1, y: 5, s: 0 }, { x: 2, y: 0.5, s: 1 }, { x: 10, y: 30, s: 2 }, { x: 4, y: -3, s: 0 }],
  };
  assert.deepEqual(dataBounds([set]), { xMin: -1, xMax: 10, yMin: -3, yMax: 32 });
  assert.deepEqual(dataBounds([set], { positiveX: true }), { xMin: 2, xMax: 10, yMin: -3, yMax: 32 });
  assert.deepEqual(dataBounds([set], { positiveX: true, positiveY: true }), { xMin: 2, xMax: 10, yMin: 0.5, yMax: 32 });
});
