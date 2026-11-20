// Exact fractions with BigInt numerator and denominator (Phase 6c: exact Taylor
// coefficients). Pure module. Values are immutable and always in lowest terms with a
// positive denominator.

const gcd = (a, b) => {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) [a, b] = [b, a % b];
  return a;
};

export class Rational {
  constructor(p, q = 1n) {
    if (q === 0n) throw new RangeError('Zero denominator');
    if (q < 0n) {
      p = -p;
      q = -q;
    }
    const g = gcd(p, q) || 1n;
    this.p = p / g;
    this.q = q / g;
  }

  static int(n) { return new Rational(BigInt(n)); }

  // The exact value of a decimal string ("0.1", "-12.5e-3"), or null.
  static fromDecimal(text) {
    const m = /^(-?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(text).trim());
    if (!m || (!m[2] && !m[3])) return null;
    const digits = (m[2] || '') + (m[3] || '');
    let p = BigInt(digits || '0');
    let q = 10n ** BigInt((m[3] || '').length);
    const e = Number(m[4] || 0);
    if (Math.abs(e) > 400) return null;
    if (e > 0) p *= 10n ** BigInt(e);
    else if (e < 0) q *= 10n ** BigInt(-e);
    return new Rational(m[1] ? -p : p, q);
  }

  // The number a JavaScript number was written as: its shortest round-trip decimal
  // (0.1 → 1/10). Null for non-finite numbers.
  static fromNumber(v) {
    if (!Number.isFinite(v)) return null;
    return Rational.fromDecimal(String(v));
  }

  add(b) { return new Rational(this.p * b.q + b.p * this.q, this.q * b.q); }
  sub(b) { return new Rational(this.p * b.q - b.p * this.q, this.q * b.q); }
  mul(b) { return new Rational(this.p * b.p, this.q * b.q); }
  div(b) { return new Rational(this.p * b.q, this.q * b.p); }
  neg() { return new Rational(-this.p, this.q); }
  isZero() { return this.p === 0n; }
  isInteger() { return this.q === 1n; }
  sign() { return this.p > 0n ? 1 : this.p < 0n ? -1 : 0; }
  cmp(b) {
    const d = this.p * b.q - b.p * this.q;
    return d > 0n ? 1 : d < 0n ? -1 : 0;
  }
  equals(b) { return this.p === b.p && this.q === b.q; }
  floor() {
    let f = this.p / this.q; // truncates towards 0
    if (this.p < 0n && f * this.q !== this.p) f -= 1n;
    return new Rational(f);
  }

  // Close to the nearest double (exact for numbers that fit).
  toNumber() {
    const { p, q } = this;
    const n = Number(p);
    const d = Number(q);
    if (Number.isFinite(n) && Number.isFinite(d) && Math.abs(n) <= 2 ** 53 && d <= 2 ** 53) return n / d;
    // Scale both down to keep the leading digits.
    const shift = BigInt(Math.max(0, Math.max(p.toString().length, q.toString().length) - 300));
    const s = 10n ** shift;
    return Number(p / s) / Number(q / s);
  }

  toString() { return this.q === 1n ? this.p.toString() : `${this.p}/${this.q}`; }
}

// Whole-number n-th root of a non-negative BigInt, or null if it isn't a perfect power.
function intRoot(a, n) {
  if (a < 0n) return null;
  if (a < 2n) return a;
  // Newton's method from an over-estimate.
  let x = 1n << (BigInt(a.toString(2).length) / BigInt(n) + 1n);
  const N = BigInt(n);
  for (;;) {
    const y = ((N - 1n) * x + a / x ** (N - 1n)) / N;
    if (y >= x) break;
    x = y;
  }
  return x ** N === a ? x : null;
}

// The exact real n-th root of r (odd n allows negatives), or null if it isn't rational.
export function rationalRoot(r, n) {
  if (!Number.isInteger(n) || n < 1 || n > 64) return null;
  if (n === 1) return r;
  const neg = r.p < 0n;
  if (neg && n % 2 === 0) return null;
  const p = intRoot(neg ? -r.p : r.p, n);
  const q = intRoot(r.q, n);
  if (p === null || q === null) return null;
  return new Rational(neg ? -p : p, q);
}

// n! for a whole number n ≥ 0 (as a BigInt).
export function factorialBig(n) {
  let f = 1n;
  for (let k = 2n; k <= BigInt(n); k++) f *= k;
  return f;
}

// If q is exactly m! (m ≥ 2), m; otherwise null.
export function factorialOf(q) {
  if (q < 2n) return null;
  let f = 1n;
  for (let m = 2; m <= 1000; m++) {
    f *= BigInt(m);
    if (f === q) return m;
    if (f > q) return null;
  }
  return null;
}
