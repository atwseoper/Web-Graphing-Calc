// Fit models (D27). Pure module – no DOM access.
//
// Every model, built-in or custom, is an expression in x and parameter letters, parsed
// by the app's own parser. buildModel() compiles it with the parameters as frame slots
// (so they never clash with Graph-tab definitions), differentiates it symbolically with
// respect to each parameter (the Jacobian), and checks whether it is linear in its
// parameters: if no derivative mentions a parameter, the model is Σ pⱼ·gⱼ(x) + g₀(x).
import { ExprError } from '../expr/errors.js';
import { parseExpression } from '../expr/parser.js';
import { referencedNames } from '../expr/compile.js';
import { toText } from '../expr/print.js';
import {
  substitute, num, neg, add, sub, mul, div, pow,
} from '../expr/derive.js';

export const MAX_PARAMS = 10;

const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
// 'a_1' -> 'a₁'
export function paramLabel(name) {
  const m = /^(.+)_(\d+)$/.exec(name);
  return m ? m[1] + m[2].split('').map((d) => SUB[d]).join('') : name;
}

const polyText = (deg) => Array.from({ length: deg + 1 }, (_, k) => (k === 0 ? 'a_0' : k === 1 ? 'a_1 x' : `a_${k} x^${k}`)).join(' + ');
const polyFormula = (deg) => `y = a₀ + a₁x${Array.from({ length: deg - 1 }, (_, k) => ` + a${SUB[k + 2]}x${['²', '³', '⁴', '⁵', '⁶'][k]}`).join('')}`;

// name: shown in the model picker. formula: shown on the fit card.
export const PRESETS = {
  line: { name: 'Line', text: 'a + b x', params: ['a', 'b'], formula: 'y = a + bx', hints: { a: 'intercept', b: 'slope' } },
  poly: { name: 'Polynomial' },
  exp: { name: 'Exponential', text: 'a e^(b x)', params: ['a', 'b'], formula: 'y = a·eᵇˣ' },
  power: { name: 'Power', text: 'a x^b', params: ['a', 'b'], formula: 'y = a·xᵇ' },
  log: { name: 'Logarithmic', text: 'a + b ln(x)', params: ['a', 'b'], formula: 'y = a + b·ln x' },
  logistic: {
    name: 'Logistic', text: 'c/(1 + a e^(-b x))', params: ['a', 'b', 'c'], formula: 'y = c / (1 + a·e⁻ᵇˣ)',
    hints: { b: 'growth rate', c: 'limit' },
  },
  sin: {
    name: 'Sinusoidal', text: 'a sin(b x + c) + d', params: ['a', 'b', 'c', 'd'], formula: 'y = a·sin(bx + c) + d',
    hints: { a: 'amplitude', b: 'angular frequency', c: 'phase', d: 'offset' },
  },
  gauss: {
    name: 'Gaussian', text: 'a e^(-(x - b)^2/(2c^2))', params: ['a', 'b', 'c'], formula: 'y = a·e^(−(x − b)² / 2c²)',
    hints: { a: 'height', b: 'centre', c: 'width (σ)' },
  },
  custom: { name: 'Custom' },
};

// The model text, parameter names and display formula for a fit spec.
// Returns { text, params, formula, hints } or { error }.
export function modelSource(fit, analysis) {
  if (fit.model === 'poly') {
    const deg = fit.degree;
    return {
      text: polyText(deg),
      params: Array.from({ length: deg + 1 }, (_, k) => `a_${k}`),
      formula: polyFormula(deg),
      hints: {},
    };
  }
  if (fit.model !== 'custom') {
    const p = PRESETS[fit.model];
    return { text: p.text, params: p.params, formula: p.formula, hints: p.hints || {} };
  }
  const text = customText(fit.custom);
  if (!text.trim()) return { empty: true };
  let ast;
  try {
    ast = parseExpression(text);
  } catch (e) {
    return { error: errorOf(e, fit.custom.length - text.length) };
  }
  if (ast.type === 'tuple') return { error: { message: 'Enter one expression in x, e.g. a·e^(−b x) + c', start: -1, end: -1 } };
  // A parameter letter followed by brackets multiplies: a(1 − e^(−b x)) = a·(1 − e^(−b x)).
  ast = bracketsMultiply(ast, analysis);
  // Parameters: the letters that aren't defined in the Graph tab (D27), in order.
  let names;
  try {
    names = analysis.unknownsOf(ast);
  } catch (e) {
    return { error: errorOf(e) };
  }
  const refs = referencedNames(ast);
  const undefinedCalls = [...refs.calls].filter((n) => !analysis.isDefined(n) && names.includes(n));
  if (undefinedCalls.length) return { error: { message: `Unknown function '${undefinedCalls[0]}'`, start: -1, end: -1 } };
  const params = names.filter((n) => n !== 'x');
  for (const n of params) {
    if (n === 'y') return { error: { message: 'Write only the right-hand side, in terms of x: y = … is assumed', start: -1, end: -1 } };
    if (n === 't' || n === 'θ' || n === 'r') return { error: { message: `Use x for the variable, not ${n}`, start: -1, end: -1 } };
    if (n === 'Ans') return { error: { message: "Ans can't be used in a model", start: -1, end: -1 } };
  }
  if (!params.length) {
    return { error: { message: 'The model needs at least one parameter: a letter not defined in the Graph tab, like a or b', start: -1, end: -1 } };
  }
  if (params.length > MAX_PARAMS) return { error: { message: `At most ${MAX_PARAMS} parameters`, start: -1, end: -1 } };
  return { text, params, formula: `y = ${text.trim()}`, hints: {}, ast };
}

