// Runs a fit of a data set and works out its statistics. Pure module – no DOM access.
//
// runFit(analysis, set, fit) -> { error } | { empty } | result, where result is
//   { model, method, values, se, ci, cov, corr, q, n, p, dof, rss, r2, adjR2, rmse, s,
//     weighted, chi2, chi2red, pValue, f(x), meanVar(x), residuals, notes, equation }
//
// Statistics (D6):
//   unweighted: s² = RSS/(n − p), Cov = s²(JᵀJ)⁻¹, 95% intervals with Student t(n − p)
//   weighted by σy (absolute errors): Cov = (JᵀWJ)⁻¹, χ² = Σ(r/σ)², reduced χ², the
//   probability of a χ² at least this large, 95% intervals with the normal quantile.
// meanVar(x) = g(x)ᵀ·Cov·g(x), g = ∂f/∂p: the variance of the fitted value (delta method;
// exact for linear models), for confidence and prediction bands.
import { buildModel, equationText } from './models.js';
import { fitNonlinear, primaryStart } from './nonlinear.js';
import { leastSquares } from '../numerics/qr.js';
import { tQuantile, normalQuantile, chi2Sf } from '../numerics/stats.js';
import { fitPoints } from '../data/table.js';

const Z95 = normalQuantile(0.975);

