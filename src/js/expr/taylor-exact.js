// Exact Taylor coefficients (Phase 6c, D57). Pure – no DOM access.
//
// The same Taylor-mode series as taylor.js, but in exact fractions (BigInt numerator and
// denominator). It only goes as far as it can be certain: numbers as typed (0.1 is
// 1/10), sliders and other variables through their definitions, + − × ÷, whole-number
// and rational powers with exact roots, and functions only where their value at the
// point is rational – e^u, sin u, cos u, atan u … where u is 0 there, ln u where u is 1.
// Anything else (π, e, sin 1, √2, degrees mode, distributions, gamma at non-integers)
// throws Inexact, and the caller keeps the decimal coefficients alone. Nothing is ever
// guessed from a decimal.
import { Rational, rationalRoot, factorialBig } from '../numerics/rational.js';
import { parse } from './parser.js';

class Inexact extends Error {}

// The exact value of a number as typed. A double read from a decimal of at most 15
// significant digits always prints back as that decimal, so 0.1 is exactly 1/10; longer
// numbers may not be what was typed, so they don't count.
function typedNumber(v) {
  if (!Number.isFinite(v)) return null;
  const digits = String(Math.abs(v)).replace(/e.*$/i, '').replace('.', '').replace(/^0+/, '');
  if (digits.length > 15) return null;
  return Rational.fromNumber(v);
}
const inexact = () => new Inexact('not exact');

const ZERO = Rational.int(0);
const ONE = Rational.int(1);
const MAX_SERIES_TERMS = 10000;

// The exact series, or null if it can't be exact. x0 is a Rational.
export function exactSeries(ast, env, x0, n) {
  if (!x0) return null;
  try {
    return new ExactEval(env, x0, n).eval(ast, new Map());
  } catch (e) {
    if (e instanceof Inexact || e instanceof RangeError) return null;
    throw e;
  }
}

// The exact value of a field such as "1/3" or "a + 1/2" (no x), or null.
export function exactConstant(text, env) {
  if (!text || !text.trim()) return null;
  let ast;
  try {
    ast = parse(text);
  } catch {
    return null;
  }
  if (!ast || ast.type === 'eq' || ast.type === 'ineq') return null;
  try {
    const s = new ExactEval(env, null, 0).eval(ast.expr, new Map());
    return s[0];
  } catch (e) {
    if (e instanceof Inexact || e instanceof RangeError) return null;
    throw e;
  }
}

class ExactEval {
  constructor(env, x0, n) {
    this.env = env;
    this.x0 = x0;
    this.n = n;
    this.varDepth = 0;
    this.derived = false;
  }

