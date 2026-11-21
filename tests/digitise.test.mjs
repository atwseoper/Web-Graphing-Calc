// Photo digitiser (Phase 8): calibration and the image → graph mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calibrate, toWorld, toImage, resolution, roundToResolution, digitisedPoints, gridLines, invert3,
  emptyRefs, REFS, nameFromImage,
} from '../src/js/data/digitise.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const near = (p, x, y, tol) => close(p.x, x, tol) && close(p.y, y, tol);

// A synthetic photo of a graph: world (x, y) -> image pixel, through any transform.
function scene(world2img) {
  const at = (x, y) => world2img(x, y);
  return {
    at,
    axisRef: (x, y, value) => ({ ...pix(at(x, y)), value }),
    pointRef: (x, y) => ({ ...pix(at(x, y)), x, y }),
  };
}
const pix = ([px, py]) => ({ px, py });

// Plain screenshot: 50 px per unit, origin at (100, 400), y up.
const plain = scene((x, y) => [100 + 50 * x, 400 - 50 * y]);

// Rotated by 7° and sheared a little, as a scanned page might be.
const rot = (deg) => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return (x, y) => {
    const a = 40 * x + 3 * y;
    const b = -35 * y;
    return [300 + c * a - s * b, 500 + s * a + c * b];
  };
};
const skewed = scene(rot(7));

// A photo at an angle: a true perspective transform of the plane.
const P = [[42, -9, 610], [6, -30, 820], [0.02, 0.004, 1]];
const persp = scene((x, y) => {
  const w = P[2][0] * x + P[2][1] * y + P[2][2];
  return [(P[0][0] * x + P[0][1] * y + P[0][2]) / w, (P[1][0] * x + P[1][1] * y + P[1][2]) / w];
});

test('axes: a plain screenshot maps exactly, and the reference points need not be at 0', () => {
  const r = calibrate({
    method: 'axes',
    refs: { x1: plain.axisRef(1, 0, 1), x2: plain.axisRef(9, 0, 9), y1: plain.axisRef(0, -2, -2), y2: plain.axisRef(0, 5, 5) },
  });
  assert.ok(r.ok, r.error);
  for (const [x, y] of [[0, 0], [3.3, 4.4], [-1, -7], [12, 0.25]]) {
    assert.ok(near(toWorld(r.map, ...plain.at(x, y)), x, y), `${x}, ${y}`);
  }
});

test('axes: references on axis lines that don’t pass through 0, in a rotated, skewed image', () => {
  // The x-axis line is y = 2 and the y-axis line is x = −1 (a graph whose axes start there).
  const r = calibrate({
    method: 'axes',
    refs: { x1: skewed.axisRef(0, 2, 0), x2: skewed.axisRef(10, 2, 10), y1: skewed.axisRef(-1, 3, 3), y2: skewed.axisRef(-1, 8, 8) },
  });
  assert.ok(r.ok, r.error);
  for (const [x, y] of [[0, 0], [5, 5], [7.5, -3], [-4, 11]]) {
    assert.ok(near(toWorld(r.map, ...skewed.at(x, y)), x, y, 1e-9), `${x}, ${y}`);
  }
});

test('axes: log and semi-log axes', () => {
  // The image shows u = log₁₀ x and v = log₁₀ y linearly.
  const img = (x, y) => plain.at(Math.log10(x), Math.log10(y));
  const ref = (x, y, value) => ({ ...pix(img(x, y)), value });
  const r = calibrate({
    method: 'axes', xLog: true, yLog: true,
    refs: { x1: ref(1, 1, 1), x2: ref(1000, 1, 1000), y1: ref(1, 0.1, 0.1), y2: ref(1, 100, 100) },
  });
  assert.ok(r.ok, r.error);
  for (const [x, y] of [[2, 3], [50, 0.04], [0.5, 700]]) assert.ok(near(toWorld(r.map, ...img(x, y)), x, y, 1e-9));
  // Semi-log: y linear.
  const img2 = (x, y) => plain.at(Math.log10(x), y);
  const r2 = calibrate({
    method: 'axes', xLog: true,
    refs: { x1: { ...pix(img2(1, 0)), value: 1 }, x2: { ...pix(img2(100, 0)), value: 100 }, y1: { ...pix(img2(1, 0)), value: 0 }, y2: { ...pix(img2(1, 6)), value: 6 } },
  });
  assert.ok(r2.ok, r2.error);
  assert.ok(near(toWorld(r2.map, ...img2(30, 2.5)), 30, 2.5, 1e-9));
  // A log axis value must be above 0.
  const bad = calibrate({ method: 'axes', xLog: true, refs: { ...r2Refs(img2), x1: { ...pix(img2(1, 0)), value: 0 } } });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /log axis/);
  assert.deepEqual(bad.refs, ['x1']);
});
function r2Refs(img2) {
  return { x1: { ...pix(img2(1, 0)), value: 1 }, x2: { ...pix(img2(100, 0)), value: 100 }, y1: { ...pix(img2(1, 0)), value: 0 }, y2: { ...pix(img2(1, 6)), value: 6 } };
}

