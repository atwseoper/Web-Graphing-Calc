// Probability distributions for the distribution functions (Phase 7b). Pure module.
//
// Built on the special functions in stats.js (lnGamma, betaInc, gammaP / gammaQ, tCdf,
// tQuantile, normalQuantile), which the fit reports already use. Arguments follow the
// TI-84's order, and invalid parameters (σ ≤ 0, ν ≤ 0, p outside [0, 1], a non-whole
// number of trials…) give NaN.
//
//   normalPdf(x, μ, σ)          normalCdf(x, μ, σ) = P(X ≤ x)    normalInterval(a, b, μ, σ)
//   invNorm(p, μ, σ)
//   tPdf(x, ν)                  tCdfAt(x, ν)                     tInterval(a, b, ν)
//   invT(p, ν)
//   chi2Pdf(x, k)               chi2Cdf(x, k)                    chi2Interval(a, b, k)
//   binomPdf(n, p, x)           binomCdf(n, p, x) = P(X ≤ x)     binomInterval(n, p, a, b)
//   poissonPdf(μ, x)            poissonCdf(μ, x)                 poissonInterval(μ, a, b)
//
// A discrete pdf is 0 between whole numbers (no probability lies there) and a discrete
// cdf is a step function: P(X ≤ 2.5) = P(X ≤ 2).
import {
  lnGamma, betaInc, gammaP, gammaQ, tCdf, tQuantile, normalQuantile,
} from './stats.js';
import { nCr } from './special.js';

const LN_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);

// ---- normal --------------------------------------------------------------------------

// erfc(x) through the incomplete gamma function, erfc(z) = Q(½, z²) for z ≥ 0: accurate
// far into the tails, where 1 − erf(x) would lose every digit.
export function erfc(x) {
  if (Number.isNaN(x)) return NaN;
  const z = Math.abs(x);
  const r = z === 0 ? 1 : z === Infinity ? 0 : gammaQ(0.5, z * z);
  return x >= 0 ? r : 2 - r;
}

// Upper tail of the standard normal, P(Z > z).
function upperZ(z) {
  return 0.5 * erfc(z / Math.SQRT2);
}

export function normalPdf(x, mu = 0, sigma = 1) {
  if (!(sigma > 0)) return NaN;
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z - LN_SQRT_2PI) / sigma;
}

export function normalCdf(x, mu = 0, sigma = 1) {
  if (!(sigma > 0) || Number.isNaN(x)) return NaN;
  return upperZ(-(x - mu) / sigma);
}

// P(a ≤ X ≤ b), worked out in whichever tail keeps its digits (b < a gives a negative
// value, as integrals do).
export function normalInterval(a, b, mu = 0, sigma = 1) {
  if (!(sigma > 0) || Number.isNaN(a) || Number.isNaN(b)) return NaN;
  const za = (a - mu) / sigma;
  const zb = (b - mu) / sigma;
  if (za > 0 && zb > 0) return upperZ(za) - upperZ(zb);
  return upperZ(-zb) - upperZ(-za);
}

export function invNorm(p, mu = 0, sigma = 1) {
  if (!(sigma > 0) || !(p >= 0 && p <= 1)) return NaN;
  return mu + sigma * normalQuantile(p);
}

// ---- Student's t -----------------------------------------------------------------------

export function tPdf(x, nu) {
  if (!(nu > 0) || Number.isNaN(x)) return NaN;
  if (nu === Infinity) return normalPdf(x);
  const lnC = lnGamma((nu + 1) / 2) - lnGamma(nu / 2) - 0.5 * Math.log(nu * Math.PI);
  return Math.exp(lnC - ((nu + 1) / 2) * Math.log1p((x * x) / nu));
}

export function tCdfAt(x, nu) {
  if (!(nu > 0) || Number.isNaN(x)) return NaN;
  if (nu === Infinity) return normalCdf(x);
  return tCdf(x, nu);
}

export function tInterval(a, b, nu) {
  if (!(nu > 0) || Number.isNaN(a) || Number.isNaN(b)) return NaN;
  if (a > 0 && b > 0) return tCdfAt(-a, nu) - tCdfAt(-b, nu); // upper tail
  return tCdfAt(b, nu) - tCdfAt(a, nu);
}

