// Symbolic differentiation on the AST, with light simplification.
//
// derive(node, v, env) returns the AST of d(node)/dv.
//   env = {
//     angle: 'rad' | 'deg',
//     func(name) -> { params: [names], body } | undefined   user functions, inlined
//   }
// Every name other than v is treated as a constant (user variables, other parameters).
// Where there is no symbolic rule (gamma, nCr, ! and similar), the result contains an
// { type: 'nderiv', expr, v, at? } node (d expr/dv at v = at, default v itself),
// which compile.js evaluates numerically.
import { ExprError } from './errors.js';

const MAX_DEPTH = 60;

// ---- simplifying constructors --------------------------------------------------------
export const num = (value) => ({ type: 'num', value });
export const sym = (name) => ({ type: 'sym', name });
export const call = (name, ...args) => ({ type: 'call', name, args });
const bin = (op, left, right) => ({ type: 'bin', op, left, right });
const isNum = (n, v) => n.type === 'num' && (v === undefined || n.value === v);
const isRatio = (n) => n.type === 'bin' && n.op === '/' && isNum(n.left) && isNum(n.right)
  && Number.isInteger(n.left.value) && Number.isInteger(n.right.value) && n.right.value !== 0;
const isInt = (n) => isNum(n) && Number.isInteger(n.value);

// Structural equality of two ASTs (ignoring source positions).
export function equal(a, b) {
  if (a === b) return true;
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'num': return a.value === b.value;
    case 'sym': return a.name === b.name;
    case 'neg':
    case 'fact': return equal(a.arg, b.arg);
    case 'bin': return a.op === b.op && equal(a.left, b.left) && equal(a.right, b.right);
    case 'call':
    case 'apply':
      return a.name === b.name && (a.primes || 0) === (b.primes || 0) && a.args.length === b.args.length
        && a.args.every((x, i) => equal(x, b.args[i]));
    default: return false;
  }
}

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

// p/q as a reduced fraction node (q > 0).
function ratio(p, q) {
  if (q < 0) { p = -p; q = -q; }
  const g = gcd(p, q) || 1;
  p /= g;
  q /= g;
  if (q === 1) return num(p);
  return p < 0 ? neg(bin('/', num(-p), num(q))) : bin('/', num(p), num(q));
}

// Integer or p/q constant as [p, q], else null.
function asFraction(n) {
  if (isInt(n)) return [n.value, 1];
  if (isRatio(n)) return [n.left.value, n.right.value];
  if (n.type === 'neg') {
    const f = asFraction(n.arg);
    return f && [-f[0], f[1]];
  }
  return null;
}

// Split a leading integer coefficient: 6x -> [6, x], 4 -> [4, null], x -> [1, x].
function splitCoef(n) {
  if (isInt(n)) return [n.value, null];
  if (n.type === 'bin' && n.op === '*' && isInt(n.left)) return [n.left.value, n.right];
  return [1, n];
}

export function neg(a) {
  if (isNum(a)) return num(-a.value);
  if (a.type === 'neg') return a.arg;
  return { type: 'neg', arg: a };
}

export function add(a, b) {
  if (isNum(a, 0)) return b;
  if (isNum(b, 0)) return a;
  if (isNum(a) && isNum(b)) return num(a.value + b.value);
  const fa = asFraction(a);
  const fb = asFraction(b);
  if (fa && fb && (fa[1] !== 1 || fb[1] !== 1)) return ratio(fa[0] * fb[1] + fb[0] * fa[1], fa[1] * fb[1]);
  if (b.type === 'neg') return sub(a, b.arg);
  if (isNum(b) && b.value < 0) return sub(a, num(-b.value));
  return bin('+', a, b);
}