const fail = (message) => ({ error: { message, start: -1, end: -1 } });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function runFit(analysis, set, fit, options = {}) {
  const model = buildModel(analysis, fit);
  if (model.empty) return { empty: true };
  if (model.error) return { error: model.error };
  const p = model.params.length;
  const notes = [];

  const weighted = !!(fit.weighted && set.hasSigma);
  const pts = fitPoints(set, { weighted });
  if (weighted) {
    const all = fitPoints(set).x.length;
    const missing = all - pts.x.length;
    if (missing) notes.push(`${plural(missing, 'point')} without a σy value ${missing === 1 ? 'is' : 'are'} left out of this weighted fit.`);
  }

  // Leave out points where the model (or its derivatives) can't be evaluated, e.g. ln x
  // at x ≤ 0. Linear models: test with all parameters 0. Others: at the starting values.
  const frame = new Float64Array(p + 1);
  const primary = model.linear ? null : primaryStart(model, fit, pts.x, pts.y, analysis.angle);
  const x = [];
  const y = [];
  const sig = [];
  const index = [];
  let undefinedAt = 0;
  for (let i = 0; i < pts.x.length; i++) {
    frame[0] = pts.x[i];
    let ok = true;
    if (model.linear) {
      for (let k = 1; k <= p; k++) frame[k] = 0;
      ok = Number.isFinite(model.f(frame));
      for (let k = 0; ok && k < p; k++) ok = Number.isFinite(model.grads[k](frame));
    } else {
      for (let k = 1; k <= p; k++) frame[k] = primary[k - 1];
      ok = Number.isFinite(model.f(frame));
      for (let k = 0; ok && model.grads && k < p; k++) ok = Number.isFinite(model.grads[k](frame));
    }
    if (!ok) {
      undefinedAt++;
      continue;
    }
    x.push(pts.x[i]);
    y.push(pts.y[i]);
    sig.push(weighted ? pts.s[i] : 1);
    index.push(pts.index[i]);
  }
  if (undefinedAt) notes.push(`${plural(undefinedAt, 'point')} left out: the model (or how it changes with its parameters) isn't defined there.`);
  const n = x.length;
  if (n === 0) return fail('No points to fit yet: each point needs an x and a y value');
  if (n < p) return fail(`This model has ${plural(p, 'parameter')}, so it needs at least ${p} points (there ${n === 1 ? 'is' : 'are'} ${n})`);

  let solved;
  if (model.linear) {
    solved = (fit.model === 'line' || fit.model === 'poly') ? solvePolynomial(x, y, sig, p - 1) : solveLinear(model, x, y, sig);
  } else {
    solved = fitNonlinear(model, x, y, sig, { ...options, fit, angle: analysis.angle });
  }
  if (solved.error) return { error: solved.error, notes };
  if (solved.notes) notes.push(...solved.notes);

  const { covUnscaled, rss, yhat } = solved;
  const dof = n - p;
  // Weighted mean and total sum of squares, for R².
  let sw = 0;
  let swy = 0;
  for (let i = 0; i < n; i++) {
    const w = 1 / (sig[i] * sig[i]);
    sw += w;
    swy += w * y[i];
  }
  const ybar = swy / sw;
  let sst = 0;
  for (let i = 0; i < n; i++) sst += ((y[i] - ybar) / sig[i]) ** 2;

  const s2 = dof > 0 ? rss / dof : NaN;
  const factor = weighted ? 1 : s2;
  const cov = covUnscaled.map((row) => row.map((v) => v * factor));
  const se = solved.values.map((_, k) => Math.sqrt(cov[k][k]));
  const atNoise = noiseTest(model, solved, x, y);
  const values = cleanValues(solved.values, atNoise);
  const q = weighted ? Z95 : dof > 0 ? tQuantile(0.975, dof) : NaN;
  const ci = values.map((v, k) => [v - q * se[k], v + q * se[k]]);
  const corr = cov.map((row, i) => row.map((v, j) => v / Math.sqrt(cov[i][i] * cov[j][j])));
  if (dof === 0) notes.push(`As many parameters as points: the curve passes through every point, so there are no error estimates.`);

  // Honest numerics: say when parameters are barely determined, or χ² disagrees with σy.
  if (dof > 0) {
    // A parameter pinned down to rounding error (an exact fit) is well determined, even
    // when its value is zero and its standard error is a tiny bit of rounding noise.
    const loose = model.params.filter((_, k) => Number.isFinite(se[k]) && se[k] > Math.abs(values[k])
      && !atNoise(k, se[k]));
    if (loose.length) {
      const names = loose.map((n) => n.replace(/_(\d+)/, (_, d) => d.split('').map((c) => '₀₁₂₃₄₅₆₇₈₉'[c]).join('')));
      notes.push(`${names.join(', ')} ${loose.length === 1 ? 'is' : 'are'} poorly determined: the standard error is larger than the value. The data may not pin ${loose.length === 1 ? 'it' : 'them'} down, or the model may have more parameters than it needs.`);
    }
  }
  if (weighted && dof > 0) {
    const p2 = chi2Sf(rss, dof);
    if (p2 < 0.01) notes.push(`χ²/dof = ${(rss / dof).toPrecision(3)} is large: the points scatter more than their σy values allow. Either σy is underestimated or the model doesn't describe the data, and the standard errors may be too small.`);
    else if (p2 > 0.99) notes.push(`χ²/dof = ${(rss / dof).toPrecision(3)} is small: the points scatter less than their σy values suggest, so σy may be overestimated.`);
  }

  const residuals = { x, r: y.map((v, i) => v - yhat[i]), s: weighted ? sig : null, index };
  const r2 = sst > 0 ? 1 - rss / sst : NaN;
  const result = {
    model, method: solved.method, values, se, ci, cov, corr, q,
    n, p, dof, rss, r2,
    adjR2: dof > 0 && n > 1 ? 1 - (1 - r2) * (n - 1) / dof : NaN,
    rmse: Math.sqrt(y.reduce((a, v, i) => a + (v - yhat[i]) ** 2, 0) / n),
    s: Math.sqrt(s2),
    weighted,
    chi2: weighted ? rss : NaN,
    chi2red: weighted && dof > 0 ? rss / dof : NaN,
    pValue: weighted && dof > 0 ? chi2Sf(rss, dof) : NaN,
    f: solved.f,
    meanVar: (t) => solved.gradVar(t, factor),
    residuals,
    iterations: solved.iterations,
    notes,
  };
  try {
    result.equation = equationText(model, values);
  } catch {
    result.equation = null;
  }
  return result;
}