// In a model, name(arg) where name is a single letter (optionally subscripted) that
// isn't a defined function is a parameter times a bracket. Powers and factorials bind
// to the bracket only, as they would after any other letter: a(x + 1)^2 = a·(x + 1)².
function bracketsMultiply(node, analysis) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((v) => bracketsMultiply(v, analysis));
  const isParamCall = (n) => n && n.type === 'apply' && !n.primes && n.args.length === 1
    && /^[A-Za-z](_\w+)?$/.test(n.name) && !analysis.isDefined(n.name);
  const product = (call, inner) => ({
    type: 'bin', op: '*', start: call.start, end: inner.end ?? call.end,
    left: { type: 'sym', name: call.name, start: call.start, end: call.start + call.name.length },
    right: inner,
  });
  const bracket = (call) => ({ ...bracketsMultiply(call.args[0], analysis), parens: true });
  if (node.type === 'bin' && node.op === '^' && isParamCall(node.left)) {
    return product(node.left, { ...node, left: bracket(node.left), right: bracketsMultiply(node.right, analysis) });
  }
  if (node.type === 'fact' && isParamCall(node.arg)) {
    return product(node.arg, { ...node, arg: bracket(node.arg) });
  }
  if (isParamCall(node)) return product(node, bracket(node));
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = typeof v === 'object' ? bracketsMultiply(v, analysis) : v;
  return out;
}

// "y = a x + b", "y ~ …", "f(x) = …" -> the right-hand side.
export function customText(s) {
  return String(s || '').replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*(?:=|~)\s*/, '');
}

function errorOf(e, shift = 0) {
  if (e instanceof ExprError) {
    return { message: e.message, start: e.start >= 0 ? e.start + shift : -1, end: e.end >= 0 ? e.end + shift : -1 };
  }
  return { message: String(e && e.message ? e.message : e), start: -1, end: -1 };
}

// Compile a model. Returns { error } or
//   { params, formula, hints, ast, f(frame), grads: [f(frame)] | null, linear,
//     numericJacobian: bool }
// Frames are [x, p₀, p₁, …].
export function buildModel(analysis, fit) {
  const src = modelSource(fit, analysis);
  if (src.empty || src.error) return src;
  try {
    const ast = src.ast || parseExpression(src.text);
    const slots = ['x', ...src.params];
    const f = analysis.compileIn(ast, slots);
    let grads = null;
    let linear = false;
    try {
      const dAsts = src.params.map((p) => analysis.derivativeAst(ast, p));
      grads = dAsts.map((d) => analysis.compileIn(d, slots));
      linear = dAsts.every((d) => {
        const refs = referencedNames(d);
        return src.params.every((p) => !refs.names.has(p)) && !hasNumeric(d);
      });
    } catch {
      grads = null; // fall back to a numerical Jacobian
    }
    return { ...src, ast, f, grads, linear, numericJacobian: !grads };
  } catch (e) {
    return { error: errorOf(e, src.ast ? fit.custom.length - customText(fit.custom).length : 0) };
  }
}

function hasNumeric(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'nderiv') return true;
  return Object.values(node).some((v) => (Array.isArray(v) ? v.some(hasNumeric) : hasNumeric(v)));
}

// Rebuild an AST through the simplifying constructors, so that substituted numbers
// print cleanly: e^(−(−0.5)x) -> e^(0.5x), x + (−3) -> x − 3.
function rebuild(node) {
  switch (node.type) {
    case 'neg': return neg(rebuild(node.arg));
    case 'bin': {
      const l = rebuild(node.left);
      const r = rebuild(node.right);
      switch (node.op) {
        case '+': return add(l, r);
        case '-': return sub(l, r);
        case '*': return mul(l, r);
        case '/': return div(l, r);
        case '^': return pow(l, r);
        default: return { ...node, left: l, right: r };
      }
    }
    case 'call':
    case 'apply': return { ...node, args: node.args.map(rebuild) };
    default: return node;
  }
}

// "y = 1.00211681802x − 0.262323073774": the fitted model with its parameter values,
// as a row for the Graph tab. Values are rounded to the 12 significant figures that get
// printed before simplifying, so 1.0000000000000002x² prints as x², not 1x².
export function equationText(model, values) {
  const map = {};
  model.params.forEach((p, k) => { map[p] = num(Number.isFinite(values[k]) ? Number(values[k].toPrecision(12)) : values[k]); });
  return `y = ${toText(rebuild(substitute(model.ast, map)))}`;
}
