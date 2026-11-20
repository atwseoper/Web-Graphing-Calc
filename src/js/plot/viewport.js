// Viewport: maps between world (maths) coordinates and screen (CSS pixel) coordinates.
// The x and y axes may have different scales. Pure module – no DOM access.
//
// Each axis is linear or logarithmic (Phase 7a). The view is kept in *axis coordinates*:
// u = x on a linear axis and u = log10(x) on a log axis. cx, cy and the scales are in
// axis coordinates, so on a log axis scaleX is pixels per decade, and panning and
// zooming (which work in axis coordinates) become multiplicative in x. Values ≤ 0 have
// no place on a log axis: they map to NaN, which every drawing path treats as "not
// drawn".

export const MIN_SCALE = 1e-7; // px per unit
export const MAX_SCALE = 1e9;
// On a log axis the scale is px per decade. The limits keep 10^u finite and well away
// from underflow: at most a few hundred decades on screen, centred within ±300.
export const MIN_LOG_SCALE = 2;
export const MAX_LOG_SCALE = 1e12;
export const LOG_LIMIT = 300;

export function createViewport({
  width = 300, height = 300, cx = 0, cy = 0, scale = 40, scaleX, scaleY, logX = false, logY = false,
} = {}) {
  return { width, height, cx, cy, scaleX: scaleX ?? scale, scaleY: scaleY ?? scale, logX: !!logX, logY: !!logY };
}

// ---- axis coordinates ------------------------------------------------------------

const log10 = (v) => (v > 0 ? Math.log10(v) : NaN);

export function axisX(vp, x) {
  return vp.logX ? log10(x) : x;
}
export function axisY(vp, y) {
  return vp.logY ? log10(y) : y;
}
export function fromAxisX(vp, u) {
  return vp.logX ? 10 ** u : u;
}
export function fromAxisY(vp, v) {
  return vp.logY ? 10 ** v : v;
}

export function screenX(vp, x) {
  return vp.width / 2 + (axisX(vp, x) - vp.cx) * vp.scaleX;
}
export function screenY(vp, y) {
  return vp.height / 2 - (axisY(vp, y) - vp.cy) * vp.scaleY;
}

export function toScreen(vp, x, y) {
  return [screenX(vp, x), screenY(vp, y)];
}

export function toWorld(vp, sx, sy) {
  return [
    fromAxisX(vp, vp.cx + (sx - vp.width / 2) / vp.scaleX),
    fromAxisY(vp, vp.cy - (sy - vp.height / 2) / vp.scaleY),
  ];
}

// The visible range in world coordinates (always xMin < xMax and yMin < yMax).
export function worldBounds(vp) {
  const [xMin, yMax] = toWorld(vp, 0, 0);
  const [xMax, yMin] = toWorld(vp, vp.width, vp.height);
  return { xMin, xMax, yMin, yMax };
}

// The visible range of one axis in axis coordinates: [lo, hi].
export function axisRange(vp, axis) {
  if (axis === 'x') return [vp.cx - vp.width / 2 / vp.scaleX, vp.cx + vp.width / 2 / vp.scaleX];
  return [vp.cy - vp.height / 2 / vp.scaleY, vp.cy + vp.height / 2 / vp.scaleY];
}

// Pixels per world unit at x (or y): constant on a linear axis, scale / (x ln 10) on a
// log one. Used for tolerances that should be "about a pixel" wherever they are.
export function pxPerUnitX(vp, x) {
  return vp.logX ? vp.scaleX / (Math.abs(x) * Math.LN10) : vp.scaleX;
}
export function pxPerUnitY(vp, y) {
  return vp.logY ? vp.scaleY / (Math.abs(y) * Math.LN10) : vp.scaleY;
}

