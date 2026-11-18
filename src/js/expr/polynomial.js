// Expands an AST into polynomial coefficients in one variable, when it is one.
//
// toPolynomial(node, v, env) -> ascending coefficients [c0, c1, …] or null.
//   env = {
//     value(node) -> number      evaluates a sub-expression that doesn't contain v
//     func(name) -> { params, body } | undefined   user functions, inlined
//     angle
//   }
// Handles + − × ÷ by constants, whole-number powers, user functions and their
// derivatives. Anything else in v (sin x, 1/x, √x) means "not a polynomial".
import { ExprError } from './errors.js';
import { dependsOn, substitute, derive } from './derive.js';

export const MAX_DEGREE = 100;

// A polynomial is { c, b }: ascending coefficients c, and for each one a bound b on the
// size of the terms that were added to make it. A coefficient far smaller than its bound
// is rounding left over from terms that cancel (0.1x² + 0.2x² − 0.3x²), not a real term.
const CANCEL_TOL = 64 * 2.220446049250313e-16;

function addP(p, q, sign = 1) {
  const n = Math.max(p.c.length, q.c.length);
  const c = new Array(n).fill(0);
  const b = new Array(n).fill(0);
  p.c.forEach((v, i) => { c[i] += v; b[i] += p.b[i]; });
  q.c.forEach((v, i) => { c[i] += sign * v; b[i] += q.b[i]; });
  return { c, b };
}

function mulP(p, q) {
  if (p.c.length + q.c.length - 2 > MAX_DEGREE) return null;
  const n = p.c.length + q.c.length - 1;
  const c = new Array(n).fill(0);
  const b = new Array(n).fill(0);
  for (let i = 0; i < p.c.length; i++) {
    if (p.c[i] === 0 && p.b[i] === 0) continue;
    for (let j = 0; j < q.c.length; j++) {
      c[i + j] += p.c[i] * q.c[j];
      b[i + j] += p.b[i] * q.b[j];
    }
  }
  return { c, b };
}

const constantP = (v) => ({ c: [v], b: [Math.abs(v)] });

export function toPolynomial(node, v, env) {
  const P = (n) => {
    if (!dependsOn(n, v)) return constantP(env.value(n));
    switch (n.type) {
      case 'sym':
        return { c: [0, 1], b: [0, 1] };
      case 'neg': {
        const a = P(n.arg);
        return a && { c: a.c.map((c) => -c), b: a.b };
      }
      case 'bin': {
        const a = P(n.left);
        if (!a) return null;
        if (n.op === '/') {
          if (dependsOn(n.right, v)) return null;
          const d = env.value(n.right);
          if (d === 0) throw new ExprError('Division by zero', n.right.start ?? -1, n.right.end ?? -1);
          return { c: a.c.map((c) => c / d), b: a.b.map((m) => m / Math.abs(d)) };
        }
        if (n.op === '^') {
          if (dependsOn(n.right, v)) return null;
          const k = env.value(n.right);
          if (!Number.isInteger(k) || k < 0 || k > MAX_DEGREE) return null;
          let out = constantP(1);
          for (let i = 0; i < k && out; i++) out = mulP(out, a);
          return out;
        }
        const b = P(n.right);
        if (!b) return null;
        if (n.op === '+') return addP(a, b);
        if (n.op === '-') return addP(a, b, -1);
        if (n.op === '*') return mulP(a, b);
        return null;
      }
      case 'apply': {
        const def = env.func ? env.func(n.name) : undefined;
        if (def) {
          if (def.params.length !== n.args.length) return null;
          let body = def.body;
          if (n.primes) {
            if (def.params.length !== 1) return null;
            for (let k = 0; k < n.primes; k++) body = derive(body, def.params[0], env);
          }
          const map = {};
          def.params.forEach((p, k) => { map[p] = n.args[k]; });
          return P(substitute(body, map));
        }
        if (n.args.length !== 1 || n.primes) return null;
        return P({ type: 'bin', op: '*', left: { type: 'sym', name: n.name }, right: n.args[0] });
      }
      default:
        return null;
    }
  };
  const p = P(node);
  if (!p) return null;
  const out = p.c.map((c, i) => (Math.abs(c) <= CANCEL_TOL * p.b[i] ? 0 : c));
  while (out.length > 1 && out[out.length - 1] === 0) out.pop();
  return out;
}