// ---- rounding noise ----------------------------------------------------------------------
//
// Least squares in floating point leaves rounding noise in parameters whose exact value is
// zero: fitting y = x² to (1, 1), (2, 4), (3, 9), (4, 16) gives a₀ ≈ −6e−15, a₁ ≈ 2e−15.
// Such a value is set to exactly zero. Polynomials: when it is within a rounding-error
// bound worked out from the centred fit (POLY_NOISE allows for error growth in the QR
// solve and the conversion to powers of x). Other models: when zeroing it changes the
// fitted values at the data points by no more than NOISE_TOL of the size of the sum that
// produces them (so heavy cancellation raises the bar rather than lowering it).
export const NOISE_TOL = 1e-11;
const POLY_NOISE = 2;

// effectSizes(...) -> { scale, effect(k, delta), negligible(k, delta) }: how much changing
// parameter k by delta moves the fitted values at the data points, against `scale`.
export function effectSizes(model, values, x, y, yhat) {
  const p = values.length;
  const n = x.length;
  const frame = new Float64Array(p + 1);
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(y[i]), Math.abs(yhat[i]));
  let effect;
  if (model.linear && model.grads) {
    // f = g₀(x) + Σ pⱼ·gⱼ(x): parameter k moves f by delta·gₖ(x). The scale is the
    // largest sum of term sizes |g₀| + Σ|pⱼ·gⱼ|, the size of the numbers being added.
    const gmax = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      frame[0] = x[i];
      for (let k = 1; k <= p; k++) frame[k] = 0;
      let sum = Math.abs(model.f(frame));
      for (let k = 0; k < p; k++) {
        const g = Math.abs(model.grads[k](frame));
        if (g > gmax[k]) gmax[k] = g;
        sum += Math.abs(values[k] * g);
      }
      if (sum > scale) scale = sum;
    }
    effect = (k, delta) => Math.abs(delta) * gmax[k];
  } else {
    effect = (k, delta) => {
      let worst = 0;
      for (let i = 0; i < n; i++) {
        frame[0] = x[i];
        for (let j = 0; j < p; j++) frame[j + 1] = values[j];
        frame[k + 1] += delta;
        const d = Math.abs(model.f(frame) - yhat[i]);
        if (!(d <= worst)) worst = d; // NaN counts as a large change
      }
      return worst;
    };
  }
  return {
    scale,
    effect,
    negligible: (k, delta) => scale > 0 && effect(k, delta) <= NOISE_TOL * scale,
  };
}

// noiseTest(...) -> atNoise(k, amount): is a change of `amount` in parameter k no bigger
// than rounding error? Polynomial solves supply a bound per coefficient (solved.noise).
export function noiseTest(model, solved, x, y) {
  if (solved.noise) return (k, amount) => Math.abs(amount) <= solved.noise[k];
  const size = effectSizes(model, solved.values, x, y, solved.yhat);
  return (k, amount) => size.negligible(k, amount);
}

export function cleanValues(values, atNoise) {
  return values.map((v, k) => (v !== 0 && atNoise(k, v) ? 0 : v));
}

// ---- models linear in their parameters ---------------------------------------------------

// f = g₀(x) + Σ pⱼ·gⱼ(x), with gⱼ = ∂f/∂pⱼ (which don't depend on the parameters).
function solveLinear(model, x, y, sig) {
  const p = model.params.length;
  const n = x.length;
  const frame = new Float64Array(p + 1);
  const basis = (t) => {
    frame[0] = t;
    for (let k = 1; k <= p; k++) frame[k] = 0;
    return { g0: model.f(frame), g: model.grads.map((d) => d(frame)) };
  };
  const cols = Array.from({ length: p }, () => new Float64Array(n));
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const { g0, g } = basis(x[i]);
    for (let k = 0; k < p; k++) cols[k][i] = g[k] / sig[i];
    b[i] = (y[i] - g0) / sig[i];
  }
  const r = leastSquares(cols, b);
  if (r.rank < p) return rankError(model, r.dependent);
  const values = r.x;
  const f = (t) => {
    frame[0] = t;
    for (let k = 0; k < p; k++) frame[k + 1] = values[k];
    return model.f(frame);
  };
  const gradVar = (t, factor) => {
    const { g } = basis(t);
    return quadForm(g, r.cov) * factor;
  };
  return {
    method: 'Linear least squares (QR)', values, covUnscaled: r.cov, rss: r.rss,
    yhat: x.map(f), f, gradVar,
  };
}