// dy/dx = f(x, y) rewritten in axis coordinates, dv/du = f · (dx/du) / (dy/dv), so that
// solution curves can be integrated in evenly spaced steps across the screen. On
// log-log axes it is (x / y) · f / 1 – the slope as it appears on the graph.
export function slopeInAxes(vp, f) {
  if (!vp.logX && !vp.logY) return f;
  return (u, v) => {
    const x = fromAxisX(vp, u);
    const y = fromAxisY(vp, v);
    const m = f(x, y);
    const dx = vp.logX ? x * Math.LN10 : 1;
    const dy = vp.logY ? y * Math.LN10 : 1;
    return (m * dx) / dy;
  };
}

// ---- moving the view -------------------------------------------------------------

function clampScaleFor(log, s) {
  return log ? Math.min(MAX_LOG_SCALE, Math.max(MIN_LOG_SCALE, s)) : Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}
function clampCentre(log, c) {
  return log ? Math.min(LOG_LIMIT, Math.max(-LOG_LIMIT, c)) : c;
}
function settle(vp) {
  return { ...vp, cx: clampCentre(vp.logX, vp.cx), cy: clampCentre(vp.logY, vp.cy) };
}

// Zoom by `fx` (and `fy`, default the same) keeping the point under (sx, sy) fixed.
export function zoomAt(vp, sx, sy, fx, fy = fx) {
  const ux = vp.cx + (sx - vp.width / 2) / vp.scaleX;
  const uy = vp.cy - (sy - vp.height / 2) / vp.scaleY;
  const scaleX = clampScaleFor(vp.logX, vp.scaleX * fx);
  const scaleY = clampScaleFor(vp.logY, vp.scaleY * fy);
  return settle({
    ...vp,
    scaleX,
    scaleY,
    cx: ux - (sx - vp.width / 2) / scaleX,
    cy: uy + (sy - vp.height / 2) / scaleY,
  });
}

// Pan by a screen-space delta (dragging content right moves the view left).
export function panBy(vp, dx, dy) {
  return settle({ ...vp, cx: vp.cx - dx / vp.scaleX, cy: vp.cy + dy / vp.scaleY });
}

// Place world point (wx, wy) at screen point (sx, sy), keeping scales.
export function anchor(vp, wx, wy, sx, sy) {
  const ux = axisX(vp, wx);
  const uy = axisY(vp, wy);
  return settle({
    ...vp,
    cx: Number.isFinite(ux) ? ux - (sx - vp.width / 2) / vp.scaleX : vp.cx,
    cy: Number.isFinite(uy) ? uy + (sy - vp.height / 2) / vp.scaleY : vp.cy,
  });
}

// The same view on a canvas of a new size. A width change (rotation, side panel)
// keeps the centre; a height-only change (bottom sheet moved) keeps the top edge.
export function resizeViewport(vp, width, height) {
  if (vp.width === width && vp.height === height) return vp;
  if (vp.width !== width) return { ...vp, width, height };
  const uy = vp.cy - (0 - vp.height / 2) / vp.scaleY; // axis coordinate at the top edge
  return { ...vp, width, height, cy: uy + (0 - height / 2) / vp.scaleY };
}

// Home on a log axis: centred on 10, four decades across the canvas (0.1 to 1000).
const LOG_HOME_CENTRE = 1;
const LOG_HOME_DECADES = 4;

// The default view for a given size: origin centred, equal scales, about ±6 units on the
// short side. A log axis shows 0.1 to 1000 instead.
export function homeViewport(width, height, { logX = false, logY = false } = {}) {
  const scale = Math.min(80, Math.max(20, Math.min(width, height) / 12));
  return createViewport({
    width, height, logX, logY,
    cx: logX ? LOG_HOME_CENTRE : 0,
    cy: logY ? LOG_HOME_CENTRE : 0,
    scaleX: logX ? width / LOG_HOME_DECADES : scale,
    scaleY: logY ? height / LOG_HOME_DECADES : scale,
  });
}

