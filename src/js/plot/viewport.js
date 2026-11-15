// Viewport: maps between world (maths) coordinates and screen (CSS pixel) coordinates.
// Pure module – no DOM access – so it can be unit-tested in Node.

export function createViewport({ width = 300, height = 300, cx = 0, cy = 0, scale = 40 } = {}) {
  // scale = CSS pixels per world unit (equal on both axes for now).
  return { width, height, cx, cy, scale };
}

export function toScreen(vp, x, y) {
  return [vp.width / 2 + (x - vp.cx) * vp.scale, vp.height / 2 - (y - vp.cy) * vp.scale];
}

export function toWorld(vp, sx, sy) {
  return [vp.cx + (sx - vp.width / 2) / vp.scale, vp.cy - (sy - vp.height / 2) / vp.scale];
}

export function worldBounds(vp) {
  const [xMin, yMax] = toWorld(vp, 0, 0);
  const [xMax, yMin] = toWorld(vp, vp.width, vp.height);
  return { xMin, xMax, yMin, yMax };
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

// Tick positions in [min, max] for the given step, snapped to multiples of step.
export function ticks(min, max, step) {
  const out = [];
  const first = Math.ceil(min / step);
  const last = Math.floor(max / step);
  for (let i = first; i <= last; i++) out.push(i * step);
  return out;
}

// Format a tick value without floating-point noise (e.g. 0.30000000000000004 -> "0.3").
export function formatTick(value, step) {
  if (Math.abs(value) < step * 1e-9) return '0';
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const abs = Math.abs(value);
  if (abs >= 1e6 || abs < 1e-4) return value.toExponential(Math.max(0, decimals > 0 ? 1 : 0)).replace('e+', 'e');
  return value.toFixed(decimals);
}
