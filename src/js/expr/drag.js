// Draggable points (Phase 6a). Pure – no DOM access.
//
// A point row such as (h, k), (a, f(a)) or (a + b, a − b) can be dragged on the graph
// when its coordinates use one or two sliders (rows `a = number`). Dragging changes the
// sliders, so everything that uses them moves with the point.
//
// dragPlan decides from the parsed row how the point is dragged:
//   { kind: 'axis', axis: 0|1, names: [a] }  one coordinate is the slider itself and the
//                                            other doesn't use it: (a, 3), (2, a)
//   { kind: 'path', names: [a] }             both coordinates follow one slider:
//                                            (a, f(a)), (a, 2a), (cos a, sin a). The
//                                            point moves along that path, to the place
//                                            nearest the finger (nearestOnPath)
//   { kind: 'solve', names: [a, b] }         two sliders: (h, k), (a + b, a − b). Both
//                                            are found together by Newton steps
//                                            (solvePair), where that is well conditioned
// or null when the point can't be dragged (no sliders, more than two, or a definition
// the coordinates use also depends on one of them).

import { referencedNames } from './compile.js';

// env: { isSlider(name) -> boolean, dependencies(name) -> Set of names the definition of
// `name` uses (directly or through other definitions), or null if it isn't defined }.
export function dragPlan(expr, env) {
  if (!expr || expr.type !== 'tuple' || expr.items.length !== 2) return null;
  const [ix, iy] = expr.items;
  const rx = referencedNames(ix);
  const ry = referencedNames(iy);
  const names = [...new Set([...rx.names, ...ry.names])].filter((n) => env.isSlider(n));
  if (!names.length || names.length > 2) return null;
  // While dragging, only the coordinates are worked out again with the new slider
  // values, so nothing else they use may depend on those sliders.
  for (const n of new Set([...rx.names, ...ry.names, ...rx.calls, ...ry.calls])) {
    if (names.includes(n)) continue;
    const deps = env.dependencies(n);
    if (deps && names.some((s) => deps.has(s))) return null;
  }
  const inX = names.filter((n) => rx.names.has(n));
  const inY = names.filter((n) => ry.names.has(n));
  const bare = (node, n) => node.type === 'sym' && node.name === n;
  if (names.length === 1) {
    const [s] = names;
    if (bare(ix, s) && !inY.length) return { kind: 'axis', axis: 0, names };
    if (bare(iy, s) && !inX.length) return { kind: 'axis', axis: 1, names };
    return { kind: 'path', names };
  }
  // With one coordinate fixed, two sliders can't both be pinned down.
  if (!inX.length || !inY.length) return null;
  return { kind: 'solve', names };
}

// Squared distance on screen from point(...vals) to target, with scale = [px per unit
// in x, px per unit in y]. Infinity where the point isn't defined.
function screenDist2(p, target, scale) {
  if (!p) return Infinity;
  const dx = (p[0] - target[0]) * scale[0];
  const dy = (p[1] - target[1]) * scale[1];
  const d = dx * dx + dy * dy;
  return Number.isFinite(d) ? d : Infinity;
}

const GOLD = (Math.sqrt(5) - 1) / 2;

// Golden-section search for the smallest f on [a, b].
function minimiseOn(f, a, b, iterations = 50) {
  let c = b - GOLD * (b - a);
  let d = a + GOLD * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let k = 0; k < iterations && b - a > 1e-12 * Math.max(1, Math.abs(a)); k++) {
    if (fc <= fd) {
      b = d; d = c; fd = fc;
      c = b - GOLD * (b - a); fc = f(c);
    } else {
      a = c; c = d; fc = fd;
      d = a + GOLD * (b - a); fd = f(d);
    }
  }
  return fc <= fd ? c : d;
}

