// Taylor polynomials (Phase 6b). Pure – no DOM access.
//
// taylor(ast, env, x0, n): the Taylor polynomial of degree n about x0 of the expression
// `ast` in x. env is the analysis: { compileIn, functionDef, derivativeAst, angle }.
// Returns { ok: true, coeffs } with coeffs[k] = f⁽ᵏ⁾(x0) / k!, so
// P(x) = Σ coeffs[k]·(x − x0)^k, or { ok: false, reason } when there is none:
//   'numeric'   a part has no exact derivative (gamma, nCr, nPr, !, a numerical d/dx),
//               Q8; `name` says which ('gamma', 'nCr', '!' or null)
//   'undefined' f or one of its derivatives is undefined at x0 (ln x at 0, √x at 0,
//               |x| at 0, a jump of floor or of a piecewise function); `order` is the
//               first that fails, as far as is known
//   'complex'   too much work (a Σ with very many terms)
//
// How: Taylor-mode differentiation. Every part of the expression is worked out as a
// truncated power series in (x − x0) – n + 1 coefficients – using the standard
// recurrences for products, quotients, powers, exp, ln, sin/cos and so on, and for
// inverse functions by integrating their derivative. It is exact up to rounding and
// costs O(n²) per operation. (Repeated symbolic derivatives, the plan in 7.1, grow
// exponentially: the 10th derivative of 1/(1 + x²) has millions of terms – D52.)
import { FUNCTIONS } from './builtins.js';
import { realPow } from '../numerics/special.js';
import { lnGamma } from '../numerics/stats.js';
import { normalCdf, tCdfAt, chi2Cdf } from '../numerics/distributions.js';

export const TAYLOR_MAX_DEGREE = 10;
const MAX_SERIES_TERMS = 10000;
const DISPLAY = {
  ncr: 'nCr', npr: 'nPr', invnorm: 'invNorm', invt: 'invT', binompdf: 'binompdf', binomcdf: 'binomcdf',
  poissonpdf: 'poissonpdf', poissoncdf: 'poissoncdf',
};

class NoSeries extends Error {
  constructor(reason, extra = {}) {
    super(reason);
    this.reason = reason;
    this.info = extra;
  }
}

export function taylor(ast, env, x0, n) {
  if (!Number.isInteger(n) || n < 0 || n > TAYLOR_MAX_DEGREE) throw new RangeError(`degree must be 0 to ${TAYLOR_MAX_DEGREE}`);
  if (!Number.isFinite(x0)) return { ok: false, reason: 'undefined', order: 0 };
  try {
    const s = new SeriesEval(env, x0, n).eval(ast, new Map());
    if (!s.every(Number.isFinite)) {
      return { ok: false, reason: 'undefined', order: s.findIndex((v) => !Number.isFinite(v)) };
    }
    return { ok: true, coeffs: s };
  } catch (e) {
    if (e instanceof NoSeries) {
      const out = { ok: false, reason: e.reason };
      if (e.info && 'name' in e.info) out.name = e.info.name;
      if (e.info && 'order' in e.info) out.order = e.info.order;
      return out;
    }
    return { ok: false, reason: 'complex' };
  }
}

class SeriesEval {
  constructor(env, x0, n) {
    this.env = env;
    this.x0 = x0;
    this.n = n;
    this.deg = env.angle === 'deg';
  }

