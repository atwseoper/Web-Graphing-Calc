// Photo digitiser (Phase 8): the mapping from image pixels to graph values. Pure module –
// no DOM access.
//
// Image coordinates are pixels of the loaded image, x to the right and y downwards.
// Every calibration becomes one projective mapping (a 3 × 3 homography H) from image
// pixels to axis coordinates (u, v), where u = x on a linear axis and u = log₁₀ x on a
// log axis (likewise v and y). Affine mappings (the "axes" and "known length" methods)
// are the special case whose last row is [0, 0, 1].
//
//   calibrate(cal) -> { ok: true, map } | { ok: false, error, refs }
//
// cal = { method, xLog, yLog, refs }, where refs depends on the method:
//   'axes'    { x1, x2, y1, y2 }  each { px, py, value }: two points on each axis line
//   'length'  { o, p, length }    o = { px, py, x, y } (its values default to 0),
//                                 p = { px, py } a known length from o along +x
//   'four'    { p1, p2, p3, p4 }  each { px, py, x, y }
// A missing point is null or has no px; a missing value is null or NaN. refs in a failed
// result names the reference points the message is about, so they can be highlighted.
//
//   toWorld(map, px, py)   -> { x, y } or null (beyond the photo's horizon, or off a log axis)
//   toImage(map, x, y)     -> { px, py } or null
//   resolution(map, px, py) -> { x, y }: how much x and y change across one image pixel
//   roundToResolution(value, size) rounds to one more digit than a pixel resolves
//   digitisedPoints(map, pts) -> [{ x, y }]: rounded values, sorted by x
//   gridLines(map, width, height) -> [{ axis, value, label, points }]: lines of the
//                          calibrated grid in image coordinates, to check a calibration by eye
import { solveLinearSystem } from '../numerics/linalg.js';
import { niceStep, ticks, formatTick } from '../plot/viewport.js';

export const METHODS = ['axes', 'length', 'four'];
export const METHOD_NAMES = { axes: 'Axes', length: 'Known length', four: '4 points' };

// Reference points of each method, in the order they are placed.
export const REFS = {
  axes: ['x1', 'x2', 'y1', 'y2'],
  length: ['o', 'p'],
  four: ['p1', 'p2', 'p3', 'p4'],
};

export const REF_LABELS = {
  x1: 'x₁', x2: 'x₂', y1: 'y₁', y2: 'y₂', o: 'Origin', p: 'End', p1: 'P₁', p2: 'P₂', p3: 'P₃', p4: 'P₄',
};

const MIN_SEPARATION = 3; // image pixels between reference points
const MIN_SINE = 0.05; // axes closer than ~3° to parallel can't be told apart
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const placed = (r) => !!r && finite(r.px) && finite(r.py);

export function emptyRefs(method) {
  return Object.fromEntries(REFS[method].map((k) => [k, null]));
}

// ---- 3 × 3 matrices --------------------------------------------------------------------

function mul3(A, B) {
  return A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
}

function apply3(H, a, b) {
  return [
    H[0][0] * a + H[0][1] * b + H[0][2],
    H[1][0] * a + H[1][1] * b + H[1][2],
    H[2][0] * a + H[2][1] * b + H[2][2],
  ];
}

export function invert3(M) {
  const [[a, b, c], [d, e, f], [g, h, i]] = M;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!finite(det) || det === 0) return null;
  const k = 1 / det;
  return [
    [A * k, -(b * i - c * h) * k, (b * f - c * e) * k],
    [B * k, (a * i - c * g) * k, -(a * f - c * d) * k],
    [C * k, -(a * h - b * g) * k, (a * e - b * d) * k],
  ];
}

// ---- axis coordinates ----------------------------------------------------------------

const toAxis = (value, log) => (log ? (value > 0 ? Math.log10(value) : NaN) : value);
const fromAxis = (u, log) => (log ? 10 ** u : u);

// A value typed for a reference point: a message if it can't be used, else null.
function valueProblem(value, log, name) {
  if (!finite(value)) return `Type a value for ${name}.`;
  if (log && !(value > 0)) return `${name} is on a log axis, so it must be above 0.`;
  return null;
}

const fail = (error, ...refs) => ({ ok: false, error, refs });

function makeMap(H, xLog, yLog, refPoints) {
  const inv = invert3(H);
  if (!inv || H.flat().some((v) => !finite(v))) return fail('These points don’t give a usable mapping. Check where they are and their values.');
  // Which side of the horizon the photo is on: the sign of w at the reference points.
  const sign = Math.sign(apply3(H, refPoints[0][0], refPoints[0][1])[2]) || 1;
  return { ok: true, map: { H, inv, sign, xLog: !!xLog, yLog: !!yLog } };
}

// ---- calibration -------------------------------------------------------------------------

