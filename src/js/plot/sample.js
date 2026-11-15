// Adaptive curve sampling in screen space. Pure module – no DOM access.
//
// A curve is described by pointAt(t) -> [sx, sy] (screen pixels) or null where the
// curve is undefined. The parameter range is sampled evenly, then each interval is
// recursively subdivided while the curve bends visibly or changes between defined
// and undefined. At the maximum depth, a large jump whose midpoint is not between
// its ends is treated as a discontinuity (asymptote, step), so no false connecting
// line is drawn.
//
// Output: an array of polylines { x: number[], y: number[], t: number[] }.
import { toScreen, worldBounds } from './viewport.js';

const DEFAULTS = {
  initial: 200,   // evenly spaced intervals before refinement
  maxDepth: 6,    // levels of bisection per interval
  tol: 0.35,      // px: allowed distance of the midpoint from the chord's midpoint
  maxSeg: Infinity, // px: always split chords longer than this (parametric curves)
  jump: 3,        // px: a gap this large at full depth is a candidate discontinuity
  budget: 40000,  // maximum function evaluations
};

export function sampleCurve(pointAt, t0, t1, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const lines = [];
  let cur = null;
  let budget = o.budget;

  const evalAt = (t) => {
    budget--;
    const p = pointAt(t);
    return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null;
  };
  const add = (t, p) => {
    if (!cur) {
      cur = { x: [], y: [], t: [] };
      lines.push(cur);
    }
    cur.x.push(p[0]);
    cur.y.push(p[1]);
    cur.t.push(t);
  };
  const breakLine = () => {
    cur = null;
  };

  function refine(ta, pa, tb, pb, depth) {
    const tm = (ta + tb) / 2;
    const pm = evalAt(tm);
    const canSplit = depth < o.maxDepth && budget > 0;
    if (canSplit) {
      let split = false;
      if (!pa !== !pb || !pa !== !pm) {
        split = true; // defined/undefined boundary
      } else if (pa && pb && pm) {
        const dx = pm[0] - (pa[0] + pb[0]) / 2;
        const dy = pm[1] - (pa[1] + pb[1]) / 2;
        if (dx * dx + dy * dy > o.tol * o.tol) split = true;
        else if (o.maxSeg !== Infinity && Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) > o.maxSeg) split = true;
      }
      if (split) {
        refine(ta, pa, tm, pm, depth + 1);
        refine(tm, pm, tb, pb, depth + 1);
        return;
      }
    }
    // Leaf interval: connect, break or skip.
    if (pa && pb) {
      if (depth >= o.maxDepth && Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) > o.jump && !between(pa, pm, pb)) {
        breakLine();
      }
      add(tb, pb);
    } else if (pb) {
      breakLine();
      add(tb, pb);
    } else {
      breakLine();
    }
  }

  const n = Math.max(1, Math.ceil(o.initial));
  const dt = (t1 - t0) / n;
  let ta = t0;
  let pa = evalAt(ta);
  if (pa) add(ta, pa);
  for (let i = 1; i <= n; i++) {
    const tb = i === n ? t1 : t0 + i * dt;
    const pb = evalAt(tb);
    refine(ta, pa, tb, pb, 0);
    ta = tb;
    pa = pb;
  }
  return lines.filter((l) => l.x.length > 0);
}

// Is pm part-way along the chord pa -> pb (rather than near one end or off to the side)?
function between(pa, pm, pb) {
  if (!pm) return false;
  const vx = pb[0] - pa[0];
  const vy = pb[1] - pa[1];
  const len2 = vx * vx + vy * vy;
  const u = ((pm[0] - pa[0]) * vx + (pm[1] - pa[1]) * vy) / len2;
  if (u < 0.02 || u > 0.98) return false;
  const px = pa[0] + u * vx - pm[0];
  const py = pa[1] + u * vy - pm[1];
  return px * px + py * py < len2 / 4;
}

// ---- Curve types ---------------------------------------------------------------


// y = f(x) across the visible x range.
export function sampleCartesian(f, vp, options) {
  const { xMin, xMax } = worldBounds(vp);
  const pad = 2 / vp.scaleX;
  return sampleCurve(
    (x) => {
      const y = f(x);
      return Number.isFinite(y) ? toScreen(vp, x, y) : null;
    },
    xMin - pad, xMax + pad,
    { initial: Math.max(50, vp.width / 2), maxDepth: 6, ...options },
  );
}

// x = g(y) across the visible y range.
export function sampleCartesianX(g, vp, options) {
  const { yMin, yMax } = worldBounds(vp);
  const pad = 2 / vp.scaleY;
  return sampleCurve(
    (y) => {
      const x = g(y);
      return Number.isFinite(x) ? toScreen(vp, x, y) : null;
    },
    yMax + pad, yMin - pad, // top to bottom in screen space
    { initial: Math.max(50, vp.height / 2), maxDepth: 6, ...options },
  );
}

// (fx(t), fy(t)) for t in [t0, t1].
export function sampleParametric(fx, fy, t0, t1, vp, options) {
  return sampleCurve(
    (t) => {
      const x = fx(t);
      const y = fy(t);
      return Number.isFinite(x) && Number.isFinite(y) ? toScreen(vp, x, y) : null;
    },
    t0, t1,
    { initial: 500, maxDepth: 9, maxSeg: 24, ...options },
  );
}

// r = f(θ) for θ in [th0, th1]. angleFactor converts θ to radians (π/180 in degree mode).
export function samplePolar(f, th0, th1, vp, angleFactor = 1, options) {
  return sampleCurve(
    (th) => {
      const r = f(th);
      if (!Number.isFinite(r)) return null;
      const a = th * angleFactor;
      return toScreen(vp, r * Math.cos(a), r * Math.sin(a));
    },
    th0, th1,
    { initial: 500, maxDepth: 9, maxSeg: 24, ...options },
  );
}

// ---- Hit testing -----------------------------------------------------------------

// Nearest point on a set of polylines to (sx, sy).
// Returns { dist, x, y, t, line, index } or null. t is interpolated along the segment.
export function nearestOnLines(lines, sx, sy) {
  let best = null;
  for (let li = 0; li < lines.length; li++) {
    const { x, y, t } = lines[li];
    if (x.length === 1) {
      const d = Math.hypot(x[0] - sx, y[0] - sy);
      if (!best || d < best.dist) best = { dist: d, x: x[0], y: y[0], t: t[0], line: li, index: 0 };
      continue;
    }
    for (let i = 0; i + 1 < x.length; i++) {
      const ax = x[i];
      const ay = y[i];
      const vx = x[i + 1] - ax;
      const vy = y[i + 1] - ay;
      const len2 = vx * vx + vy * vy;
      let u = len2 > 0 ? ((sx - ax) * vx + (sy - ay) * vy) / len2 : 0;
      u = Math.max(0, Math.min(1, u));
      const px = ax + u * vx;
      const py = ay + u * vy;
      const d = Math.hypot(px - sx, py - sy);
      if (!best || d < best.dist) {
        best = { dist: d, x: px, y: py, t: t[i] + u * (t[i + 1] - t[i]), line: li, index: i };
      }
    }
  }
  return best;
}