  // ---- basic series ------------------------------------------------------------------------
  zeros() { return new Array(this.n + 1).fill(0); }
  const(v) {
    const s = this.zeros();
    s[0] = v;
    return s;
  }
  isConst(a) {
    for (let k = 1; k <= this.n; k++) if (a[k] !== 0) return false;
    return true;
  }
  undefinedAt(order) { return new NoSeries('undefined', { order }); }
  add(a, b) { return a.map((v, k) => v + b[k]); }
  sub(a, b) { return a.map((v, k) => v - b[k]); }
  scale(a, c) { return a.map((v) => v * c); }
  mul(a, b) {
    const r = this.zeros();
    for (let k = 0; k <= this.n; k++) {
      let s = 0;
      for (let j = 0; j <= k; j++) s += a[j] * b[k - j];
      r[k] = s;
    }
    return r;
  }
  div(a, b) {
    if (b[0] === 0) {
      if (this.isConst(b)) throw this.undefinedAt(0);
      throw this.undefinedAt(a[0] === 0 ? 1 : 0);
    }
    const r = this.zeros();
    for (let k = 0; k <= this.n; k++) {
      let s = a[k];
      for (let j = 0; j < k; j++) s -= r[j] * b[k - j];
      r[k] = s / b[0];
    }
    return r;
  }
  // The derivative's coefficients (the last is lost to truncation, and never needed).
  deriv(a) {
    const r = this.zeros();
    for (let k = 0; k < this.n; k++) r[k] = (k + 1) * a[k + 1];
    return r;
  }
  // The series with value v0 at x0 whose derivative has series g.
  integral(v0, g) {
    const r = this.zeros();
    r[0] = v0;
    for (let k = 1; k <= this.n; k++) r[k] = g[k - 1] / k;
    return r;
  }
  exp(a) {
    const r = this.zeros();
    r[0] = Math.exp(a[0]);
    for (let k = 1; k <= this.n; k++) {
      let s = 0;
      for (let j = 1; j <= k; j++) s += j * a[j] * r[k - j];
      r[k] = s / k;
    }
    return r;
  }
  ln(a) {
    if (!(a[0] > 0)) throw this.undefinedAt(0);
    const r = this.zeros();
    r[0] = Math.log(a[0]);
    for (let k = 1; k <= this.n; k++) {
      let s = 0;
      for (let j = 1; j < k; j++) s += j * r[j] * a[k - j];
      r[k] = (a[k] - s / k) / a[0];
    }
    return r;
  }
  // a^r for a constant r.
  powConst(a, p) {
    if (p === 0) return this.const(1);
    if (a[0] === 0) {
      if (this.isConst(a)) return this.const(realPow(0, p));
      if (Number.isInteger(p) && p > 0 && p <= 64) {
        let result = this.const(1);
        let base = a;
        for (let e = p; e > 0; e >>= 1) {
          if (e & 1) result = this.mul(result, base);
          if (e > 1) base = this.mul(base, base);
        }
        return result;
      }
      throw this.undefinedAt(p > 0 ? 1 : 0);
    }
    const c0 = realPow(a[0], p);
    if (!Number.isFinite(c0)) throw this.undefinedAt(0);
    // From a·c′ = p·a′·c.
    const r = this.zeros();
    r[0] = c0;
    for (let k = 1; k <= this.n; k++) {
      let s = 0;
      for (let j = 1; j <= k; j++) s += ((p + 1) * j - k) * a[j] * r[k - j];
      r[k] = s / (k * a[0]);
    }
    return r;
  }
  pow(a, b) {
    if (this.isConst(b)) return this.powConst(a, b[0]);
    if (!(a[0] > 0)) throw this.undefinedAt(0);
    return this.exp(this.mul(b, this.ln(a)));
  }
  sinCos(a) {
    const s = this.zeros();
    const c = this.zeros();
    s[0] = Math.sin(a[0]);
    c[0] = Math.cos(a[0]);
    for (let k = 1; k <= this.n; k++) {
      let ss = 0;
      let cs = 0;
      for (let j = 1; j <= k; j++) {
        ss += j * a[j] * c[k - j];
        cs += j * a[j] * s[k - j];
      }
      s[k] = ss / k;
      c[k] = -cs / k;
    }
    return [s, c];
  }
  sinhCosh(a) {
    const s = this.zeros();
    const c = this.zeros();
    s[0] = Math.sinh(a[0]);
    c[0] = Math.cosh(a[0]);
    for (let k = 1; k <= this.n; k++) {
      let ss = 0;
      let cs = 0;
      for (let j = 1; j <= k; j++) {
        ss += j * a[j] * c[k - j];
        cs += j * a[j] * s[k - j];
      }
      s[k] = ss / k;
      c[k] = cs / k;
    }
    return [s, c];
  }
  // A function that is constant near x0 except at jumps (floor, sign …): the value, if
  // x0 isn't at a jump of a moving argument.
  stepFn(a, value, atJump) {
    if (!this.isConst(a) && atJump(a[0])) throw this.undefinedAt(0);
    return this.const(value(a[0]));
  }