export function calibrate(cal) {
  const method = cal && METHODS.includes(cal.method) ? cal.method : null;
  if (!method) return fail('Choose how to calibrate.');
  const refs = cal.refs || {};
  for (const k of REFS[method]) {
    if (!placed(refs[k])) return fail(`Place ${REF_LABELS[k]} on the photo.`, k);
  }
  if (method === 'axes') return calibrateAxes(refs, !!cal.xLog, !!cal.yLog);
  if (method === 'length') return calibrateLength(refs);
  return calibrateFour(refs, !!cal.xLog, !!cal.yLog);
}

function tooClose(a, b) {
  return Math.hypot(a.px - b.px, a.py - b.py) < MIN_SEPARATION;
}

// Two points on each axis. The x value of a point is read along the x axis, moving
// parallel to the y axis (and vice versa), so a rotated or skewed image works and the
// axes needn't cross at a reference point.
function calibrateAxes({ x1, x2, y1, y2 }, xLog, yLog) {
  for (const [k, r, log] of [['x1', x1, xLog], ['x2', x2, xLog], ['y1', y1, yLog], ['y2', y2, yLog]]) {
    const msg = valueProblem(r.value, log, REF_LABELS[k]);
    if (msg) return fail(msg, k);
  }
  if (tooClose(x1, x2)) return fail('x₁ and x₂ are in the same place. Put them far apart on the x axis.', 'x1', 'x2');
  if (tooClose(y1, y2)) return fail('y₁ and y₂ are in the same place. Put them far apart on the y axis.', 'y1', 'y2');
  const u1 = toAxis(x1.value, xLog);
  const u2 = toAxis(x2.value, xLog);
  const v1 = toAxis(y1.value, yLog);
  const v2 = toAxis(y2.value, yLog);
  if (u1 === u2) return fail('x₁ and x₂ need different values.', 'x1', 'x2');
  if (v1 === v2) return fail('y₁ and y₂ need different values.', 'y1', 'y2');
  const ex = [x2.px - x1.px, x2.py - x1.py];
  const ey = [y2.px - y1.px, y2.py - y1.py];
  const det = ex[0] * ey[1] - ex[1] * ey[0];
  if (Math.abs(det) < MIN_SINE * Math.hypot(...ex) * Math.hypot(...ey)) {
    return fail('The x-axis and y-axis points are along the same line. Put x₁ and x₂ on the x axis, and y₁ and y₂ on the y axis.', 'x1', 'x2', 'y1', 'y2');
  }
  // Linear part L with L·ex = (u2 − u1, 0) and L·ey = (0, v2 − v1): L = D · [ex ey]⁻¹.
  const du = u2 - u1;
  const dv = v2 - v1;
  const inv = [[ey[1] / det, -ey[0] / det], [-ex[1] / det, ex[0] / det]];
  const Lu = [du * inv[0][0], du * inv[0][1]];
  const Lv = [dv * inv[1][0], dv * inv[1][1]];
  const H = [
    [Lu[0], Lu[1], u1 - Lu[0] * x1.px - Lu[1] * x1.py],
    [Lv[0], Lv[1], v1 - Lv[0] * y1.px - Lv[1] * y1.py],
    [0, 0, 1],
  ];
  return makeMap(H, xLog, yLog, [[x1.px, x1.py]]);
}

// A ruler: an origin and a point a known length along the +x direction. Square pixels,
// so the same scale applies across; +y is a quarter turn anticlockwise from +x, as seen.
// Always linear: a length in the photo has no meaning on a log axis.
function calibrateLength({ o, p, length }) {
  if (!finite(length) || !(length > 0)) return fail('Type the length from the origin to the end, above 0.', 'o', 'p');
  const x0 = finite(o.x) ? o.x : 0;
  const y0 = finite(o.y) ? o.y : 0;
  if (o.x !== null && o.x !== undefined && !finite(o.x)) return fail('The origin’s x value isn’t a number.', 'o');
  if (o.y !== null && o.y !== undefined && !finite(o.y)) return fail('The origin’s y value isn’t a number.', 'o');
  if (tooClose(o, p)) return fail('The origin and the end are in the same place. Put them a known length apart.', 'o', 'p');
  const dx = p.px - o.px;
  const dy = p.py - o.py;
  const s = length / Math.hypot(dx, dy); // units per pixel
  const ex = [dx * s / Math.hypot(dx, dy), dy * s / Math.hypot(dx, dy)]; // unit direction × scale
  // x = x0 + (P − O)·e·s;  y = y0 + (P − O)·(e rotated to point up on screen)·s, with y down.
  const H = [
    [ex[0], ex[1], x0 - ex[0] * o.px - ex[1] * o.py],
    [ex[1], -ex[0], y0 - ex[1] * o.px + ex[0] * o.py],
    [0, 0, 1],
  ];
  return makeMap(H, false, false, [[o.px, o.py]]);
}