// Lines and polynomials: fitted in t = (x − c)/h (centred and scaled), which keeps
// the problem well conditioned for x values like years, then converted back to
// coefficients of powers of x, with the covariance transformed to match.
function solvePolynomial(x, y, sig, deg) {
  const n = x.length;
  const p = deg + 1;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of x) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const c = (lo + hi) / 2;
  const hw = (hi - lo) / 2 || 1;
  const cols = Array.from({ length: p }, () => new Float64Array(n));
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = (x[i] - c) / hw;
    let tk = 1;
    for (let k = 0; k < p; k++) {
      cols[k][i] = tk / sig[i];
      tk *= t;
    }
    b[i] = y[i] / sig[i];
  }
  const distinct = new Set(x).size;
  const r = leastSquares(cols, b);
  if (r.rank < p) {
    return {
      error: {
        message: distinct < p
          ? `A degree-${deg} ${deg === 1 ? 'line' : 'polynomial'} needs at least ${p} different x values (there ${distinct === 1 ? 'is' : 'are'} ${distinct})`
          : 'The coefficients can\'t all be found from this data: try a lower degree',
        start: -1, end: -1,
      },
    };
  }
  // T[j][k]: coefficient of x^j in ((x − c)/h)^k = Σ_j C(k, j) x^j (−c)^(k−j) / h^k.
  const T = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let k = 0; k < p; k++) {
    let binom = 1;
    for (let j = 0; j <= k; j++) {
      T[j][k] = (binom * (-c) ** (k - j)) / hw ** k;
      binom = (binom * (k - j)) / (j + 1);
    }
  }
  const values = T.map((row) => row.reduce((s, v, k) => s + v * r.x[k], 0));
  // Rounding-error size of each coefficient of x^j: the centred coefficients are good to
  // about κ·ε·max|r| (κ = condition number of the centred problem, estimated from (AᵀA)⁻¹
  // and the column sizes), and converting to powers of x multiplies that by Σₖ|T[j][k]|.
  let rmax = 0;
  let covMax = 0;
  let colMax = 0;
  for (let k = 0; k < p; k++) {
    rmax = Math.max(rmax, Math.abs(r.x[k]));
    covMax = Math.max(covMax, r.cov[k][k]);
    colMax = Math.max(colMax, cols[k].reduce((s, v) => s + v * v, 0));
  }
  const kappa = Math.sqrt(covMax * colMax);
  const noise = T.map((row) => POLY_NOISE * Number.EPSILON * (1 + kappa) * rmax * row.reduce((s, v) => s + Math.abs(v), 0));
  const covUnscaled = T.map((ri) => T.map((rj) => {
    let s = 0;
    for (let a = 0; a < p; a++) for (let b2 = 0; b2 < p; b2++) s += ri[a] * r.cov[a][b2] * rj[b2];
    return s;
  }));
  // Evaluate in the centred form (Horner) for accuracy.
  const f = (t0) => {
    const t = (t0 - c) / hw;
    let s = 0;
    for (let k = p - 1; k >= 0; k--) s = s * t + r.x[k];
    return s;
  };
  const gradVar = (t0, factor) => {
    const t = (t0 - c) / hw;
    const g = new Array(p);
    let tk = 1;
    for (let k = 0; k < p; k++) {
      g[k] = tk;
      tk *= t;
    }
    return quadForm(g, r.cov) * factor;
  };
  return {
    method: 'Linear least squares (QR)', values, covUnscaled, rss: r.rss,
    yhat: x.map(f), f, gradVar, noise,
  };
}

function rankError(model, dependent) {
  const names = (dependent || []).map((k) => model.params[k]);
  return {
    error: {
      message: names.length
        ? `The data can't tell all the parameters apart (${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} not determined). Check the model, or add points with more varied x values.`
        : "The data can't determine all the parameters",
      start: -1, end: -1,
    },
  };
}

export function quadForm(g, C) {
  let s = 0;
  for (let i = 0; i < g.length; i++) {
    let row = 0;
    for (let j = 0; j < g.length; j++) row += C[i][j] * g[j];
    s += g[i] * row;
  }
  return s;
}