  // ---- the expression ------------------------------------------------------------------------
  eval(node, bound) {
    switch (node.type) {
      case 'num': return this.const(node.value);
      case 'sym': {
        if (bound.has(node.name)) return bound.get(node.name);
        if (node.name === 'x') {
          const s = this.const(this.x0);
          if (this.n >= 1) s[1] = 1;
          return s;
        }
        return this.const(this.env.compileIn(node, [])([]));
      }
      case 'neg': return this.scale(this.eval(node.arg, bound), -1);
      case 'bin': {
        const a = this.eval(node.left, bound);
        const b = this.eval(node.right, bound);
        switch (node.op) {
          case '+': return this.add(a, b);
          case '-': return this.sub(a, b);
          case '*': return this.mul(a, b);
          case '/': return this.div(a, b);
          case '^': return this.pow(a, b);
          default: throw new NoSeries('complex');
        }
      }
      case 'fact': {
        const a = this.eval(node.arg, bound);
        if (this.n === 0 || this.isConst(a)) return this.const(this.constValue(node, bound));
        throw new NoSeries('numeric', { name: '!' });
      }
      case 'call': return this.call(node, bound);
      case 'apply': return this.apply(node, bound);
      case 'piecewise': return this.piecewise(node, bound);
      case 'series': return this.seriesNode(node, bound);
      case 'nderiv': throw new NoSeries('numeric', { name: null });
      default: throw new NoSeries('complex');
    }
  }

  // The plain value of a node at x0 (for parts with no derivative, at degree 0).
  constValue(node, bound) {
    const names = [...bound.keys()];
    const frame = names.map((k) => bound.get(k)[0]);
    const slots = names.includes('x') ? names : [...names, 'x'];
    if (!names.includes('x')) frame.push(this.x0);
    return this.env.compileIn(node, slots)(frame);
  }

