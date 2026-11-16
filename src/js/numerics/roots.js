// Root finding for real functions of one variable. Pure module – no DOM access.
//
// brent()      Brent's method on a bracket [a, b] with f(a), f(b) of opposite sign.
// findRoots()  every root in [a, b] that a sampling scan can see: sign changes are
//              refined with Brent (then Newton if a derivative is given), and touching
//              roots (x² at 0) are found as minima of |f| that reach zero. Poles and
//              jumps where f changes sign without passing through zero are rejected.
//              The scan can miss roots closer together than the sample spacing, so
//              callers should say which range was searched.
import { brentMin } from './minimise.js';

const EPS = 2.220446049250313e-16;

export function brent(f, a, b, opts = {}) {
  let fa = opts.fa ?? f(a);
  let fb = opts.fb ?? f(b);
  const maxIter = opts.maxIter ?? 200;
  const xtol = opts.xtol ?? 1e-15 * Math.abs(b - a);
  if (fa === 0) return { x: a, fx: 0, iterations: 0, converged: true };
  if (fb === 0) return { x: b, fx: 0, iterations: 0, converged: true };
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || (fa > 0) === (fb > 0)) return null;

  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let i = 1; i <= maxIter; i++) {
    if ((fb > 0) === (fc > 0)) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b; b = c; c = a;
      fa = fb; fb = fc; fc = fa;
    }
    const tol = 2 * EPS * Math.abs(b) + 0.5 * xtol;
    const m = 0.5 * (c - b);
    if (Math.abs(m) <= tol || fb === 0) return { x: b, fx: fb, iterations: i, converged: true };
    if (Math.abs(e) < tol || Math.abs(fa) <= Math.abs(fb)) {
      d = m;
      e = m;
    } else {
      // Inverse quadratic interpolation, or the secant method when a === c.
      const s = fb / fa;
      let p;
      let q;
      if (a === c) {
        p = 2 * m * s;
        q = 1 - s;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        p = s * (2 * m * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      else p = -p;
      if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = m;
        e = m;
      }
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
    fb = f(b);
    if (Number.isNaN(fb)) return null; // undefined inside the bracket
  }
  return { x: b, fx: fb, iterations: maxIter, converged: false };
}

// Up to `steps` Newton steps, kept only while they reduce |f|.
export function newtonPolish(f, df, x, fx, steps = 3) {
  let iterations = 0;
  for (let k = 0; k < steps; k++) {
    if (fx === 0) break;
    const d = df(x);
    if (!Number.isFinite(d) || d === 0) break;
    const xn = x - fx / d;
    const fn = f(xn);
    iterations++;
    if (!Number.isFinite(fn) || Math.abs(fn) >= Math.abs(fx)) break;
    x = xn;
    fx = fn;
  }
  return { x, fx, iterations };
}

// Is the converged Brent point a real root, rather than a pole or a jump that
// changes sign? A true root drives |f| far below the values at the bracket ends.
function isRealRoot(fx, fa, fb) {
  if (!Number.isFinite(fx)) return false;
  const scale = Math.max(Math.abs(fa), Math.abs(fb));
  return Math.abs(fx) <= 1e-7 * scale || Math.abs(fx) < 1e-12;
}

// Sample f on [a, b] (n intervals). Returns { xs, ys }.
export function sample(f, a, b, n) {
  const xs = new Float64Array(n + 1);
  const ys = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const x = i === n ? b : a + ((b - a) * i) / n;
    xs[i] = x;
    ys[i] = f(x);
  }
  return { xs, ys };
}

// All roots of f in [a, b]. Options: samples (default 400), df (derivative, for Newton
// polishing), grid ({ xs, ys } from sample(), to share one scan between callers).
// Returns [{ x, fx, iterations, tangential? }] sorted by x.
export function findRoots(f, a, b, opts = {}) {
  const n = opts.samples ?? 400;
  const { xs, ys } = opts.grid ?? sample(f, a, b, n);
  const roots = [];
  const spacing = (b - a) / (xs.length - 1);
  const push = (r) => {
    const last = roots[roots.length - 1];
    if (last && Math.abs(r.x - last.x) <= 1e-9 * Math.max(Math.abs(b - a), Math.abs(r.x))) return;
    roots.push(r);
  };
  const polish = (x, fx, iterations, extra = {}) => {
    if (opts.df) {
      const p = newtonPolish(f, opts.df, x, fx);
      return { x: p.x, fx: p.fx, iterations: iterations + p.iterations, ...extra };
    }
    return { x, fx, iterations, ...extra };
  };
  const bracket = (x0, x1, f0, f1) => {
    const r = brent(f, x0, x1, { fa: f0, fb: f1 });
    if (r && isRealRoot(r.fx, f0, f1)) push(polish(r.x, r.fx, r.iterations));
  };

  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (y === 0) {
      push({ x: xs[i], fx: 0, iterations: 0 });
      continue;
    }
    if (i + 1 < xs.length) {
      const y1 = ys[i + 1];
      if (Number.isFinite(y) && Number.isFinite(y1) && y1 !== 0 && (y > 0) !== (y1 > 0)) {
        bracket(xs[i], xs[i + 1], y, y1);
      }
    }
    // A dip towards zero that doesn't cross between samples: a touching root,
    // or two close roots the scan stepped over.
    if (i > 0 && i + 1 < xs.length) {
      const y0 = ys[i - 1];
      const y1 = ys[i + 1];
      if (!Number.isFinite(y0) || !Number.isFinite(y1) || !Number.isFinite(y)) continue;
      const s = y > 0 ? 1 : -1;
      if (s * y0 <= 0 || s * y1 <= 0) continue;
      if (!(s * y < s * y0 && s * y <= s * y1)) continue;
      const m = brentMin((x) => {
        const v = s * f(x);
        return Number.isFinite(v) ? v : Infinity;
      }, xs[i - 1], xs[i + 1], { tol: 1e-14 * Math.max(1, Math.abs(xs[i])) + 1e-3 * EPS * spacing });
      const fm = s * m.fx;
      if (s * fm < 0) {
        // Crossed zero: two roots on either side of the dip.
        bracket(xs[i - 1], m.x, y0, fm);
        bracket(m.x, xs[i + 1], fm, y1);
      } else if (Math.abs(fm) <= 1e-9 * Math.max(Math.abs(y0), Math.abs(y1))) {
        push({ x: m.x, fx: fm, iterations: m.iterations, tangential: true });
      }
    }
  }
  roots.sort((p, q) => p.x - q.x);
  return roots;
}