test('axes: clear messages for missing, coincident or parallel references', () => {
  const good = { x1: plain.axisRef(0, 0, 0), x2: plain.axisRef(5, 0, 5), y1: plain.axisRef(0, 0, 0), y2: plain.axisRef(0, 5, 5) };
  const run = (refs) => calibrate({ method: 'axes', refs: { ...good, ...refs } });
  let r = run({ x2: null });
  assert.equal(r.ok, false); assert.match(r.error, /Place x₂/); assert.deepEqual(r.refs, ['x2']);
  r = run({ y1: { ...good.y1, value: null } });
  assert.match(r.error, /Type a value for y₁/);
  r = run({ x2: { ...good.x1 } });
  assert.match(r.error, /same place/);
  r = run({ x2: { ...good.x2, value: 0 } });
  assert.match(r.error, /different values/);
  // y points placed along the x axis.
  r = run({ y1: plain.axisRef(1, 0, 0), y2: plain.axisRef(3, 0, 5) });
  assert.match(r.error, /same line/);
  assert.equal(calibrate({ method: 'nope', refs: {} }).ok, false);
});

test('known length: a ruler at any angle, with square pixels', () => {
  // A ruler photographed at 30°: 20 px per cm. The origin is the ruler's 0 mark.
  const a = Math.PI / 6;
  const at = (x, y) => [200 + 20 * (x * Math.cos(a) + y * Math.sin(a)), 300 + 20 * (x * Math.sin(a) - y * Math.cos(a))];
  const r = calibrate({ method: 'length', refs: { o: { ...pix(at(0, 0)), x: null, y: null }, p: pix(at(15, 0)), length: 15 } });
  assert.ok(r.ok, r.error);
  for (const [x, y] of [[3, 4], [-2, 7], [10, -1]]) assert.ok(near(toWorld(r.map, ...at(x, y)), x, y, 1e-9));
  // With the origin given other values, everything shifts.
  const r2 = calibrate({ method: 'length', refs: { o: { ...pix(at(0, 0)), x: 100, y: -5 }, p: pix(at(15, 0)), length: 15 } });
  assert.ok(near(toWorld(r2.map, ...at(3, 4)), 103, -1, 1e-9));
  // Log settings are ignored: lengths are linear.
  const r3 = calibrate({ method: 'length', xLog: true, yLog: true, refs: { o: pix(at(0, 0)), p: pix(at(15, 0)), length: 15 } });
  assert.equal(r3.map.xLog, false);
  assert.match(calibrate({ method: 'length', refs: { o: pix(at(0, 0)), p: pix(at(15, 0)), length: 0 } }).error, /length/);
  assert.match(calibrate({ method: 'length', refs: { o: pix(at(0, 0)), p: pix(at(0, 0)), length: 3 } }).error, /same place/);
});

test('four points: a photo at an angle is undone exactly', () => {
  const refs = { p1: persp.pointRef(0, 0), p2: persp.pointRef(10, 0), p3: persp.pointRef(10, 10), p4: persp.pointRef(0, 10) };
  const r = calibrate({ method: 'four', refs });
  assert.ok(r.ok, r.error);
  for (const [x, y] of [[5, 5], [2.5, 7.5], [-3, 12], [9.9, 0.1]]) assert.ok(near(toWorld(r.map, ...persp.at(x, y)), x, y, 1e-8), `${x}, ${y}`);
  // toImage is the inverse.
  const back = toImage(r.map, 4, 6);
  const [px, py] = persp.at(4, 6);
  assert.ok(close(back.px, px, 1e-8) && close(back.py, py, 1e-8));
  // Points in any order, as long as each has its own values.
  const r2 = calibrate({ method: 'four', refs: { p1: refs.p3, p2: refs.p1, p3: refs.p4, p4: refs.p2 } });
  assert.ok(r2.ok);
  assert.ok(near(toWorld(r2.map, ...persp.at(1, 2)), 1, 2, 1e-8));
});