  zeros() { return new Array(this.n + 1).fill(ZERO); }
  const(v) {
    const s = this.zeros();
    s[0] = v;
    return s;
  }
  isConst(a) {
    for (let k = 1; k <= this.n; k++) if (!a[k].isZero()) return false;
    return true;
  }
  add(a, b) { return a.map((v, k) => v.add(b[k])); }
  sub(a, b) { return a.map((v, k) => v.sub(b[k])); }
  scale(a, c) { return a.map((v) => v.mul(c)); }
  mul(a, b) {
    const r = this.zeros();
    for (let k = 0; k <= this.n; k++) {
      let s = ZERO;
      for (let j = 0; j <= k; j++) if (!a[j].isZero() && !b[k - j].isZero()) s = s.add(a[j].mul(b[k - j]));
      r[k] = s;
    }
    return r;
  }
  div(a, b) {
    if (b[0].isZero()) throw inexact(); // undefined there: the decimal pass reports it
    const r = this.zeros();
    for (let k = 0; k <= this.n; k++) {
      let s = a[k];
      for (let j = 0; j < k; j++) if (!r[j].isZero() && !b[k - j].isZero()) s = s.sub(r[j].mul(b[k - j]));
      r[k] = s.div(b[0]);
    }
    return r;
  }
  deriv(a) {
    const r = this.zeros();
    for (let k = 0; k < this.n; k++) r[k] = a[k + 1].mul(Rational.int(k + 1));
    return r;
  }
  integral(v0, g) {
    const r = this.zeros();
    r[0] = v0;
    for (let k = 1; k <= this.n; k++) r[k] = g[k - 1].div(Rational.int(k));
    return r;
  }
  // e^a, exact only where a is 0 at x0.
  exp(a) {
    if (!a[0].isZero()) throw inexact();
    const r = this.zeros();
    r[0] = ONE;
    for (let k = 1; k <= this.n; k++) {
      let s = ZERO;
      for (let j = 1; j <= k; j++) if (!a[j].isZero()) s = s.add(a[j].mul(r[k - j]).mul(Rational.int(j)));
      r[k] = s.div(Rational.int(k));
    }
    return r;
  }
  // ln a, exact only where a is 1 at x0.
  ln(a) {
    if (!a[0].equals(ONE)) throw inexact();
    const r = this.zeros();
    for (let k = 1; k <= this.n; k++) {
      let s = ZERO;
      for (let j = 1; j < k; j++) if (!r[j].isZero()) s = s.add(r[j].mul(a[k - j]).mul(Rational.int(j)));
      r[k] = a[k].sub(s.div(Rational.int(k)));
    }
    return r;
  }
  // a^p for an exact rational p, where a(x0)^p is rational.
  powConst(a, p) {
    if (p.isZero()) return this.const(ONE);
    if (p.isInteger() && a[0].isZero()) {
      const e = Number(p.p);
      if (e < 0 || e > 64) throw inexact();
      let result = this.const(ONE);
      let base = a;
      for (let k = e; k > 0; k >>= 1) {
        if (k & 1) result = this.mul(result, base);
        if (k > 1) base = this.mul(base, base);
      }
      return result;
    }
    if (a[0].isZero()) throw inexact();
    if (p.q > 64n || p.p > 1000n || p.p < -1000n) throw inexact();
    const root = rationalRoot(a[0], Number(p.q));
    if (!root) throw inexact();
    let c0 = ONE;
    const e = Number(p.p < 0n ? -p.p : p.p);
    for (let k = 0; k < e; k++) c0 = c0.mul(root);
    if (p.p < 0n) c0 = ONE.div(c0);
    // From a·c′ = p·a′·c.
    const r = this.zeros();
    r[0] = c0;
    const pp1 = p.add(ONE);
    for (let k = 1; k <= this.n; k++) {
      let s = ZERO;
      for (let j = 1; j <= k; j++) {
        if (a[j].isZero()) continue;
        s = s.add(pp1.mul(Rational.int(j)).sub(Rational.int(k)).mul(a[j]).mul(r[k - j]));
      }
      r[k] = s.div(Rational.int(k).mul(a[0]));
    }
    return r;
  }
  pow(a, b) {
    if (this.isConst(b)) return this.powConst(a, b[0]);
    return this.exp(this.mul(b, this.ln(a)));
  }
  sinCos(a) {
    if (!a[0].isZero()) throw inexact();
    const s = this.zeros();
    const c = this.zeros();
    c[0] = ONE;
    for (let k = 1; k <= this.n; k++) {
      let ss = ZERO;
      let cs = ZERO;
      for (let j = 1; j <= k; j++) {
        if (a[j].isZero()) continue;
        const ja = a[j].mul(Rational.int(j));
        ss = ss.add(ja.mul(c[k - j]));
        cs = cs.add(ja.mul(s[k - j]));
      }
      s[k] = ss.div(Rational.int(k));
      c[k] = cs.div(Rational.int(-k));
    }
    return [s, c];
  }
  sinhCosh(a) {
    if (!a[0].isZero()) throw inexact();
    const s = this.zeros();
    const c = this.zeros();
    c[0] = ONE;
    for (let k = 1; k <= this.n; k++) {
      let ss = ZERO;
      let cs = ZERO;
      for (let j = 1; j <= k; j++) {
        if (a[j].isZero()) continue;
        const ja = a[j].mul(Rational.int(j));
        ss = ss.add(ja.mul(c[k - j]));
        cs = cs.add(ja.mul(s[k - j]));
      }
      s[k] = ss.div(Rational.int(k));
      c[k] = cs.div(Rational.int(k));
    }
    return [s, c];
  }
  // A function constant near x0 (the decimal pass has already checked for jumps).
  step(v) { return this.const(v); }