export function sub(a, b) {
  if (isNum(b, 0)) return a;
  if (isNum(a, 0)) return neg(b);
  if (isNum(a) && isNum(b)) return num(a.value - b.value);
  if (equal(a, b)) return num(0);
  const fa = asFraction(a);
  const fb = asFraction(b);
  if (fa && fb && (fa[1] !== 1 || fb[1] !== 1)) return ratio(fa[0] * fb[1] - fb[0] * fa[1], fa[1] * fb[1]);
  if (b.type === 'neg') return add(a, b.arg);
  if (isNum(b) && b.value < 0) return add(a, num(-b.value));
  return bin('-', a, b);
}

export function mul(a, b) {
  if (isNum(a, 0) || isNum(b, 0)) return num(0);
  if (isNum(a, 1)) return b;
  if (isNum(b, 1)) return a;
  if (isNum(a) && isNum(b)) return num(a.value * b.value);
  if (a.type === 'neg') return neg(mul(a.arg, b));
  if (b.type === 'neg') return neg(mul(a, b.arg));
  if (isNum(a) && a.value < 0) return neg(mul(num(-a.value), b));
  if (isNum(b)) return mul(b, a); // numbers first: 2x, not x·2
  // 2·(3x) -> 6x
  if (isNum(a) && b.type === 'bin' && b.op === '*' && isNum(b.left)) return mul(num(a.value * b.left.value), b.right);
  // a·(2x) -> 2(a·x)
  if (!isNum(a) && b.type === 'bin' && b.op === '*' && isNum(b.left)) return mul(b.left, mul(a, b.right));
  // (1/u)·w -> w/u,  (p/q)·w -> (p·w)/q
  if (a.type === 'bin' && a.op === '/' && isNum(a.left)) return div(mul(a.left, b), a.right);
  if (b.type === 'bin' && b.op === '/' && isNum(b.left)) return div(mul(b.left, a), b.right);
  if (equal(a, b)) return pow(a, num(2));
  return bin('*', a, b);
}

export function div(a, b) {
  if (isNum(a, 0)) return num(0);
  if (isNum(b, 1)) return a;
  if (isInt(a) && isInt(b) && b.value !== 0) return ratio(a.value, b.value);
  if (isNum(a) && isNum(b) && b.value !== 0 && Number.isInteger(a.value / b.value)) return num(a.value / b.value);
  if (a.type === 'neg') return neg(div(a.arg, b));
  if (b.type === 'neg') return neg(div(a, b.arg));
  if (equal(a, b)) return num(1);
  // Cancel common integer factors: 2x/(2y) -> x/y, 6x/4 -> 3x/2
  const [ka, ra] = splitCoef(a);
  const [kb, rb] = splitCoef(b);
  const g = gcd(ka, kb);
  if (g > 1 && Number.isFinite(g)) {
    const na = ra ? mul(num(ka / g), ra) : num(ka / g);
    const nb = rb ? mul(num(kb / g), rb) : num(kb / g);
    return div(na, nb);
  }
  return bin('/', a, b);
}

export function pow(a, b) {
  if (isNum(b, 1)) return a;
  if (isNum(b, 0)) return num(1);
  if (isNum(a) && isNum(b) && Number.isInteger(b.value) && b.value > 0 && Number.isInteger(a.value)) {
    const v = a.value ** b.value;
    if (Number.isSafeInteger(v)) return num(v);
  }
  return bin('^', a, b);
}

// ---- helpers ------------------------------------------------------------------------------

// {cond} or {c1, c2}: conditions only, no values and no "otherwise".
const isRestriction = (n) => n.type === 'piecewise' && !n.otherwise && n.branches.every((b) => !b.value);