// The slider value in [lo, hi] whose point is nearest the target on screen: found by
// sampling the range, then refining. Where the path passes near itself, a place close to
// the current value (`near`) wins over a jump if it is within `stickPx` of the best.
// point(v) -> [x, y] | null. Returns null if the path has no defined points.
export function nearestOnPath(point, lo, hi, target, scale, { near = null, samples = 400, stickPx = 6 } = {}) {
  if (!(hi > lo)) return null;
  const dist = (v) => screenDist2(point(v), target, scale);
  const h = (hi - lo) / samples;
  const ds = new Array(samples + 1);
  let best = -1;
  for (let k = 0; k <= samples; k++) {
    ds[k] = dist(lo + k * h);
    if (ds[k] < Infinity && (best < 0 || ds[k] < ds[best])) best = k;
  }
  if (best < 0) return null;
  const refine = (k) => {
    const v = minimiseOn(dist, lo + Math.max(0, k - 1) * h, lo + Math.min(samples, k + 1) * h);
    return dist(v) <= ds[k] ? v : lo + k * h;
  };
  let v = refine(best);
  if (near !== null && Number.isFinite(near) && near >= lo && near <= hi) {
    // Walk downhill from the current value to the nearest local minimum along the path.
    let k = Math.round((near - lo) / h);
    for (;;) {
      if (k > 0 && ds[k - 1] < ds[k]) k--;
      else if (k < samples && ds[k + 1] < ds[k]) k++;
      else break;
    }
    if (ds[k] < Infinity) {
      const local = refine(k);
      if (Math.sqrt(dist(local)) <= Math.sqrt(dist(v)) + stickPx) v = local;
    }
  }
  return v;
}

// The Jacobian of point(a, b) on screen (rows scaled by px per unit), by central
// differences: [[∂x/∂a, ∂x/∂b], [∂y/∂a, ∂y/∂b]] · scale.
function jacobian(point, a, b, scale) {
  const ha = 1e-6 * Math.max(1, Math.abs(a));
  const hb = 1e-6 * Math.max(1, Math.abs(b));
  const pa1 = point(a + ha, b);
  const pa0 = point(a - ha, b);
  const pb1 = point(a, b + hb);
  const pb0 = point(a, b - hb);
  if (!pa1 || !pa0 || !pb1 || !pb0) return null;
  const J = [
    [((pa1[0] - pa0[0]) / (2 * ha)) * scale[0], ((pb1[0] - pb0[0]) / (2 * hb)) * scale[0]],
    [((pa1[1] - pa0[1]) / (2 * ha)) * scale[1], ((pb1[1] - pb0[1]) / (2 * hb)) * scale[1]],
  ];
  return J.flat().every(Number.isFinite) ? J : null;
}

// Condition number of a 2×2 matrix (ratio of its singular values); Infinity if singular.
function condition2(J) {
  const [[p, q], [r, s]] = J;
  const fro2 = p * p + q * q + r * r + s * s;
  const det = Math.abs(p * s - q * r);
  if (!(det > 0)) return Infinity;
  const disc = Math.sqrt(Math.max(0, fro2 * fro2 - 4 * det * det));
  const smax = Math.sqrt((fro2 + disc) / 2);
  const smin = det / smax;
  return smax / smin;
}

// Points this badly conditioned at their current values don't get a handle.
export const MAX_CONDITION = 1e6;

// How well two sliders pin down the point at (a, b): the condition number of the
// Jacobian on screen (1 is ideal; Infinity where the sliders can't move it freely).
export function pairCondition(point, a, b, scale) {
  const J = jacobian(point, a, b, scale);
  return J ? condition2(J) : Infinity;
}

// Two slider values near `start` that put point(a, b) on the target, by damped Newton
// steps measured on screen. Returns the best values found if they are closer than the
// start, or null if no step helps (the target is out of reach, or the Jacobian is
// singular there).
export function solvePair(point, start, target, scale, { maxIter = 20, tolPx = 0.01 } = {}) {
  let [a, b] = start;
  let d = screenDist2(point(a, b), target, scale);
  if (!Number.isFinite(d)) return null;
  const d0 = d;
  for (let it = 0; it < maxIter && d > tolPx * tolPx; it++) {
    const J = jacobian(point, a, b, scale);
    if (!J || condition2(J) > MAX_CONDITION) break;
    const p = point(a, b);
    const fx = (p[0] - target[0]) * scale[0];
    const fy = (p[1] - target[1]) * scale[1];
    const [[j11, j12], [j21, j22]] = J;
    const det = j11 * j22 - j12 * j21;
    const da = (j22 * fx - j12 * fy) / det;
    const db = (j11 * fy - j21 * fx) / det;
    // Halve the step until it gets closer (or give up).
    let t = 1;
    let moved = false;
    for (let k = 0; k < 30; k++, t /= 2) {
      const na = a - t * da;
      const nb = b - t * db;
      const nd = screenDist2(point(na, nb), target, scale);
      if (nd < d) {
        a = na; b = nb; d = nd; moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  return d < d0 ? [a, b] : null;
}