// Centre and scale (axis coordinates) that show world values lo…hi across `size` px with
// a margin of `pad` (a fraction of the size) at each end. On a log axis values ≤ 0 are
// out of reach: a range reaching them shows three decades below its top. Returns
// { c, scale } or null when nothing of the range can be shown.
export function axisFit(log, lo, hi, size, pad = 0) {
  let a = lo;
  let b = hi;
  if (log) {
    if (!(b > 0)) return null;
    if (!(a > 0)) a = b / 1000;
    a = Math.log10(a);
    b = Math.log10(b);
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const c = clampCentre(log, (a + b) / 2);
  const span = Math.abs(b - a);
  const usable = size * (1 - 2 * pad);
  if (!(span > 1e-12)) return { c, scale: null };
  return { c, scale: clampScaleFor(log, usable / span) };
}

// Switch either axis between linear and log, keeping as much of the visible range as
// makes sense: the same world range where it can be shown, otherwise the home range.
export function setAxes(vp, logX, logY) {
  let next = { ...vp };
  const home = homeViewport(vp.width, vp.height, { logX, logY });
  const { xMin, xMax, yMin, yMax } = worldBounds(vp);
  if (!!logX !== vp.logX) {
    const f = axisFit(logX, xMin, xMax, vp.width);
    next = f && f.scale ? { ...next, logX: !!logX, cx: f.c, scaleX: f.scale } : { ...next, logX: !!logX, cx: home.cx, scaleX: home.scaleX };
  }
  if (!!logY !== vp.logY) {
    const f = axisFit(logY, yMin, yMax, vp.height);
    next = f && f.scale ? { ...next, logY: !!logY, cy: f.c, scaleY: f.scale } : { ...next, logY: !!logY, cy: home.cy, scaleY: home.scaleY };
  }
  return next;
}

// ---- ticks -----------------------------------------------------------------------

// Smallest "nice" step (1, 2 or 5 × 10^n) that is at least `minStep`.
export function niceStep(minStep) {
  if (!(minStep > 0) || !Number.isFinite(minStep)) throw new RangeError('minStep must be a positive finite number');
  const exp = Math.floor(Math.log10(minStep));
  const base = 10 ** exp;
  for (const m of [1, 2, 5, 10]) {
    if (m * base >= minStep * (1 - 1e-12)) return m * base;
  }
  return 10 * base;
}

// Minor grid step for a major step: 2 -> 0.5, 1 -> 0.2, 5 -> 1.
export function minorStep(major) {
  const mantissa = Math.round(major / 10 ** Math.floor(Math.log10(major) + 1e-12));
  return major / (mantissa === 2 ? 4 : 5);
}

// Tick positions in [min, max] for the given step, snapped to multiples of step.
export function ticks(min, max, step, limit = 2000) {
  const out = [];
  const first = Math.ceil(min / step);
  const last = Math.floor(max / step);
  if (last - first > limit) return out;
  for (let i = first; i <= last; i++) out.push(i * step);
  return out;
}

// Format a tick value without floating-point noise (e.g. 0.30000000000000004 -> "0.3").
export function formatTick(value, step) {
  if (Math.abs(value) < step * 1e-9) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e6 || abs < 1e-4) {
    // Decimals in the mantissa: as many as the step's leading digit sits below the
    // value's (1.2e6 with step 2e5 needs one: 1.2e6, not 1e6).
    const digits = Math.max(0, Math.min(6, Math.floor(Math.log10(abs) + 1e-12) - Math.floor(Math.log10(step) + 1e-12)));
    return value.toExponential(digits).replace('e+', 'e').replaceAll('-', '−');
  }
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-12));
  return value.toFixed(decimals).replaceAll('-', '−');
}

export const MIN_MAJOR_PX = 80; // target minimum spacing between labelled grid lines

const SUPERSCRIPT = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export function powerOfTen(n) {
  return `10${String(n).split('').map((c) => SUPERSCRIPT[c]).join('')}`;
}

