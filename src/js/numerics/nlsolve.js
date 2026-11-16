// Systems of non-linear equations F(x) = 0 (n equations, n unknowns). Pure module.
//
// Each start runs damped Newton (Levenberg–Marquardt: (JᵀJ + μ·diag) δ = −Jᵀf, with μ
// adjusted so every accepted step reduces |f|), then a few plain Newton steps to
// polish. Many starts spread over a box find several solutions; duplicates are merged.
// Like any numerical method this can miss solutions, and the caller says so.

const EPS = 2.220446049250313e-16;

// Solve a small dense system by Gaussian elimination with partial pivoting; null if
// singular.
function gauss(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!(Math.abs(M[p][c]) > 0)) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x.every(Number.isFinite) ? x : null;
}

const norm2 = (v) => v.reduce((s, a) => s + a * a, 0);
const maxAbs = (v) => v.reduce((m, a) => Math.max(m, Math.abs(a)), 0);

function numericJacobian(F, x, f0) {
  const n = x.length;
  const J = f0.map(() => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    const h = 1e-7 * Math.max(1, Math.abs(x[j]));
    const xp = [...x];
    const xm = [...x];
    xp[j] += h;
    xm[j] -= h;
    const fp = F(xp);
    const fm = F(xm);
    for (let i = 0; i < f0.length; i++) J[i][j] = (fp[i] - fm[i]) / (2 * h);
  }
  return J;
}

// One start. Returns { x, residual, iterations } if it converged, else null.
export function newtonFrom(F, x0, { J = null, maxIter = 80, tol = 1e-10 } = {}) {
  const jac = (x, f) => {
    if (J) {
      const m = J(x);
      if (m.every((row) => row.every(Number.isFinite))) return m;
    }
    return numericJacobian(F, x, f);
  };
  let x = [...x0];
  let f = F(x);
  if (!f.every(Number.isFinite)) return null;
  let mu = 1e-3;
  let it = 0;
  const n = x.length;
  for (; it < maxIter; it++) {
    if (maxAbs(f) < tol) break;
    const Jx = jac(x, f);
    if (!Jx.every((row) => row.every(Number.isFinite))) return null;
    // Normal equations of the damped step.
    const JtJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => Jx.reduce((s, row) => s + row[a] * row[b], 0)));
    const Jtf = Array.from({ length: n }, (_, a) => Jx.reduce((s, row, i) => s + row[a] * f[i], 0));
    let accepted = false;
    for (let tries = 0; tries < 12; tries++) {
      const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v + mu * Math.max(v, 1e-12) : v)));
      const d = gauss(A, Jtf.map((v) => -v));
      if (!d) {
        mu *= 10;
        continue;
      }
      const xn = x.map((v, k) => v + d[k]);
      const fn = F(xn);
      if (fn.every(Number.isFinite) && norm2(fn) < norm2(f)) {
        const step = maxAbs(d);
        x = xn;
        f = fn;
        mu = Math.max(mu / 3, 1e-12);
        accepted = true;
        if (step <= 1e-14 * Math.max(1, maxAbs(x))) it = maxIter; // no further progress possible
        break;
      }
      mu *= 4;
    }
    if (!accepted) break;
  }
  // Polish with plain Newton steps while they help.
  for (let k = 0; k < 4; k++) {
    const Jx = jac(x, f);
    const d = gauss(Jx, f.map((v) => -v));
    if (!d) break;
    const xn = x.map((v, i) => v + d[i]);
    const fn = F(xn);
    if (!fn.every(Number.isFinite) || maxAbs(fn) >= maxAbs(f)) break;
    x = xn;
    f = fn;
  }
  const residual = maxAbs(f);
  // Converged: f is tiny, or tiny compared with the size of the Jacobian times x (so
  // equations with large terms, like e^x = 5000, aren't held to an absolute 1e-10).
  const Jx = jac(x, f);
  const scale = Math.max(1, maxAbs(x)) * Math.max(1, ...Jx.map(maxAbs));
  if (!(residual <= Math.max(tol, 1e-12 * scale))) return null;
  return { x, residual, iterations: it };
}

// Halton points in [0, 1)^n.
function halton(index, base) {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}
const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37];

export function startPoints(n, [lo, hi], count = 240) {
  const out = [new Array(n).fill(0)];
  if (n <= 3) {
    const per = Math.max(2, Math.round(count ** (1 / n)));
    const total = per ** n;
    for (let k = 0; k < total; k++) {
      const p = [];
      let r = k;
      for (let j = 0; j < n; j++) {
        const g = r % per;
        r = Math.floor(r / per);
        p.push(lo + ((g + 0.5) / per) * (hi - lo));
      }
      out.push(p);
    }
  } else {
    for (let k = 1; k <= count; k++) out.push(Array.from({ length: n }, (_, j) => lo + halton(k, PRIMES[j]) * (hi - lo)));
  }
  return out;
}

// All the solutions found from starts spread over [lo, hi]^n.
// Returns { solutions: [{ x, residual, iterations }], starts }.
export function solveNonlinear(F, n, { J = null, box = [-10, 10], count = 240, maxSolutions = 20, budgetMs = 1500 } = {}) {
  const starts = startPoints(n, box, count);
  const found = [];
  const t0 = Date.now();
  let tried = 0;
  for (const s of starts) {
    if (Date.now() - t0 > budgetMs) break;
    tried++;
    let r;
    try {
      r = newtonFrom(F, s, { J });
    } catch {
      r = null;
    }
    if (!r) continue;
    const same = found.find((q) => q.x.every((v, k) => Math.abs(v - r.x[k]) <= 1e-6 * Math.max(1, Math.abs(v))));
    if (same) {
      if (r.residual < same.residual) Object.assign(same, r);
      continue;
    }
    found.push(r);
    if (found.length >= maxSolutions) break;
  }
  // Tidy -0 and values a rounding error away from a round number.
  for (const s of found) {
    s.x = s.x.map((v) => {
      const r = Math.round(v * 1e9) / 1e9;
      return Math.abs(v - r) < 64 * EPS * Math.max(1, Math.abs(v)) ? r + 0 : v + 0;
    });
  }
  found.sort((a, b) => {
    for (let k = 0; k < n; k++) if (a.x[k] !== b.x[k]) return a.x[k] - b.x[k];
    return 0;
  });
  return { solutions: found, starts: tried, complete: tried === starts.length };
}