test('four points: works with big and tiny values and on log axes', () => {
  // Grid crossings of a photographed log-log graph: values 10 to 10⁵ and 10⁻⁶ to 10⁻².
  const at = (x, y) => persp.at(Math.log10(x), Math.log10(y) + 6);
  const ref = (x, y) => ({ ...pix(at(x, y)), x, y });
  const r = calibrate({ method: 'four', xLog: true, yLog: true, refs: { p1: ref(10, 1e-6), p2: ref(1e5, 1e-6), p3: ref(1e5, 1e-2), p4: ref(10, 1e-2) } });
  assert.ok(r.ok, r.error);
  assert.ok(near(toWorld(r.map, ...at(300, 2e-4)), 300, 2e-4, 1e-8));
  // Large linear values.
  const big = scene((x, y) => persp.at(x / 1e6, y / 1e6));
  const rb = calibrate({ method: 'four', refs: { p1: big.pointRef(0, 0), p2: big.pointRef(1e7, 0), p3: big.pointRef(1e7, 1e7), p4: big.pointRef(0, 1e7) } });
  assert.ok(rb.ok, rb.error);
  assert.ok(near(toWorld(rb.map, ...big.at(2.5e6, 4e6)), 2.5e6, 4e6, 1e-8));
});

test('four points: three in a line, repeated values or swapped values are caught', () => {
  const refs = { p1: persp.pointRef(0, 0), p2: persp.pointRef(10, 0), p3: persp.pointRef(10, 10), p4: persp.pointRef(0, 10) };
  let r = calibrate({ method: 'four', refs: { ...refs, p3: persp.pointRef(5, 0) } });
  assert.equal(r.ok, false); assert.match(r.error, /in a line on the photo/);
  r = calibrate({ method: 'four', refs: { ...refs, p3: { ...refs.p3, x: 5, y: 0 } } });
  assert.match(r.error, /values .* in a line/);
  r = calibrate({ method: 'four', refs: { ...refs, p3: { ...refs.p3, x: 0, y: 0 } } });
  assert.match(r.error, /same values/);
  // p1 and p2 given each other's values: the mapping would fold the photo over.
  r = calibrate({ method: 'four', refs: { ...refs, p1: { ...refs.p1, x: 10 }, p2: { ...refs.p2, x: 0 } } });
  assert.equal(r.ok, false); assert.match(r.error, /swapped/);
  r = calibrate({ method: 'four', refs: { ...refs, p4: { ...refs.p4, y: 'x' } } });
  assert.match(r.error, /P₄’s y/);
});

test('emptyRefs and REFS agree', () => {
  for (const m of Object.keys(REFS)) assert.deepEqual(Object.keys(emptyRefs(m)), REFS[m]);
});

test('invert3 inverts, and refuses a singular matrix', () => {
  const M = [[2, 1, 0], [0, 3, 1], [1, 0, 4]];
  const I = invert3(M);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const v = M[i][0] * I[0][j] + M[i][1] * I[1][j] + M[i][2] * I[2][j];
      assert.ok(close(v, i === j ? 1 : 0, 1e-12));
    }
  }
  assert.equal(invert3([[1, 2, 3], [2, 4, 6], [0, 0, 1]]), null);
});

test('points beyond the horizon of a photo at an angle map to null', () => {
  const r = calibrate({ method: 'four', refs: { p1: persp.pointRef(0, 0), p2: persp.pointRef(10, 0), p3: persp.pointRef(10, 10), p4: persp.pointRef(0, 10) } });
  // w = 0.02x + 0.004y + 1 vanishes at x = −50: the horizon. Image points past it are null.
  const horizonSide = [];
  for (let px = -3000; px <= 3000; px += 250) {
    for (let py = -3000; py <= 3000; py += 250) {
      const w = toWorld(r.map, px, py);
      if (!w) horizonSide.push([px, py]);
      else assert.ok(0.02 * w.x + 0.004 * w.y + 1 > 0);
    }
  }
  assert.ok(horizonSide.length > 0);
});

test('resolution and rounding to one more digit than a pixel resolves', () => {
  const r = calibrate({
    method: 'axes',
    refs: { x1: plain.axisRef(0, 0, 0), x2: plain.axisRef(10, 0, 10), y1: plain.axisRef(0, 0, 0), y2: plain.axisRef(0, 5, 5) },
  });
  const res = resolution(r.map, 300, 200);
  assert.ok(close(res.x, 0.02) && close(res.y, 0.02));
  assert.equal(roundToResolution(3.14159, 0.02), 3.142);
  assert.equal(roundToResolution(0.1 + 0.2, 0.013), 0.3);
  assert.equal(roundToResolution(123456.7, 130), 123460);
  assert.equal(roundToResolution(-0.0004, 0.02), 0);
  assert.ok(Object.is(roundToResolution(-0.0004, 0.02), 0));
  assert.equal(roundToResolution(5, NaN), 5);
  // digitisedPoints rounds each point and sorts by x.
  const pts = digitisedPoints(r.map, [{ px: 300.4, py: 200 }, { px: 120, py: 390.2 }]);
  assert.deepEqual(pts, [{ x: 0.4, y: 0.196 }, { x: 4.008, y: 4 }]);
});