  eval(node, bound) {
    switch (node.type) {
      case 'num': {
        // Inside a derivative body, numbers may have been folded in floating point
        // (0.1·3 → 0.30000000000000004), so only safe whole numbers are trusted there.
        if (this.derived && !Number.isSafeInteger(node.value)) throw inexact();
        const r = typedNumber(node.value);
        if (!r) throw inexact();
        return this.const(r);
      }
      case 'sym': {
        if (bound.has(node.name)) return bound.get(node.name);
        if (node.name === 'x') {
          if (!this.x0) throw inexact();
          const s = this.const(this.x0);
          if (this.n >= 1) s[1] = ONE;
          return s;
        }
        // A variable: through its definition (sliders are plain numbers). Constants
        // such as π and e have no definition and are irrational.
        const def = this.env.variableDef && this.env.variableDef(node.name);
        if (!def || this.varDepth > 50) throw inexact();
        this.varDepth++;
        try {
          const v = new ExactEval(this.env, null, 0).evalNested(def.body, this.varDepth);
          return this.const(v);
        } finally {
          this.varDepth--;
        }
      }
      case 'neg': return this.scale(this.eval(node.arg, bound), Rational.int(-1));
      case 'bin': {
        // e^u is exp(u), exact where u is 0 (e alone is irrational).
        if (node.op === '^' && node.left.type === 'sym' && node.left.name === 'e' && !bound.has('e')
          && !(this.env.variableDef && this.env.variableDef('e'))) {
          return this.exp(this.eval(node.right, bound));
        }
        const a = this.eval(node.left, bound);
        const b = this.eval(node.right, bound);
        switch (node.op) {
          case '+': return this.add(a, b);
          case '-': return this.sub(a, b);
          case '*': return this.mul(a, b);
          case '/': return this.div(a, b);
          case '^': return this.pow(a, b);
          default: throw inexact();
        }
      }
      case 'fact': {
        const a = this.eval(node.arg, bound);
        if (!this.isConst(a) || !a[0].isInteger() || a[0].sign() < 0 || a[0].p > 1000n) throw inexact();
        return this.const(new Rational(factorialBig(Number(a[0].p))));
      }
      case 'call': return this.call(node, bound);
      case 'apply': return this.apply(node, bound);
      case 'piecewise': return this.piecewise(node, bound);
      case 'series': return this.seriesNode(node, bound);
      default: throw inexact();
    }
  }

  evalNested(body, depth) {
    this.varDepth = depth;
    return this.eval(body, new Map())[0];
  }

  call(node, bound) {
    if (this.env.angle === 'deg' && ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan'].includes(node.name)) {
      throw inexact(); // π/180 appears
    }
    const args = node.args.map((a) => this.eval(a, bound));
    const a = args[0];
    const allIntegers = () => args.every((s) => this.isConst(s) && s[0].isInteger());
    switch (node.name) {
      case 'sin': return this.sinCos(a)[0];
      case 'cos': return this.sinCos(a)[1];
      case 'tan': {
        const [s, c] = this.sinCos(a);
        return this.div(s, c);
      }
      case 'sec': return this.div(this.const(ONE), this.sinCos(a)[1]);
      case 'csc': return this.div(this.const(ONE), this.sinCos(a)[0]);
      case 'cot': {
        const [s, c] = this.sinCos(a);
        return this.div(c, s);
      }
      case 'asin':
        if (!a[0].isZero()) throw inexact();
        return this.integral(ZERO, this.mul(this.deriv(a), this.powConst(this.sub(this.const(ONE), this.mul(a, a)), new Rational(-1n, 2n))));
      case 'atan':
        if (!a[0].isZero()) throw inexact();
        return this.integral(ZERO, this.div(this.deriv(a), this.add(this.const(ONE), this.mul(a, a))));
      case 'sinh': return this.sinhCosh(a)[0];
      case 'cosh': return this.sinhCosh(a)[1];
      case 'tanh': {
        const [s, c] = this.sinhCosh(a);
        return this.div(s, c);
      }
      case 'asinh':
        if (!a[0].isZero()) throw inexact();
        return this.integral(ZERO, this.mul(this.deriv(a), this.powConst(this.add(this.mul(a, a), this.const(ONE)), new Rational(-1n, 2n))));
      case 'atanh':
        if (!a[0].isZero()) throw inexact();
        return this.integral(ZERO, this.div(this.deriv(a), this.sub(this.const(ONE), this.mul(a, a))));
      case 'exp': return this.exp(a);
      case 'ln': return this.ln(a);
      case 'sqrt': return this.powConst(a, new Rational(1n, 2n));
      case 'cbrt': return this.powConst(a, new Rational(1n, 3n));
      case 'abs': return a[0].sign() < 0 ? this.scale(a, Rational.int(-1)) : a;
      case 'sign': return this.step(Rational.int(a[0].sign()));
      case 'floor': return this.step(a[0].floor());
      case 'ceil': return this.step(a[0].neg().floor().neg());
      case 'round': {
        // Half up, as Math.round.
        let f = ONE;
        if (args.length === 2) {
          if (!this.isConst(args[1]) || !args[1][0].isInteger()) throw inexact();
          const d = Number(args[1][0].p);
          if (Math.abs(d) > 300) throw inexact();
          f = d >= 0 ? new Rational(10n ** BigInt(d)) : new Rational(1n, 10n ** BigInt(-d));
        }
        return this.step(a[0].mul(f).add(new Rational(1n, 2n)).floor().div(f));
      }
      case 'min':
      case 'max': {
        let best = args[0];
        for (const s of args.slice(1)) {
          const c = s[0].cmp(best[0]);
          if (node.name === 'min' ? c < 0 : c > 0) best = s;
        }
        return best;
      }
      case 'mod': {
        const [u, w] = args;
        if (w[0].isZero()) throw inexact();
        return this.sub(u, this.scale(w, u[0].div(w[0]).floor()));
      }
      case 'gamma':
        if (!allIntegers() || a[0].sign() <= 0 || a[0].p > 1000n) throw inexact();
        return this.const(new Rational(factorialBig(Number(a[0].p) - 1)));
      case 'ncr':
      case 'npr': {
        if (!allIntegers()) throw inexact();
        const [nn, kk] = args.map((s) => s[0].p);
        if (nn < 0n || kk < 0n || kk > nn || nn > 1000n) {
          if (kk > nn && nn >= 0n && kk >= 0n) return this.const(ZERO);
          throw inexact();
        }
        let v = 1n;
        for (let i = 0n; i < kk; i++) v *= nn - i;
        if (node.name === 'ncr') v /= factorialBig(Number(kk));
        return this.const(new Rational(v));
      }
      default:
        throw inexact(); // distributions, log base 10, inverse functions away from 0 …
    }
  }