// Does node depend on v? (User functions only see their arguments.)
export function dependsOn(node, v) {
  switch (node.type) {
    case 'num': return false;
    case 'sym': return node.name === v;
    case 'neg':
    case 'fact': return dependsOn(node.arg, v);
    case 'bin': return dependsOn(node.left, v) || dependsOn(node.right, v);
    case 'call': return node.args.some((a) => dependsOn(a, v));
    case 'apply': return node.name === v || node.args.some((a) => dependsOn(a, v));
    case 'piecewise':
      return node.branches.some((b) => dependsOn(b.cond, v) || (b.value && dependsOn(b.value, v)))
        || (!!node.otherwise && dependsOn(node.otherwise, v));
    case 'cmp': return node.items.some((a) => dependsOn(a, v));
    case 'series':
      return dependsOn(node.from, v) || dependsOn(node.to, v) || (node.index !== v && dependsOn(node.body, v));
    case 'tuple': return node.items.some((a) => dependsOn(a, v));
    case 'nderiv':
      return node.at ? dependsOn(node.at, v) || (node.v !== v && dependsOn(node.expr, v)) : dependsOn(node.expr, v);
    default: return true;
  }
}

// Replace names by ASTs (map: name -> node). Respects the counting letter of sum/prod.
export function substitute(node, map) {
  switch (node.type) {
    case 'num': return node;
    case 'sym': return Object.prototype.hasOwnProperty.call(map, node.name) ? map[node.name] : node;
    case 'neg':
    case 'fact': return { ...node, arg: substitute(node.arg, map) };
    case 'bin': return { ...node, left: substitute(node.left, map), right: substitute(node.right, map) };
    case 'call':
    case 'apply': return { ...node, args: node.args.map((a) => substitute(a, map)) };
    case 'tuple': return { ...node, items: node.items.map((a) => substitute(a, map)) };
    case 'cmp': return { ...node, items: node.items.map((a) => substitute(a, map)) };
    case 'piecewise':
      return {
        ...node,
        branches: node.branches.map((b) => ({ cond: substitute(b.cond, map), value: b.value && substitute(b.value, map) })),
        otherwise: node.otherwise && substitute(node.otherwise, map),
      };
    case 'series': {
      const inner = { ...map };
      delete inner[node.index];
      const [index, body] = avoidCapture(node.index, node.body, inner);
      return { ...node, index, from: substitute(node.from, map), to: substitute(node.to, map), body: substitute(body, inner) };
    }
    case 'nderiv': {
      // d/dv expr, evaluated at v = at. The expression keeps its own v; only `at`
      // and the other names are substituted.
      const inner = { ...map };
      delete inner[node.v];
      const [v, expr] = avoidCapture(node.v, node.expr, inner);
      return { ...node, v, expr: substitute(expr, inner), at: substitute(node.at ?? sym(node.v), map) };
    }
    default: return node;
  }
}

// A bound letter (sum's counting letter, d/dv's v) that a substituted value mentions
// would capture it: f(x) = sum(k x, k, 1, 3) called as f(k) must not become sum(k·k, …).
// Rename the bound letter first. Returns [name, body].
function avoidCapture(bound, body, map) {
  const captured = Object.entries(map).some(([name, value]) => dependsOn(body, name) && dependsOn(value, bound));
  if (!captured) return [bound, body];
  const values = Object.values(map);
  let k = 1;
  let fresh = `${bound}_${k}`;
  while (dependsOn(body, fresh) || values.some((v) => dependsOn(v, fresh))) fresh = `${bound}_${++k}`;
  return [fresh, substitute(body, { [bound]: sym(fresh) })];
}

// Inline a user-function call: f(u) -> body with the parameter replaced by u.
// With primes, the body is differentiated first: f'(u) -> f'(t)|t=u.
function inlineApply(node, env, depth) {
  const def = env.func ? env.func(node.name) : undefined;
  if (!def) return null;
  if (def.params.length !== node.args.length) {
    throw new ExprError(`${node.name} takes ${def.params.length} argument${def.params.length === 1 ? '' : 's'}`, node.start ?? -1, node.end ?? -1);
  }
  let body = def.body;
  if (node.primes) {
    if (def.params.length !== 1) {
      throw new ExprError(`${node.name}' needs a function of one variable`, node.start ?? -1, node.end ?? -1);
    }
    for (let k = 0; k < node.primes; k++) body = deriveNode(body, def.params[0], env, depth + 1);
  }
  const map = {};
  def.params.forEach((p, k) => { map[p] = node.args[k]; });
  return substitute(body, map);
}