  call(node, bound) {
    const name = node.name;
    const args = node.args.map((a) => this.eval(a, bound));
    const a = args[0];
    const R2D = 180 / Math.PI;
    const toRad = (s) => (this.deg ? this.scale(s, Math.PI / 180) : s);
    const fixValue = (s, v) => {
      s[0] = v;
      return s;
    };
    const impl = FUNCTIONS[name];
    const v0 = () => (this.deg ? impl.deg : impl.rad)(...args.map((s) => s[0]));
    switch (name) {
      case 'sin': return fixValue(this.sinCos(toRad(a))[0], v0());
      case 'cos': return fixValue(this.sinCos(toRad(a))[1], v0());
      case 'tan': {
        const [s, c] = this.sinCos(toRad(a));
        return fixValue(this.div(s, c), v0());
      }
      case 'sec': return this.div(this.const(1), this.sinCos(toRad(a))[1]);
      case 'csc': return this.div(this.const(1), this.sinCos(toRad(a))[0]);
      case 'cot': {
        const [s, c] = this.sinCos(toRad(a));
        return this.div(c, s);
      }
      case 'asin':
      case 'acos': {
        if (!(Math.abs(a[0]) <= 1)) throw this.undefinedAt(0);
        if (Math.abs(a[0]) === 1 && !this.isConst(a)) throw this.undefinedAt(1);
        const g = this.mul(this.deriv(a), this.powConst(this.sub(this.const(1), this.mul(a, a)), -0.5));
        const r = this.integral(Math[name](a[0]), name === 'asin' ? g : this.scale(g, -1));
        return this.deg ? this.scale(r, R2D) : r;
      }
      case 'atan': {
        const r = this.integral(Math.atan(a[0]), this.div(this.deriv(a), this.add(this.const(1), this.mul(a, a))));
        return this.deg ? this.scale(r, R2D) : r;
      }
      case 'sinh': return this.sinhCosh(a)[0];
      case 'cosh': return this.sinhCosh(a)[1];
      case 'tanh': {
        const [s, c] = this.sinhCosh(a);
        return this.div(s, c);
      }
      case 'asinh':
        return this.integral(Math.asinh(a[0]), this.mul(this.deriv(a), this.powConst(this.add(this.mul(a, a), this.const(1)), -0.5)));
      case 'acosh':
        if (!(a[0] >= 1)) throw this.undefinedAt(0);
        if (a[0] === 1 && !this.isConst(a)) throw this.undefinedAt(1);
        return this.integral(Math.acosh(a[0]), this.mul(this.deriv(a), this.powConst(this.sub(this.mul(a, a), this.const(1)), -0.5)));
      case 'atanh':
        if (!(Math.abs(a[0]) < 1)) throw this.undefinedAt(0);
        return this.integral(Math.atanh(a[0]), this.div(this.deriv(a), this.sub(this.const(1), this.mul(a, a))));
      case 'exp': return this.exp(a);
      case 'ln': return this.ln(a);
      case 'log':
        if (args.length === 1) return this.scale(this.ln(a), 1 / Math.LN10);
        return this.div(this.ln(a), this.ln(args[1]));
      case 'sqrt': return this.powConst(a, 0.5);
      case 'cbrt': return this.powConst(a, 1 / 3);
      case 'abs':
        if (a[0] === 0 && !this.isConst(a)) throw this.undefinedAt(1);
        return a[0] < 0 ? this.scale(a, -1) : a;
      case 'sign': return this.stepFn(a, Math.sign, (v) => v === 0);
      case 'floor': return this.stepFn(a, Math.floor, Number.isInteger);
      case 'ceil': return this.stepFn(a, Math.ceil, Number.isInteger);
      case 'round': {
        if (args.length === 2 && !this.isConst(args[1])) throw new NoSeries('complex');
        const f = args.length === 2 ? 10 ** Math.round(args[1][0]) : 1;
        return this.stepFn(a, (v) => Math.round(v * f) / f, (v) => Number.isInteger(v * f - 0.5));
      }
      case 'min':
      case 'max': {
        const pick = name === 'min' ? Math.min : Math.max;
        const best = pick(...args.map((s) => s[0]));
        const winners = args.filter((s) => s[0] === best);
        // A tie between parts that move apart is a corner.
        if (winners.some((s) => s.some((v, k) => v !== winners[0][k]))) throw this.undefinedAt(1);
        return winners[0];
      }
      case 'mod': {
        const [u, w] = args;
        const q = u[0] / w[0];
        if (!Number.isFinite(q)) throw this.undefinedAt(0);
        if (Number.isInteger(q) && !(this.isConst(u) && this.isConst(w))) throw this.undefinedAt(0);
        return this.sub(u, this.scale(w, Math.floor(q)));
      }
      case 'gamma':
      case 'ncr':
      case 'npr':
      case 'invnorm':
      case 'invt':
      case 'binompdf':
      case 'binomcdf':
      case 'poissonpdf':
      case 'poissoncdf':
        if (this.n === 0 || args.every((s) => this.isConst(s))) return this.const(v0());
        throw new NoSeries('numeric', { name: DISPLAY[name] || name });
      case 'normalpdf':
      case 'normalcdf':
      case 'tpdf':
      case 'tcdf':
      case 'chi2pdf':
      case 'chi2cdf':
        return this.distribution(name, args, v0);
      default:
        throw new NoSeries('complex');
    }
  }

