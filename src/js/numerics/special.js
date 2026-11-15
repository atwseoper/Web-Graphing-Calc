// Special functions and careful real arithmetic helpers.

const LANCZOS_G = 7;
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

// Gamma function for real x (Lanczos approximation, ~15 significant digits).
export function gamma(x) {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return Infinity;
  if (Number.isInteger(x)) {
    if (x <= 0) return NaN; // poles
    if (x <= 171) {
      let r = 1;
      for (let i = 2; i < x; i++) r *= i;
      return r;
    }
    return Infinity;
  }
  if (x < 0.5) {
    // Reflection formula
    return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  }
  if (x > 171.7) return Infinity;
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * a;
}

export function factorial(n) {
  return gamma(n + 1);
}

export function nCr(n, r) {
  if (Number.isInteger(n) && Number.isInteger(r)) {
    if (r < 0 || n < 0 || r > n) return 0;
    r = Math.min(r, n - r);
    let result = 1;
    for (let i = 1; i <= r; i++) result = (result * (n - r + i)) / i;
    return Math.round(result) === result || result > 2 ** 53 ? result : Math.round(result);
  }
  return gamma(n + 1) / (gamma(r + 1) * gamma(n - r + 1));
}

export function nPr(n, r) {
  if (Number.isInteger(n) && Number.isInteger(r)) {
    if (r < 0 || n < 0 || r > n) return 0;
    let result = 1;
    for (let i = 0; i < r; i++) result *= n - i;
    return result;
  }
  return gamma(n + 1) / gamma(n - r + 1);
}

// Mathematical modulo: result has the sign of the divisor (mod(-1, 3) = 2).
export function mod(a, b) {
  if (b === 0) return NaN;
  const r = a % b;
  return r !== 0 && (r < 0) !== (b < 0) ? r + b : r;
}

// Best rational approximation p/q of x with q <= maxDen (continued fractions).
function rational(x, maxDen) {
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  let v = x;
  for (let i = 0; i < 32; i++) {
    const a = Math.floor(v);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    [h0, h1, k0, k1] = [h1, h2, k1, k2];
    const frac = v - a;
    if (frac < 1e-12) break;
    v = 1 / frac;
  }
  return [h1, k1];
}

// Real power: like Math.pow, but a negative base with a fractional exponent
// p/q (q odd) gives the real root, e.g. (-8)^(1/3) = -2, (-8)^(2/3) = 4.
export function realPow(a, b) {
  if (a >= 0 || Number.isInteger(b) || !Number.isFinite(b) || Number.isNaN(a)) return Math.pow(a, b);
  const [p, q] = rational(Math.abs(b), 99);
  if (q % 2 === 1 && Math.abs(Math.abs(b) - p / q) < 1e-12 * Math.max(1, Math.abs(b))) {
    const root = q === 3 ? Math.cbrt(-a) : Math.pow(-a, 1 / q);
    let mag = Math.pow(root, p);
    if (b < 0) mag = 1 / mag;
    return p % 2 === 1 ? -mag : mag;
  }
  return NaN;
}

const HALF_PI = Math.PI / 2;

// Distance of x from the nearest multiple of `period` (offset by `phase`), relative to |x|.
function nearMultiple(x, period, phase) {
  const k = Math.round((x - phase) / period);
  if (k === 0 && phase === 0) return false; // sin(tiny) is tiny, not zero
  return Math.abs(x - phase - k * period) <= 4e-16 * Math.max(1, Math.abs(x)) * 8;
}

// Trig with exact zeros at multiples of π (and π/2 for cos), so sin(π) shows as 0.
export function sinExact(x) {
  return nearMultiple(x, Math.PI, 0) ? 0 : Math.sin(x);
}
export function cosExact(x) {
  return nearMultiple(x, Math.PI, HALF_PI) ? 0 : Math.cos(x);
}
export function tanExact(x) {
  return nearMultiple(x, Math.PI, 0) ? 0 : Math.tan(x);
}

// Degree versions: reduce exactly in degrees first so sin(180°) = 0, cos(90°) = 0, tan(45°) = 1.
function reduceDeg(d) {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}
export function sinDeg(d) {
  const r = reduceDeg(d);
  if (r === 0 || r === 180) return 0;
  if (r === 90) return 1;
  if (r === 270) return -1;
  if (r === 30 || r === 150) return 0.5;
  if (r === 210 || r === 330) return -0.5;
  return Math.sin((r * Math.PI) / 180);
}
export function cosDeg(d) {
  return sinDeg(d + 90);
}
export function tanDeg(d) {
  const r = reduceDeg(d) % 180;
  if (r === 0) return 0;
  if (r === 90) return NaN;
  if (r === 45) return 1;
  if (r === 135) return -1;
  return Math.tan((r * Math.PI) / 180);
}