export function invT(p, nu) {
  if (!(nu > 0) || !(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  return tQuantile(p, nu);
}

// ---- χ² ---------------------------------------------------------------------------------

export function chi2Pdf(x, k) {
  if (!(k > 0) || Number.isNaN(x)) return NaN;
  if (x < 0) return 0;
  if (x === 0) return k < 2 ? Infinity : k === 2 ? 0.5 : 0;
  const h = k / 2;
  return Math.exp((h - 1) * Math.log(x) - x / 2 - h * Math.LN2 - lnGamma(h));
}

export function chi2Cdf(x, k) {
  if (!(k > 0) || Number.isNaN(x)) return NaN;
  if (x <= 0) return 0;
  if (x === Infinity) return 1;
  return gammaP(k / 2, x / 2);
}

export function chi2Interval(a, b, k) {
  if (!(k > 0) || Number.isNaN(a) || Number.isNaN(b)) return NaN;
  const sf = (x) => (x <= 0 ? 1 : x === Infinity ? 0 : gammaQ(k / 2, x / 2));
  // Upper-tail form when both limits are past the median, where the cdf is near 1.
  if (Math.min(a, b) > k) return sf(a) - sf(b);
  return chi2Cdf(b, k) - chi2Cdf(a, k);
}

// ---- binomial ---------------------------------------------------------------------------

const wholeNonNeg = (n) => Number.isInteger(n) && n >= 0;

function lnChoose(n, k) {
  return lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
}

export function binomPdf(n, p, x) {
  if (!wholeNonNeg(n) || !(p >= 0 && p <= 1) || Number.isNaN(x)) return NaN;
  if (!Number.isInteger(x) || x < 0 || x > n) return 0;
  if (p === 0) return x === 0 ? 1 : 0;
  if (p === 1) return x === n ? 1 : 0;
  if (n <= 1000) {
    const c = nCr(n, x);
    if (Number.isFinite(c)) {
      const v = c * p ** x * (1 - p) ** (n - x);
      if (v > 1e-280) return v; // otherwise underflow may have eaten digits: use logs
    }
  }
  return Math.exp(lnChoose(n, x) + x * Math.log(p) + (n - x) * Math.log1p(-p));
}

// P(X ≤ x) = I₁₋ₚ(n − k, k + 1) for k = ⌊x⌋.
export function binomCdf(n, p, x) {
  if (!wholeNonNeg(n) || !(p >= 0 && p <= 1) || Number.isNaN(x)) return NaN;
  const k = Math.floor(x);
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p === 0) return 1;
  if (p === 1) return 0;
  return betaInc(n - k, k + 1, 1 - p);
}

// P(a ≤ X ≤ b) for whole numbers between a and b.
export function binomInterval(n, p, a, b) {
  if (!wholeNonNeg(n) || !(p >= 0 && p <= 1) || Number.isNaN(a) || Number.isNaN(b)) return NaN;
  const lo = Math.ceil(a);
  const hi = Math.floor(b);
  if (hi < lo) return 0;
  // Upper tail: P(X ≥ lo) − P(X > hi), each from the beta function directly.
  const upper = (m) => (m <= 0 ? 1 : m > n ? 0 : p === 0 ? 0 : p === 1 ? 1 : betaInc(m, n - m + 1, p)); // P(X ≥ m)
  if (lo > n * p) return upper(lo) - upper(hi + 1);
  return binomCdf(n, p, hi) - binomCdf(n, p, lo - 1);
}

// ---- Poisson ----------------------------------------------------------------------------

export function poissonPdf(mu, x) {
  if (!(mu >= 0) || !Number.isFinite(mu) || Number.isNaN(x)) return NaN;
  if (!Number.isInteger(x) || x < 0) return 0;
  if (mu === 0) return x === 0 ? 1 : 0;
  return Math.exp(x * Math.log(mu) - mu - lnGamma(x + 1));
}

// P(X ≤ x) = Q(k + 1, μ) for k = ⌊x⌋.
export function poissonCdf(mu, x) {
  if (!(mu >= 0) || !Number.isFinite(mu) || Number.isNaN(x)) return NaN;
  const k = Math.floor(x);
  if (k < 0) return 0;
  if (mu === 0 || k === Infinity) return 1;
  return gammaQ(k + 1, mu);
}

export function poissonInterval(mu, a, b) {
  if (!(mu >= 0) || !Number.isFinite(mu) || Number.isNaN(a) || Number.isNaN(b)) return NaN;
  const lo = Math.ceil(a);
  const hi = Math.floor(b);
  if (hi < lo) return 0;
  const upper = (m) => (m <= 0 ? 1 : mu === 0 ? 0 : gammaP(m, mu)); // P(X ≥ m)
  if (lo > mu) return upper(lo) - upper(hi + 1);
  return poissonCdf(mu, hi) - poissonCdf(mu, lo - 1);
}

// ---- the calculator's functions -----------------------------------------------------
// The forms each function accepts (D56):
//   normalpdf(x [, μ, σ])          normalcdf(x)  or  normalcdf(a, b [, μ [, σ]])
//   invnorm(p [, μ, σ])
//   tpdf(x, ν)                     tcdf(x, ν)  or  tcdf(a, b, ν)            invt(p, ν)
//   chi2pdf(x, k)                  chi2cdf(x, k)  or  chi2cdf(a, b, k)
//   binompdf(n, p, x)              binomcdf(n, p, x)  or  binomcdf(n, p, a, b)
//   poissonpdf(μ, x)               poissoncdf(μ, x)  or  poissoncdf(μ, a, b)
// A cdf given one limit is P(X ≤ x); given two it is P(a ≤ X ≤ b).

export const DISTRIBUTION_FUNCTIONS = {
  normalpdf: { arity: [1, 3], fn: (x, mu = 0, sigma = 1) => normalPdf(x, mu, sigma) },
  normalcdf: { arity: [1, 4], fn: (a, b, mu = 0, sigma = 1) => (b === undefined ? normalCdf(a) : normalInterval(a, b, mu, sigma)) },
  invnorm: { arity: [1, 3], fn: (p, mu = 0, sigma = 1) => invNorm(p, mu, sigma) },
  tpdf: { arity: [2, 2], fn: tPdf },
  tcdf: { arity: [2, 3], fn: (a, b, nu) => (nu === undefined ? tCdfAt(a, b) : tInterval(a, b, nu)) },
  invt: { arity: [2, 2], fn: invT },
  chi2pdf: { arity: [2, 2], fn: chi2Pdf },
  chi2cdf: { arity: [2, 3], fn: (a, b, k) => (k === undefined ? chi2Cdf(a, b) : chi2Interval(a, b, k)) },
  binompdf: { arity: [3, 3], fn: binomPdf },
  binomcdf: { arity: [3, 4], fn: (n, p, a, b) => (b === undefined ? binomCdf(n, p, a) : binomInterval(n, p, a, b)) },
  poissonpdf: { arity: [2, 2], fn: poissonPdf },
  poissoncdf: { arity: [2, 3], fn: (mu, a, b) => (b === undefined ? poissonCdf(mu, a) : poissonInterval(mu, a, b)) },
};

// Functions of a whole-number variable: graphs of them are drawn as stems.
export const DISCRETE_FUNCTIONS = new Set(['binompdf', 'binomcdf', 'poissonpdf', 'poissoncdf']);

// Σ f(k) over the whole numbers k with a ≤ k ≤ b: the "integral" of a discrete
// distribution's graph, e.g. P(2 ≤ X ≤ 5) from y = binompdf(10, 0.3, x).
export const MAX_SUM_TERMS = 1e6;
export function discreteSum(f, a, b) {
  const lo = Math.ceil(Math.min(a, b));
  const hi = Math.floor(Math.max(a, b));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ok: false, message: 'The range needs finite ends' };
  if (hi - lo + 1 > MAX_SUM_TERMS) return { ok: false, message: 'Too many whole numbers in this range (at most a million)' };
  let sum = 0;
  let c = 0; // Kahan compensation
  for (let k = lo; k <= hi; k++) {
    const v = f(k);
    if (!Number.isFinite(v)) return { ok: false, message: `Undefined at x = ${k}` };
    const y = v - c;
    const t = sum + y;
    c = t - sum - y;
    sum = t;
  }
  return { ok: true, value: b < a ? -sum : sum, terms: Math.max(0, hi - lo + 1), from: lo, to: hi };
}
