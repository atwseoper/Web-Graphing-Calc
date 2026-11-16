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
import { dependsOn, substitute, derive } from './derive.js';

export const MAX_DEGREE = 100;

function addP(a, b) {
  const out = new Array(Math.max(a.length, b.length)).fill(0);
  a.forEach((c, i) => { out[i] += c; });
  b.forEach((c, i) => { out[i] += c; });
  return out;
}

function mulP(a, b) {
  if (a.length + b.length - 2 > MAX_DEGREE) return null;
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  }
  return out;
}

export function toPolynomial(node, v, env) {
  const P = (n) => {
    if (!dependsOn(n, v)) return [env.value(n)];
    switch (n.type) {
      case 'sym':
        return [0, 1];
      case 'neg': {
        const a = P(n.arg);
        return a && a.map((c) => -c);
      }
      case 'bin': {
        const a = P(n.left);
        if (!a) return null;
        if (n.op === '/') {
          if (dependsOn(n.right, v)) return null;
          const d = env.value(n.right);
          return a.map((c) => c / d);
        }
        if (n.op === '^') {
          if (dependsOn(n.right, v)) return null;
          const k = env.value(n.right);
          if (!Number.isInteger(k) || k < 0 || k > MAX_DEGREE) return null;
          let out = [1];
          for (let i = 0; i < k && out; i++) out = mulP(out, a);
          return out;
        }
        const b = P(n.right);
        if (!b) return null;
        if (n.op === '+') return addP(a, b);
        if (n.op === '-') return addP(a, b.map((c) => -c));
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
  const out = P(node);
  if (!out) return null;
  while (out.length > 1 && out[out.length - 1] === 0) out.pop();
  return out;
}