test('log axes: rounding follows the local size of a pixel', () => {
  const img = (x, y) => plain.at(Math.log10(x), Math.log10(y));
  const ref = (x, y, value) => ({ ...pix(img(x, y)), value });
  const r = calibrate({
    method: 'axes', xLog: true, yLog: true,
    refs: { x1: ref(1, 1, 1), x2: ref(1000, 1, 1000), y1: ref(1, 1, 1), y2: ref(1, 100, 100) },
  });
  const [p] = digitisedPoints(r.map, [pix(img(123.456, 0.0123456))]);
  // 50 px per decade: a pixel is about 4.7% of the value, so 3 significant figures.
  assert.deepEqual(p, { x: 123.5, y: 0.01235 });
});

test('gridLines draws the calibrated grid across the photo', () => {
  const r = calibrate({
    method: 'axes',
    refs: { x1: plain.axisRef(0, 0, 0), x2: plain.axisRef(10, 0, 10), y1: plain.axisRef(0, 0, 0), y2: plain.axisRef(0, 5, 5) },
  });
  // 800 × 600 px shows x from −2 to 14 and y from −4 to 8.
  const lines = gridLines(r.map, 800, 600);
  const xs = lines.filter((l) => l.axis === 'x').map((l) => l.value);
  const ys = lines.filter((l) => l.axis === 'y').map((l) => l.value);
  assert.deepEqual(xs, [-2, 0, 2, 4, 6, 8, 10, 12, 14]);
  assert.deepEqual(ys, [-4, -2, 0, 2, 4, 6, 8]);
  const zero = lines.find((l) => l.axis === 'x' && l.value === 0);
  assert.equal(zero.label, '0');
  for (const [px] of zero.points) assert.ok(close(px, 100));
  // Log axes: lines at 1, 2, 5 × 10ⁿ.
  const img = (x, y) => plain.at(Math.log10(x), y);
  const rl = calibrate({
    method: 'axes', xLog: true,
    refs: { x1: { ...pix(img(1, 0)), value: 1 }, x2: { ...pix(img(10, 0)), value: 10 }, y1: { ...pix(img(1, 0)), value: 0 }, y2: { ...pix(img(1, 5)), value: 5 } },
  });
  // 300 px at 50 px per decade: six decades, one line each.
  const lx = gridLines(rl.map, 300, 600).filter((l) => l.axis === 'x');
  assert.deepEqual(lx.map((l) => l.label), ['0.01', '0.1', '1', '10', '100', '1000', '10000']);
  // 150 px per decade over 360 px: under three decades, so 1, 2 and 5 in each.
  const rn = calibrate({
    method: 'axes', xLog: true,
    refs: { x1: { px: 100, py: 400, value: 1 }, x2: { px: 250, py: 400, value: 10 }, y1: { px: 100, py: 400, value: 0 }, y2: { px: 100, py: 150, value: 5 } },
  });
  const ln = gridLines(rn.map, 360, 600).filter((l) => l.axis === 'x');
  assert.deepEqual(ln.map((l) => l.label), ['0.5', '1', '2', '5', '10', '20', '50']);
});

test('gridLines on a perspective photo stops at the horizon', () => {
  const r = calibrate({ method: 'four', refs: { p1: persp.pointRef(0, 0), p2: persp.pointRef(10, 0), p3: persp.pointRef(10, 10), p4: persp.pointRef(0, 10) } });
  const lines = gridLines(r.map, 1500, 1500);
  assert.ok(lines.length > 4);
  for (const l of lines) for (const [px, py] of l.points) assert.ok(toWorld(r.map, px, py));
});

test('nameFromImage', () => {
  assert.equal(nameFromImage('IMG_2041.JPG'), 'IMG_2041');
  assert.equal(nameFromImage('C:\\Users\\me\\Pictures\\cooling curve.png'), 'cooling curve');
  assert.equal(nameFromImage('Pasted image'), 'Pasted image');
  assert.equal(nameFromImage(''), '');
  assert.equal(nameFromImage('x'.repeat(60) + '.webp').length, 40);
});