  // Continuous distributions with constant parameters (Phase 7b): the pdf from exp and
  // powers, the cdf by integrating the pdf along its argument. Discrete distributions and
  // non-constant parameters have no series here.
  distribution(name, args, v0) {
    // Where the parameters start: after x for a pdf; after x, or after a and b, for a cdf
    // (normalcdf(x), normalcdf(a, b, μ, σ); tcdf(x, ν), tcdf(a, b, ν); chi2cdf likewise).
    let firstParam = 1;
    if (name === 'normalcdf') firstParam = args.length === 1 ? 1 : 2;
    else if (name.endsWith('cdf')) firstParam = args.length === 2 ? 1 : 2;
    if (!args.slice(firstParam).every((s) => this.isConst(s))) throw new NoSeries('numeric', { name });
    const p = args.slice(firstParam).map((s) => s[0]);
    const family = name.startsWith('normal') ? 'normal' : name.startsWith('chi2') ? 'chi2' : 't';
    // pdf(u) as a series, for the parameters p.
    const pdf = (u) => {
      if (family === 'normal') {
        const mu = p[0] ?? 0;
        const s = p[1] ?? 1;
        if (!(s > 0)) throw this.undefinedAt(0);
        const z = this.scale(this.sub(u, this.const(mu)), 1 / s);
        return this.scale(this.exp(this.scale(this.mul(z, z), -0.5)), 1 / (s * Math.sqrt(2 * Math.PI)));
      }
      if (family === 't') {
        const nu = p[0];
        if (!(nu > 0)) throw this.undefinedAt(0);
        const c = Math.exp(lnGamma((nu + 1) / 2) - lnGamma(nu / 2) - 0.5 * Math.log(nu * Math.PI));
        return this.scale(this.powConst(this.add(this.const(1), this.scale(this.mul(u, u), 1 / nu)), -(nu + 1) / 2), c);
      }
      const h = p[0] / 2;
      if (!(h > 0)) throw this.undefinedAt(0);
      if (!(u[0] > 0)) {
        if (this.isConst(u)) return this.const(u[0] < 0 ? 0 : NaN);
        throw this.undefinedAt(u[0] < 0 ? 1 : 0);
      }
      const c = Math.exp(-h * Math.LN2 - lnGamma(h));
      return this.scale(this.mul(this.powConst(u, h - 1), this.exp(this.scale(u, -0.5))), c);
    };
    const cdfAt = (v) => (family === 'normal' ? normalCdf(v, p[0] ?? 0, p[1] ?? 1) : family === 't' ? tCdfAt(v, p[0]) : chi2Cdf(v, p[0]));
    const cdf = (u) => {
      if (this.isConst(u)) return this.const(cdfAt(u[0]));
      return this.integral(cdfAt(u[0]), this.mul(this.deriv(u), pdf(u)));
    };
    if (name.endsWith('pdf')) return pdf(args[0]);
    const limits = args.slice(0, firstParam);
    const r = limits.length === 1 ? cdf(limits[0]) : this.sub(cdf(limits[1]), cdf(limits[0]));
    r[0] = v0(); // the value as the function itself works it out (tails kept accurate)
    return r;
  }

  // User functions: their bodies with the parameters bound to the argument series.
  // f′(x), f″(x): the body differentiated symbolically (a few times at most).
  apply(node, bound) {
    const def = this.env.functionDef(node.name);
    if (!def) throw new NoSeries('complex');
    let body = def.body;
    if (node.primes) {
      if (def.params.length !== 1) throw new NoSeries('complex');
      for (let k = 0; k < node.primes; k++) body = this.env.derivativeAst(body, def.params[0]);
    }
    const inner = new Map();
    def.params.forEach((p, k) => inner.set(p, this.eval(node.args[k], bound)));
    return this.eval(body, inner);
  }