// Twice the signed area of the triangle a, b, c.
const area2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

// The first set of three points that are (nearly) in a line, or null.
function collinear(pts) {
  const scale = Math.max(...pts.flatMap((p) => pts.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))));
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      for (let k = j + 1; k < 4; k++) {
        if (Math.abs(area2(pts[i], pts[j], pts[k])) < 1e-3 * scale * scale) return [i, j, k];
      }
    }
  }
  return null;
}

// Similarity transform that centres points and scales their mean distance to √2, for a
// well-conditioned solve.
function normaliser(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const d = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / pts.length;
  const k = Math.SQRT2 / d;
  return { T: [[k, 0, -k * cx], [0, k, -k * cy], [0, 0, 1]], Tinv: [[1 / k, 0, cx], [0, 1 / k, cy], [0, 0, 1]] };
}

// Four points with known values: a perspective mapping (homography), for photos taken at
// an angle. Solved as an 8 × 8 linear system (h₃₃ = 1) on normalised coordinates.
function calibrateFour(refs, xLog, yLog) {
  const keys = REFS.four;
  const img = [];
  const world = [];
  for (const k of keys) {
    const r = refs[k];
    const mx = valueProblem(r.x, xLog, `${REF_LABELS[k]}’s x`);
    if (mx) return fail(mx, k);
    const my = valueProblem(r.y, yLog, `${REF_LABELS[k]}’s y`);
    if (my) return fail(my, k);
    img.push([r.px, r.py]);
    world.push([toAxis(r.x, xLog), toAxis(r.y, yLog)]);
  }
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (Math.hypot(img[i][0] - img[j][0], img[i][1] - img[j][1]) < MIN_SEPARATION) {
        return fail(`${REF_LABELS[keys[i]]} and ${REF_LABELS[keys[j]]} are in the same place.`, keys[i], keys[j]);
      }
      if (world[i][0] === world[j][0] && world[i][1] === world[j][1]) {
        return fail(`${REF_LABELS[keys[i]]} and ${REF_LABELS[keys[j]]} have the same values.`, keys[i], keys[j]);
      }
    }
  }
  const ci = collinear(img);
  if (ci) return fail(`${ci.map((i) => REF_LABELS[keys[i]]).join(', ')} are in a line on the photo. Use four points that make a four-sided shape, such as the corners of a rectangle.`, ...ci.map((i) => keys[i]));
  const cw = collinear(world);
  if (cw) return fail(`The values of ${cw.map((i) => REF_LABELS[keys[i]]).join(', ')} are in a line. Use four points that make a four-sided shape, such as the corners of a rectangle.`, ...cw.map((i) => keys[i]));

  const ni = normaliser(img);
  const nw = normaliser(world);
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = apply3(ni.T, img[i][0], img[i][1]);
    const [u, v] = apply3(nw.T, world[i][0], world[i][1]);
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const sol = solveLinearSystem(A, b);
  if (sol.status !== 'unique' || sol.nearlySingular) {
    return fail('These four points don’t give a usable mapping. Check where they are and their values.', ...keys);
  }
  const h = sol.x;
  const Hn = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  const H = mul3(nw.Tinv, mul3(Hn, ni.T));
  // A real photo keeps all four points on the same side of the horizon. If not, two
  // points are swapped: their values don't match the order they appear in.
  const ws = img.map(([x, y]) => apply3(H, x, y)[2]);
  if (!(ws.every((w) => w > 0) || ws.every((w) => w < 0))) {
    return fail('The values don’t match where the points are: two of them may be swapped. Check each point’s x and y.', ...keys);
  }
  return makeMap(H, xLog, yLog, img);
}

// ---- using a mapping ---------------------------------------------------------------------

function axisAt(map, px, py) {
  const [U, V, W] = apply3(map.H, px, py);
  if (!(W * map.sign > 0)) return null;
  return [U / W, V / W];
}

export function toWorld(map, px, py) {
  const a = axisAt(map, px, py);
  if (!a) return null;
  const x = fromAxis(a[0], map.xLog);
  const y = fromAxis(a[1], map.yLog);
  return finite(x) && finite(y) ? { x, y } : null;
}

function imageAt(map, u, v) {
  const [X, Y, W] = apply3(map.inv, u, v);
  if (!finite(W) || W === 0) return null;
  const px = X / W;
  const py = Y / W;
  // Points behind the camera map back to the wrong side of the horizon.
  if (!(apply3(map.H, px, py)[2] * map.sign > 0)) return null;
  return finite(px) && finite(py) ? { px, py } : null;
}

