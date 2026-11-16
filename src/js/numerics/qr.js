// Linear least squares by Householder QR with column scaling and column pivoting.
// Pure module.
//
// leastSquares(columns, b) minimises ‖A·x − b‖ where A is given as an array of n
// columns (each an array of m numbers). Returns
//   { x, rank, cov, residuals, rss }
// cov is (AᵀA)⁻¹ – multiply by the residual variance for parameter covariances. When
// the columns are (numerically) linearly dependent, rank < n and x / cov are null,
// with `dependent` listing the column indices that couldn't be determined.
//
// Column scaling (each column divided by its norm) makes the rank test independent of
// the units of the parameters; pivoting puts the best-determined columns first.

const EPS = 2.220446049250313e-16;

export function leastSquares(columns, b, { rcond } = {}) {
  const n = columns.length;
  const m = b.length;
  if (n === 0) return { x: [], rank: 0, cov: [], residuals: b.slice(), rss: b.reduce((s, v) => s + v * v, 0) };
  // Scaled working copies.
  const scale = new Float64Array(n);
  const A = columns.map((col, j) => {
    let s = 0;
    for (let i = 0; i < m; i++) s += col[i] * col[i];
    scale[j] = Math.sqrt(s) || 1;
    const out = new Float64Array(m);
    for (let i = 0; i < m; i++) out[i] = col[i] / scale[j];
    return out;
  });
  const qtb = Float64Array.from(b);
  const perm = Array.from({ length: n }, (_, j) => j);
  const diag = new Float64Array(n);
  const steps = Math.min(m, n);
  const tol = rcond ?? Math.max(m, n) * EPS * 10;
  let rank = 0;
  let r00 = 0;

  for (let k = 0; k < steps; k++) {
    // Pivot: the remaining column with the largest norm below row k.
    let best = k;
    let bestNorm = -1;
    for (let j = k; j < n; j++) {
      let s = 0;
      const c = A[j];
      for (let i = k; i < m; i++) s += c[i] * c[i];
      if (s > bestNorm) { bestNorm = s; best = j; }
    }
    if (best !== k) {
      [A[k], A[best]] = [A[best], A[k]];
      [perm[k], perm[best]] = [perm[best], perm[k]];
    }
    const norm = Math.sqrt(bestNorm);
    if (k === 0) r00 = norm;
    if (!(norm > tol * r00) || norm === 0) break;
    const v = A[k];
    const alpha = v[k] > 0 ? -norm : norm;
    v[k] -= alpha; // v is now the Householder vector (rows k…m-1)
    let vv = 0;
    for (let i = k; i < m; i++) vv += v[i] * v[i];
    const apply = (c) => {
      let d = 0;
      for (let i = k; i < m; i++) d += v[i] * c[i];
      const f = (2 * d) / vv;
      for (let i = k; i < m; i++) c[i] -= f * v[i];
    };
    for (let j = k + 1; j < n; j++) apply(A[j]);
    apply(qtb);
    diag[k] = alpha;
    rank++;
  }

  if (rank < n) {
    return { x: null, cov: null, rank, dependent: perm.slice(rank).sort((p, q) => p - q), residuals: null, rss: NaN };
  }

  // R (upper triangle): R[i][j] = A[j][i] for i < j, diag on the diagonal.
  const R = (i, j) => (i === j ? diag[i] : A[j][i]);
  // Back substitution: R z = (Qᵀb)[0…n-1]
  const z = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = qtb[i];
    for (let j = i + 1; j < n; j++) s -= R(i, j) * z[j];
    z[i] = s / diag[i];
  }
  // R⁻¹ (upper triangular), then (RᵀR)⁻¹ = R⁻¹R⁻ᵀ.
  const Ri = Array.from({ length: n }, () => new Float64Array(n));
  for (let j = 0; j < n; j++) {
    Ri[j][j] = 1 / diag[j];
    for (let i = j - 1; i >= 0; i--) {
      let s = 0;
      for (let k = i + 1; k <= j; k++) s += R(i, k) * Ri[k][j];
      Ri[i][j] = -s / diag[i];
    }
  }
  const covP = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let k = j; k < n; k++) s += Ri[i][k] * Ri[j][k];
      covP[i][j] = s;
      covP[j][i] = s;
    }
  }
  // Undo pivoting and scaling.
  const x = new Array(n);
  const cov = Array.from({ length: n }, () => new Array(n));
  for (let a = 0; a < n; a++) {
    x[perm[a]] = z[a] / scale[perm[a]];
    for (let c = 0; c < n; c++) cov[perm[a]][perm[c]] = covP[a][c] / (scale[perm[a]] * scale[perm[c]]);
  }
  // Residuals from the original columns, which is more accurate than ‖Qᵀb‖ below row n.
  const residuals = new Array(m);
  let rss = 0;
  for (let i = 0; i < m; i++) {
    let s = b[i];
    for (let j = 0; j < n; j++) s -= columns[j][i] * x[j];
    residuals[i] = s;
    rss += s * s;
  }
  return { x, rank, cov, residuals, rss };
}