  // The branch that holds at x0. On a boundary, the polynomial exists only if the
  // branches on either side agree there (to the degree asked for).
  piecewise(node, bound) {
    const from = (i) => {
      if (i === node.branches.length) {
        if (node.otherwise) return this.eval(node.otherwise, bound);
        throw this.undefinedAt(0);
      }
      const b = node.branches[i];
      const items = b.cond.items.map((it) => this.eval(it, bound));
      let state = 'true';
      for (let k = 0; k < b.cond.ops.length; k++) {
        const [p, q] = [items[k], items[k + 1]];
        const op = b.cond.ops[k];
        if (p[0] === q[0] && !p.every((v, j) => v === q[j])) {
          if (op === '<' || op === '>' || op === '<=' || op === '>=') state = state === 'false' ? 'false' : 'boundary';
          continue;
        }
        const ok = op === '<' ? p[0] < q[0] : op === '>' ? p[0] > q[0] : op === '<=' ? p[0] <= q[0] : p[0] >= q[0];
        if (!ok) state = 'false';
      }
      const value = () => (b.value ? this.eval(b.value, bound) : this.const(1));
      if (state === 'true') return value();
      if (state === 'false') return from(i + 1);
      const here = value();
      const rest = from(i + 1);
      if (here.every((v, k) => Math.abs(v - rest[k]) <= 1e-12 * Math.max(1, Math.abs(v)))) return here;
      throw this.undefinedAt(here[0] === rest[0] ? 1 : 0);
    };
    return from(0);
  }

  // Σ and Π with whole-number bounds that don't depend on x.
  seriesNode(node, bound) {
    const from = this.eval(node.from, bound);
    const to = this.eval(node.to, bound);
    if (!this.isConst(from) || !this.isConst(to)) throw new NoSeries('complex');
    const lo = Math.round(from[0]);
    const hi = Math.round(to[0]);
    if (hi - lo + 1 > MAX_SERIES_TERMS) throw new NoSeries('complex');
    const isProd = node.op === 'prod';
    let acc = this.const(isProd ? 1 : 0);
    for (let k = lo; k <= hi; k++) {
      const inner = new Map(bound);
      inner.set(node.index, this.const(k));
      const term = this.eval(node.body, inner);
      acc = isProd ? this.mul(acc, term) : this.add(acc, term);
    }
    return acc;
  }
}

export function evalTaylor(coeffs, x0, x) {
  const u = x - x0;
  let s = 0;
  for (let k = coeffs.length - 1; k >= 0; k--) s = s * u + coeffs[k];
  return s;
}

// A number as row text: 10 significant figures, plain decimals or ·10^k (never "e",
// which reads as the constant e).
export function numberText(v) {
  if (v === 0 || Object.is(v, -0)) return '0';
  const s = v.toPrecision(10);
  const [mant, exp] = s.split('e');
  const clean = (m) => (m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m);
  if (!exp) return clean(mant);
  const k = Number(exp);
  if (k >= -6 && k < 15) return clean(v.toFixed(Math.max(0, 9 - k)));
  return `${clean(mant)}*10^(${k})`;
}

// The polynomial as a row: y = c0 + c1(x − x0) + … with x0 = 0 giving powers of x.
// Coefficients that round to 0 (below 1e−12 of the largest) are left out.
export function taylorText(coeffs, x0) {
  const biggest = Math.max(...coeffs.map(Math.abs), 0);
  const u = x0 === 0 ? 'x' : x0 > 0 ? `(x - ${numberText(x0)})` : `(x + ${numberText(-x0)})`;
  const terms = [];
  coeffs.forEach((c, k) => {
    if (c === 0 || Math.abs(c) <= 1e-12 * biggest) return;
    const neg = c < 0;
    const mag = Math.abs(c);
    let t;
    if (k === 0) t = numberText(mag);
    else {
      const pow = k === 1 ? u : `${u}^${k}`;
      t = mag === 1 ? pow : `${numberText(mag)}${pow.startsWith('(') ? '' : ' '}${pow}`;
    }
    terms.push({ neg, t });
  });
  if (!terms.length) return 'y = 0';
  let text = `y = ${terms[0].neg ? '-' : ''}${terms[0].t}`;
  for (const { neg, t } of terms.slice(1)) text += ` ${neg ? '-' : '+'} ${t}`;
  return text;
}