// ---- differentiation ------------------------------------------------------------------------

export function derive(node, v, env = {}) {
  return deriveNode(node, v, env, 0);
}

function deriveNode(node, v, env, depth) {
  if (depth > MAX_DEPTH) throw new ExprError('This expression is too deeply nested to differentiate', -1, -1);
  if (!dependsOn(node, v)) return num(0);
  const d = (n) => deriveNode(n, v, env, depth + 1);
  const numeric = () => ({ type: 'nderiv', expr: node, v });
  const deg = env.angle === 'deg';

  switch (node.type) {
    case 'sym': return num(node.name === v ? 1 : 0);
    case 'neg': return neg(d(node.arg));

    case 'bin': {
      const { op, left: a, right: b } = node;
      if (op === '+') return add(d(a), d(b));
      if (op === '-') return sub(d(a), d(b));
      if (op === '*') {
        // A restriction {cond} is 1 where it holds and undefined elsewhere: it just carries over.
        if (isRestriction(b)) return mul(d(a), b);
        if (isRestriction(a)) return mul(a, d(b));
        return add(mul(d(a), b), mul(a, d(b)));
      }
      if (op === '/') {
        if (!dependsOn(b, v)) return div(d(a), b);
        return div(sub(mul(d(a), b), mul(a, d(b))), pow(b, num(2)));
      }
      if (op === '^') {
        const da = dependsOn(a, v);
        const db = dependsOn(b, v);
        if (!db) return mul(mul(b, pow(a, sub(b, num(1)))), d(a));
        if (!da) {
          if (a.type === 'sym' && a.name === 'e') return mul(node, d(b));
          return mul(mul(node, call('ln', a)), d(b));
        }
        // a^b = e^(b ln a): (a^b)(b' ln a + b a'/a)
        return mul(node, add(mul(d(b), call('ln', a)), div(mul(b, d(a)), a)));
      }
      return numeric();
    }

    case 'call': return deriveCall(node, d, numeric, deg);

    case 'apply': {
      const inlined = inlineApply(node, env, depth);
      if (inlined) return d(inlined);
      // Not a function: name(u) is a multiplication.
      if (node.args.length !== 1) return numeric();
      return d(bin('*', sym(node.name), node.args[0]));
    }

    case 'piecewise':
      return {
        type: 'piecewise',
        branches: node.branches.map((br) => ({ cond: br.cond, value: br.value ? d(br.value) : num(0) })),
        otherwise: node.otherwise ? d(node.otherwise) : null,
      };

    case 'series':
      if (node.index === v || node.op !== 'sum') return node.op === 'sum' ? num(0) : numeric();
      return { ...node, body: d(node.body) };

    default:
      return numeric();
  }
}

const DEG = () => div(sym('π'), num(180));
const RAD = () => div(num(180), sym('π'));

