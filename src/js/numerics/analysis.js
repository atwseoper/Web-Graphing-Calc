// Graph analysis: extrema and points of interest on y = f(x). Pure module – no DOM access.
//
// findExtrema()       local maxima and minima of f in [a, b]: strict extrema among the
//                     samples are refined as roots of f′ when it changes sign, otherwise
//                     with brentMin. Points next to poles and jumps are rejected.
// pointsOfInterest()  roots, extrema, the y-intercept and intersections with other
//                     curves, in a visible range.
import { brent, sample, findRoots } from './roots.js';
import { brentMin } from './minimise.js';

// Local extrema of f in [a, b]. Options: samples (default 400), df (derivative), grid.
// Returns [{ x, y, kind: 'max' | 'min', iterations }] sorted by x.
export function findExtrema(f, a, b, opts = {}) {
  const n = opts.samples ?? 400;
  const { xs, ys } = opts.grid ?? sample(f, a, b, n);
  const out = [];
  const df = opts.df;
  for (let i = 1; i + 1 < xs.length; i++) {
    const y0 = ys[i - 1];
    const y = ys[i];
    const y1 = ys[i + 1];
    if (!Number.isFinite(y0) || !Number.isFinite(y) || !Number.isFinite(y1)) continue;
    let kind = null;
    if (y > y0 && y > y1) kind = 'max';
    else if (y < y0 && y < y1) kind = 'min';
    if (!kind) continue;
    const s = kind === 'max' ? -1 : 1;
    const lo = xs[i - 1];
    const hi = xs[i + 1];

    let found = null;
    if (df) {
      const d0 = df(lo);
      const d1 = df(hi);
      if (Number.isFinite(d0) && Number.isFinite(d1) && (d0 > 0) !== (d1 > 0)) {
        const r = brent(df, lo, hi, { fa: d0, fb: d1 });
        if (r) found = { x: r.x, iterations: r.iterations };
      }
    }
    if (!found) {
      const m = brentMin((x) => {
        const v = s * f(x);
        return Number.isFinite(v) ? v : Infinity;
      }, lo, hi);
      found = { x: m.x, iterations: m.iterations };
    }
    const yr = f(found.x);
    if (!Number.isFinite(yr)) continue;
    // The refined extremum must agree with what the samples showed: no further from
    // the middle sample than the neighbours are (rejects poles and jumps).
    const spread = Math.abs(y0 - y) + Math.abs(y1 - y);
    if (Math.abs(yr - y) > spread) continue;
    if (s * yr > s * y + 1e-12 * Math.max(1, Math.abs(y))) continue; // got worse, not better
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - found.x) <= 1e-9 * Math.max(1, Math.abs(found.x))) continue;
    out.push({ x: found.x, y: yr, kind, iterations: found.iterations });
  }
  return out;
}

// Points of interest of y = f(x) for xMin ≤ x ≤ xMax.
//   curve: { f, df? }, others: [{ id, f, df? }] for intersections.
// Returns [{ kind: 'root'|'max'|'min'|'y-intercept'|'intersection', x, y, with? }].
export function pointsOfInterest(curve, xMin, xMax, { others = [], samples = 400 } = {}) {
  const { f, df } = curve;
  const grid = sample(f, xMin, xMax, samples);
  const out = [];
  for (const r of findRoots(f, xMin, xMax, { grid, df })) out.push({ kind: 'root', x: r.x, y: 0 });
  for (const e of findExtrema(f, xMin, xMax, { grid, df })) out.push({ kind: e.kind, x: e.x, y: e.y });
  if (xMin <= 0 && xMax >= 0) {
    const y0 = f(0);
    if (Number.isFinite(y0)) out.push({ kind: 'y-intercept', x: 0, y: y0 });
  }
  for (const o of others) {
    const g = (x) => f(x) - o.f(x);
    const dg = df && o.df ? (x) => df(x) - o.df(x) : undefined;
    for (const r of findRoots(g, xMin, xMax, { samples, df: dg })) {
      const y = f(r.x);
      if (Number.isFinite(y)) out.push({ kind: 'intersection', x: r.x, y, with: o.id });
    }
  }
  return out;
}