  apply(node, bound) {
    const def = this.env.functionDef(node.name);
    if (!def) throw inexact();
    let body = def.body;
    if (node.primes) {
      if (def.params.length !== 1) throw inexact();
      for (let k = 0; k < node.primes; k++) body = this.env.derivativeAst(body, def.params[0]);
    }
    const inner = new Map();
    def.params.forEach((p, k) => inner.set(p, this.eval(node.args[k], bound)));
    const was = this.derived;
    this.derived = was || !!node.primes;
    try {
      return this.eval(body, inner);
    } finally {
      this.derived = was;
    }
  }

  piecewise(node, bound) {
    const from = (i) => {
      if (i === node.branches.length) {
        if (node.otherwise) return this.eval(node.otherwise, bound);
        throw inexact();
      }
      const b = node.branches[i];
      const items = b.cond.items.map((it) => this.eval(it, bound));
      let state = 'true';
      for (let k = 0; k < b.cond.ops.length; k++) {
        const [p, q] = [items[k], items[k + 1]];
        const op = b.cond.ops[k];
        const c = p[0].cmp(q[0]);
        if (c === 0 && !p.every((v, j) => v.equals(q[j]))) {
          state = state === 'false' ? 'false' : 'boundary';
          continue;
        }
        const ok = op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
        if (!ok) state = 'false';
      }
      const value = () => (b.value ? this.eval(b.value, bound) : this.const(ONE));
      if (state === 'true') return value();
      if (state === 'false') return from(i + 1);
      const here = value();
      const rest = from(i + 1);
      if (here.every((v, k) => v.equals(rest[k]))) return here;
      throw inexact();
    };
    return from(0);
  }

  seriesNode(node, bound) {
    const from = this.eval(node.from, bound);
    const to = this.eval(node.to, bound);
    if (!this.isConst(from) || !this.isConst(to)) throw inexact();
    // The same rounding of the bounds as the compiled sum.
    const lo = Math.round(from[0].toNumber());
    const hi = Math.round(to[0].toNumber());
    if (hi - lo + 1 > MAX_SERIES_TERMS) throw inexact();
    const isProd = node.op === 'prod';
    let acc = this.const(isProd ? ONE : ZERO);
    for (let k = lo; k <= hi; k++) {
      const inner = new Map(bound);
      inner.set(node.index, this.const(Rational.int(k)));
      const term = this.eval(node.body, inner);
      acc = isProd ? this.mul(acc, term) : this.add(acc, term);
    }
    return acc;
  }
}