function deriveCall(node, d, numeric, deg) {
  const [u, w] = node.args;
  const n = node.args.length;
  const chain = (outer) => mul(outer, d(u));
  const trig = (outer) => chain(deg ? mul(DEG(), outer) : outer);
  const invTrig = (outer) => chain(deg ? mul(RAD(), outer) : outer);
  const one = num(1);
  const two = num(2);
  // Are the arguments from index k on constant (in the variable being differentiated)?
  const constFrom = (k) => node.args.slice(k).every((a) => isNum(d(a), 0));
  switch (node.name) {
    case 'sin': return trig(call('cos', u));
    case 'cos': return trig(neg(call('sin', u)));
    case 'tan': return trig(pow(call('sec', u), two));
    case 'sec': return trig(mul(call('sec', u), call('tan', u)));
    case 'csc': return trig(neg(mul(call('csc', u), call('cot', u))));
    case 'cot': return trig(neg(pow(call('csc', u), two)));
    case 'asin': return invTrig(div(one, call('sqrt', sub(one, pow(u, two)))));
    case 'acos': return invTrig(neg(div(one, call('sqrt', sub(one, pow(u, two))))));
    case 'atan': return invTrig(div(one, add(one, pow(u, two))));
    case 'sinh': return chain(call('cosh', u));
    case 'cosh': return chain(call('sinh', u));
    case 'tanh': return chain(sub(one, pow(call('tanh', u), two)));
    case 'asinh': return chain(div(one, call('sqrt', add(pow(u, two), one))));
    case 'acosh': return chain(div(one, call('sqrt', sub(pow(u, two), one))));
    case 'atanh': return chain(div(one, sub(one, pow(u, two))));
    case 'exp': return chain(node);
    case 'ln': return div(d(u), u);
    case 'log':
      if (n === 1) return div(d(u), mul(u, call('ln', num(10))));
      return d(div(call('ln', u), call('ln', w)));
    case 'sqrt': return div(d(u), mul(two, node));
    case 'cbrt': return div(d(u), mul(num(3), pow(node, two)));
    case 'abs': return chain(call('sign', u));
    case 'floor':
    case 'ceil':
    case 'round':
    case 'sign':
      return num(0);
    case 'mod': return sub(d(u), mul(d(w), call('floor', div(u, w))));
    // Probability distributions (Phase 7b), with constant parameters; otherwise the
    // derivative is numeric. φ′ = −(u − μ)/σ² · φ; a cdf's derivative is its pdf; an
    // inverse cdf's is 1 / pdf at the quantile.
    case 'normalpdf': {
      if (!constFrom(1)) return numeric();
      const mu = node.args[1] || num(0);
      const s = node.args[2] || one;
      return mul(neg(div(sub(u, mu), pow(s, two))), mul(node, d(u)));
    }
    case 'normalcdf': {
      if (n === 1) return mul(call('normalpdf', u), d(u));
      if (!constFrom(2)) return numeric();
      const params = node.args.slice(2);
      return sub(mul(call('normalpdf', w, ...params), d(w)), mul(call('normalpdf', u, ...params), d(u)));
    }
    case 'invnorm':
      if (!constFrom(1)) return numeric();
      return div(d(u), call('normalpdf', node, ...node.args.slice(1)));
    case 'tpdf':
      if (!constFrom(1)) return numeric();
      return mul(neg(div(mul(add(w, one), u), add(w, pow(u, two)))), mul(node, d(u)));
    case 'tcdf': {
      if (n === 2) return constFrom(1) ? mul(call('tpdf', u, w), d(u)) : numeric();
      if (!constFrom(2)) return numeric();
      const nu = node.args[2];
      return sub(mul(call('tpdf', w, nu), d(w)), mul(call('tpdf', u, nu), d(u)));
    }
    case 'invt':
      if (!constFrom(1)) return numeric();
      return div(d(u), call('tpdf', node, w));
    case 'chi2pdf':
      if (!constFrom(1)) return numeric();
      return mul(sub(div(sub(div(w, two), one), u), div(one, two)), mul(node, d(u)));
    case 'chi2cdf': {
      if (n === 2) return constFrom(1) ? mul(call('chi2pdf', u, w), d(u)) : numeric();
      if (!constFrom(2)) return numeric();
      const k = node.args[2];
      return sub(mul(call('chi2pdf', w, k), d(w)), mul(call('chi2pdf', u, k), d(u)));
    }
    case 'min':
    case 'max':
      if (n === 1) return d(u);
      if (n === 2) {
        const cond = { type: 'cmp', ops: [node.name === 'min' ? '<' : '>'], items: [u, w] };
        return { type: 'piecewise', branches: [{ cond, value: d(u) }], otherwise: d(w) };
      }
      return numeric();
    default:
      return numeric();
  }
}