export function toImage(map, x, y) {
  const u = toAxis(x, map.xLog);
  const v = toAxis(y, map.yLog);
  if (!finite(u) || !finite(v)) return null;
  return imageAt(map, u, v);
}

export function resolution(map, px, py) {
  const c = toWorld(map, px, py);
  const r = toWorld(map, px + 1, py);
  const d = toWorld(map, px, py + 1);
  if (!c || !r || !d) return { x: NaN, y: NaN };
  return {
    x: Math.max(Math.abs(r.x - c.x), Math.abs(d.x - c.x)),
    y: Math.max(Math.abs(r.y - c.y), Math.abs(d.y - c.y)),
  };
}

// Round to the decimal place one below the first significant digit of `size`: a pixel
// worth 0.013 gives three decimals (0.001). Values are returned without float noise.
export function roundToResolution(value, size) {
  if (!finite(value) || !finite(size) || !(size > 0)) return value;
  const e = Math.floor(Math.log10(size)) - 1;
  if (e >= 0) {
    const step = 10 ** e;
    return Math.round(value / step) * step;
  }
  const r = Number(value.toFixed(Math.min(100, -e)));
  return Object.is(r, -0) ? 0 : r;
}

// pts: [{ px, py }] -> [{ x, y }], each rounded to its own pixel's resolution, sorted by x
// (then y). Points that can't be mapped are left out.
export function digitisedPoints(map, pts) {
  const out = [];
  for (const p of pts) {
    const w = toWorld(map, p.px, p.py);
    if (!w) continue;
    const res = resolution(map, p.px, p.py);
    out.push({ x: roundToResolution(w.x, res.x), y: roundToResolution(w.y, res.y) });
  }
  return out.sort((a, b) => a.x - b.x || a.y - b.y);
}

// ---- grid for checking a calibration ----------------------------------------------------

const MAX_LINES = 40;
const SAMPLES = 32;

// Values for grid lines across [lo, hi] in axis coordinates (u, or log₁₀ of the value).
function gridValues(lo, hi, log) {
  if (!(hi > lo)) return [];
  if (log) {
    const decades = hi - lo;
    const mantissas = decades <= 3 ? [1, 2, 5] : [1];
    const every = decades > MAX_LINES ? Math.ceil(decades / MAX_LINES) : 1;
    const out = [];
    for (let n = Math.floor(lo); n <= Math.ceil(hi); n++) {
      if (n % every) continue;
      for (const m of mantissas) {
        const u = n + Math.log10(m);
        if (u >= lo && u <= hi) out.push({ u, value: m * 10 ** n });
      }
    }
    if (out.length >= 2) return out;
  }
  const a = fromAxis(lo, log);
  const b = fromAxis(hi, log);
  const step = niceStep((b - a) / 8);
  return ticks(a, b, step, MAX_LINES).map((value) => ({ u: toAxis(value, log), value, step }));
}

// A grid line's label: steps on a linear axis, or the value's own decade on a log axis.
function label(value, step) {
  return formatTick(value, step || 10 ** Math.floor(Math.log10(value) + 1e-9));
}

export function gridLines(map, width, height) {
  // The range of axis coordinates the photo covers, from points around its edge.
  let uLo = Infinity; let uHi = -Infinity; let vLo = Infinity; let vHi = -Infinity;
  const edge = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    edge.push([t * width, 0], [t * width, height], [0, t * height], [width, t * height]);
  }
  for (const [px, py] of edge) {
    const a = axisAt(map, px, py);
    if (!a || !finite(a[0]) || !finite(a[1])) continue;
    uLo = Math.min(uLo, a[0]); uHi = Math.max(uHi, a[0]);
    vLo = Math.min(vLo, a[1]); vHi = Math.max(vHi, a[1]);
  }
  if (!(uHi > uLo) || !(vHi > vLo)) return [];
  const lines = [];
  const trace = (fixed, isX, lo, hi) => {
    const parts = [];
    let run = [];
    for (let i = 0; i <= SAMPLES * 2; i++) {
      const t = lo + ((hi - lo) * i) / (SAMPLES * 2);
      const p = isX ? imageAt(map, fixed, t) : imageAt(map, t, fixed);
      if (p) run.push([p.px, p.py]);
      else if (run.length) { if (run.length > 1) parts.push(run); run = []; }
    }
    if (run.length > 1) parts.push(run);
    return parts;
  };
  for (const g of gridValues(uLo, uHi, map.xLog)) {
    for (const points of trace(g.u, true, vLo, vHi)) lines.push({ axis: 'x', value: g.value, label: label(g.value, g.step), points });
  }
  for (const g of gridValues(vLo, vHi, map.yLog)) {
    for (const points of trace(g.u, false, uLo, uHi)) lines.push({ axis: 'y', value: g.value, label: label(g.value, g.step), points });
  }
  return lines;
}
