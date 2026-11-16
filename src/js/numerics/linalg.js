// Linear systems by Gaussian elimination with partial pivoting. Pure module.
//
// solveLinearSystem(A, b) reduces [A | b] to reduced row echelon form and reports:
//   { status: 'unique', x, residual, nearlySingular }
//   { status: 'none' }                         inconsistent equations
//   { status: 'infinite', free, particular, relations }
//                                              free: indices of free unknowns; relations
//                                              give each other unknown in terms of them
// plus rank. A works for any m × n shape. Pivots smaller than a tolerance scaled to
// the matrix are treated as zero.

const EPS = 2.220446049250313e-16;

export function solveLinearSystem(A, b) {
  const m = A.length;
  const n = m ? A[0].length : 0;
  const M = A.map((row, i) => [...row, b[i]]);
  const maxAbs = M.reduce((mx, row) => Math.max(mx, ...row.slice(0, n).map(Math.abs)), 0);
  const tol = Math.max(m, n) * EPS * (maxAbs || 1) * 16;

  const pivots = [];
  let r = 0;
  let minPivot = Infinity;
  for (let c = 0; c < n && r < m; c++) {
    // Partial pivoting: largest entry in this column.
    let p = r;
    for (let i = r + 1; i < m; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) <= tol) {
      for (let i = r; i < m; i++) M[i][c] = 0;
      continue;
    }
    [M[r], M[p]] = [M[p], M[r]];
    const pv = M[r][c];
    minPivot = Math.min(minPivot, Math.abs(pv));
    for (let j = c; j <= n; j++) M[r][j] /= pv;
    for (let i = 0; i < m; i++) {
      if (i === r) continue;
      const f = M[i][c];
      if (f === 0) continue;
      for (let j = c; j <= n; j++) M[i][j] -= f * M[r][j];
      M[i][c] = 0;
    }
    pivots.push(c);
    r++;
  }
  const rank = pivots.length;

  // Inconsistent: a zero row with a non-zero right-hand side.
  const rhsScale = Math.max(1, ...b.map(Math.abs));
  for (let i = rank; i < m; i++) {
    if (Math.abs(M[i][n]) > tol * rhsScale * 1e3) return { status: 'none', rank };
  }

  const x = new Array(n).fill(0);
  pivots.forEach((c, i) => { x[c] = M[i][n]; });
  if (rank < n) {
    const free = [];
    for (let c = 0; c < n; c++) if (!pivots.includes(c)) free.push(c);
    // Each pivot unknown in terms of the free ones: x[pivot] = rhs − Σ coef·x[free].
    const relations = pivots.map((c, i) => ({
      unknown: c,
      constant: M[i][n],
      terms: free.map((f) => ({ unknown: f, coef: -M[i][f] })).filter((t) => Math.abs(t.coef) > tol),
    }));
    return { status: 'infinite', rank, free, particular: x, relations };
  }

  let residual = 0;
  for (let i = 0; i < m; i++) {
    let s = -b[i];
    for (let j = 0; j < n; j++) s += A[i][j] * x[j];
    residual = Math.max(residual, Math.abs(s));
  }
  return { status: 'unique', rank, x, residual, nearlySingular: minPivot < 1e-10 * (maxAbs || 1) };
}
