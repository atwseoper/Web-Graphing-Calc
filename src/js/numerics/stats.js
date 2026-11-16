// Statistical distributions for fit reports. Pure module.
//
//   lnGamma(x)              log Γ(x), x > 0 (Lanczos, ~15 digits)
//   betaInc(a, b, x)        regularised incomplete beta I_x(a, b)
//   gammaP(a, x), gammaQ    regularised lower / upper incomplete gamma
//   tCdf(t, nu)             Student t distribution function
//   tQuantile(p, nu)        its inverse (e.g. tQuantile(0.975, 10) = 2.228…)
//   normalQuantile(p)       inverse standard normal
//   chi2Sf(x, nu)           P(χ² > x): the goodness-of-fit probability
// Continued fractions follow Numerical Recipes (modified Lentz).

const EPS = 1e-16;
const TINY = 1e-300;

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function lnGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function betaCf(a, b, x) {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

export function betaInc(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnFront = lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log1p(-x);
  const front = Math.exp(lnFront);
  if (x < (a + 1) / (a + b + 2)) return (front * betaCf(a, b, x)) / a;
  return 1 - (front * betaCf(b, a, 1 - x)) / b;
}

export function tCdf(t, nu) {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const x = nu / (nu + t * t);
  const tail = 0.5 * betaInc(nu / 2, 0.5, x); // P(T > |t|)
  return t >= 0 ? 1 - tail : tail;
}

// Standard normal quantile (Acklam's rational approximation, refined by one Halley step).
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  let x;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - lo) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  // Halley refinement with an accurate normal CDF from erfc.
  const e = 0.5 * erfc(-x / Math.SQRT2) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

// Complementary error function from the incomplete gamma function: erfc(z) = Q(½, z²).
function erfc(x) {
  const z = Math.abs(x);
  const r = z === 0 ? 1 : gammaQ(0.5, z * z);
  return x >= 0 ? r : 2 - r;
}

// Student t quantile: Newton's method on tCdf, from the normal quantile, with bisection
// as a safeguard.
export function tQuantile(p, nu) {
  if (!(p > 0 && p < 1) || !(nu > 0)) return NaN;
  if (p === 0.5) return 0;
  if (p < 0.5) return -tQuantile(1 - p, nu);
  if (nu === Infinity) return normalQuantile(p);
  let lo = 0;
  let hi = 1;
  while (tCdf(hi, nu) < p) {
    lo = hi;
    hi *= 2;
    if (hi > 1e300) return Infinity;
  }
  let x = Math.min(Math.max(normalQuantile(p), lo), hi);
  const lnC = lnGamma((nu + 1) / 2) - lnGamma(nu / 2) - 0.5 * Math.log(nu * Math.PI);
  for (let i = 0; i < 100; i++) {
    const f = tCdf(x, nu) - p;
    if (f > 0) hi = x;
    else lo = x;
    const pdf = Math.exp(lnC - ((nu + 1) / 2) * Math.log1p((x * x) / nu));
    let next = x - f / pdf;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - x) <= 1e-15 * Math.max(1, Math.abs(x))) return next;
    x = next;
  }
  return x;
}

// Regularised incomplete gamma functions.
export function gammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) return gammaSeries(a, x);
  return 1 - gammaCf(a, x);
}

export function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - gammaSeries(a, x);
  return gammaCf(a, x);
}

function gammaSeries(a, x) {
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 0; n < 10000; n++) {
    ap++;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

function gammaCf(a, x) {
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 10000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

export function chi2Sf(x, nu) {
  if (!(nu > 0)) return NaN;
  return gammaQ(nu / 2, x / 2);
}