// The label for m × 10^n on a log axis: plain decimals near 1, powers of ten otherwise.
export function logLabel(m, n, pow) {
  if (pow) return m === 1 ? powerOfTen(n) : `${m}×${powerOfTen(n)}`;
  return Number(`${m}e${n}`).toFixed(Math.max(0, -n));
}

// Grid lines and labels for a log axis showing axis coordinates u0…u1 (decades) at
// `ppd` pixels per decade. Returns { major, minor, labels } with world values.
//   ppd ≥ 1500   less than a third of a decade on screen: linear-style steps
//   ≥ 250        labelled lines at 1, 2 and 5 in each decade, minor lines at 1…9
//   ≥ 60         labelled lines at each power of ten, minor lines at 2…9
//   below        labelled lines every 1, 2, 5, 10… decades, minor lines at the others
export function logTicks(u0, u1, ppd) {
  const major = [];
  const minor = [];
  const labels = [];
  if (!(u1 > u0) || !Number.isFinite(u0) || !Number.isFinite(u1)) return { major, minor, labels };
  if (ppd >= 1500) {
    const lo = 10 ** u0;
    const hi = 10 ** u1;
    const step = niceStep(MIN_MAJOR_PX / (ppd / (hi * Math.LN10)));
    for (const v of ticks(lo, hi, step)) {
      if (v <= 0) continue;
      major.push(v);
      labels.push(formatTick(v, step));
    }
    for (const v of ticks(lo, hi, minorStep(step))) if (v > 0) minor.push(v);
    return { major, minor, labels };
  }
  const pow = u0 < -3 || u1 > 5;
  const n0 = Math.floor(u0);
  const n1 = Math.ceil(u1);
  const inView = (v) => {
    const u = Math.log10(v);
    return u >= u0 - 1e-12 && u <= u1 + 1e-12;
  };
  if (ppd >= 60) {
    const labelled = ppd >= 250 ? [1, 2, 5] : [1];
    for (let n = n0; n <= n1; n++) {
      for (let m = 1; m <= 9; m++) {
        const v = Number(`${m}e${n}`);
        if (!inView(v)) continue;
        if (labelled.includes(m)) {
          major.push(v);
          labels.push(logLabel(m, n, pow));
        } else {
          minor.push(v);
        }
      }
    }
    return { major, minor, labels };
  }
  // Wide ranges: a labelled line every k decades.
  const k = Math.max(1, Math.round(niceStep(MIN_MAJOR_PX / ppd)));
  for (let n = Math.ceil(u0); n <= Math.floor(u1); n++) {
    const v = 10 ** n;
    if (n % k === 0) {
      major.push(v);
      labels.push(logLabel(1, n, pow || k > 1));
    } else if (ppd >= 6) {
      minor.push(v);
    }
  }
  if (ppd >= 40) {
    for (let n = n0; n <= n1; n++) {
      for (let m = 2; m <= 9; m++) {
        const v = Number(`${m}e${n}`);
        if (inView(v)) minor.push(v);
      }
    }
  }
  return { major, minor, labels };
}

// Grid lines and labels for one axis of the view, in world values: { major, minor,
// labels, step }. On a linear axis step is the major step and 0 has an empty label
// (the origin gets its own); on a log axis step is null.
export function axisTicks(vp, axis) {
  const log = axis === 'x' ? vp.logX : vp.logY;
  const scale = axis === 'x' ? vp.scaleX : vp.scaleY;
  const [a0, a1] = axisRange(vp, axis);
  if (log) return { ...logTicks(a0, a1, scale), step: null };
  const step = niceStep(MIN_MAJOR_PX / scale);
  const major = ticks(a0, a1, step);
  return {
    major,
    minor: ticks(a0, a1, minorStep(step)),
    labels: major.map((v) => (Math.abs(v) < step * 1e-9 ? '' : formatTick(v, step))),
    step,
  };
}
