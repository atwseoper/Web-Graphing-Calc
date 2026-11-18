// Viewport: maps between world (maths) coordinates and screen (CSS pixel) coordinates.
// The x and y axes may have different scales. Pure module – no DOM access.

export const MIN_SCALE = 1e-7; // px per unit
export const MAX_SCALE = 1e9;

export function createViewport({ width = 300, height = 300, cx = 0, cy = 0, scale = 40, scaleX, scaleY } = {}) {
  return { width, height, cx, cy, scaleX: scaleX ?? scale, scaleY: scaleY ?? scale };
}

export function toScreen(vp, x, y) {
  return [vp.width / 2 + (x - vp.cx) * vp.scaleX, vp.height / 2 - (y - vp.cy) * vp.scaleY];
}

export function toWorld(vp, sx, sy) {
  return [vp.cx + (sx - vp.width / 2) / vp.scaleX, vp.cy - (sy - vp.height / 2) / vp.scaleY];
}

export function worldBounds(vp) {
  const [xMin, yMax] = toWorld(vp, 0, 0);
  const [xMax, yMin] = toWorld(vp, vp.width, vp.height);
  return { xMin, xMax, yMin, yMax };
}

function clampScale(s) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

// Zoom by `fx` (and `fy`, default the same) keeping the world point under (sx, sy) fixed.
export function zoomAt(vp, sx, sy, fx, fy = fx) {
  const [wx, wy] = toWorld(vp, sx, sy);
  const scaleX = clampScale(vp.scaleX * fx);
  const scaleY = clampScale(vp.scaleY * fy);
  return {
    ...vp,
    scaleX,
    scaleY,
    cx: wx - (sx - vp.width / 2) / scaleX,
    cy: wy + (sy - vp.height / 2) / scaleY,
  };
}

// Pan by a screen-space delta (dragging content right moves the view left).
export function panBy(vp, dx, dy) {
  return { ...vp, cx: vp.cx - dx / vp.scaleX, cy: vp.cy + dy / vp.scaleY };
}

// Place world point (wx, wy) at screen point (sx, sy), keeping scales.
export function anchor(vp, wx, wy, sx, sy) {
  return { ...vp, cx: wx - (sx - vp.width / 2) / vp.scaleX, cy: wy + (sy - vp.height / 2) / vp.scaleY };
}

// The default view for a given size: origin centred, equal scales, about ±6 units on the short side.
export function homeViewport(width, height) {
  const scale = Math.min(80, Math.max(20, Math.min(width, height) / 12));
  return createViewport({ width, height, cx: 0, cy: 0, scale });
}

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
