// One-dimensional minimisation. Pure module – no DOM access.
//
// brentMin()  Brent's minimiser (golden section + parabolic steps) on [a, b].

const EPS = 2.220446049250313e-16;
const SQRT_EPS = Math.sqrt(EPS);
const GOLD = 0.3819660112501051; // (3 - √5) / 2

export function brentMin(f, a, b, opts = {}) {
  const maxIter = opts.maxIter ?? 200;
  const t = opts.tol ?? 1e-12;
  let x = a + GOLD * (b - a);
  let w = x;
  let v = x;
  let fx = f(x);
  let fw = fx;
  let fv = fx;
  let d = 0;
  let e = 0;
  for (let i = 1; i <= maxIter; i++) {
    const m = 0.5 * (a + b);
    const tol1 = SQRT_EPS * Math.abs(x) + t;
    const tol2 = 2 * tol1;
    if (Math.abs(x - m) <= tol2 - 0.5 * (b - a)) return { x, fx, iterations: i, converged: true };
    let golden = true;
    if (Math.abs(e) > tol1) {
      const r = (x - w) * (fx - fv);
      let q = (x - v) * (fx - fw);
      let p = (x - v) * q - (x - w) * r;
      q = 2 * (q - r);
      if (q > 0) p = -p;
      else q = -q;
      const etemp = e;
      e = d;
      if (Math.abs(p) < Math.abs(0.5 * q * etemp) && p > q * (a - x) && p < q * (b - x)) {
        d = p / q;
        const u = x + d;
        if (u - a < tol2 || b - u < tol2) d = m > x ? tol1 : -tol1;
        golden = false;
      }
    }
    if (golden) {
      e = (x < m ? b : a) - x;
      d = GOLD * e;
    }
    const u = Math.abs(d) >= tol1 ? x + d : x + (d > 0 ? tol1 : -tol1);
    let fu = f(u);
    if (Number.isNaN(fu)) fu = Infinity;
    if (fu <= fx) {
      if (u < x) b = x;
      else a = x;
      v = w; fv = fw;
      w = x; fw = fx;
      x = u; fx = fu;
    } else {
      if (u < x) a = u;
      else b = u;
      if (fu <= fw || w === x) {
        v = w; fv = fw;
        w = u; fw = fu;
      } else if (fu <= fv || v === x || v === w) {
        v = u; fv = fu;
      }
    }
  }
  return { x, fx, iterations: maxIter, converged: false };
}
