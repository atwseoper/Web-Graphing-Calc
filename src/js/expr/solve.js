// The Solve tab's maths: equations in one unknown, polynomials and systems (linear, or
// non-linear with as many equations as unknowns).
// Pure module – no DOM access. Each function takes the current analysis (from
// model.js), so variables and functions defined in the Graph tab can be used.
//
// Results carry `graph`: rows to add to the Graph tab for "Show on graph", and
// `frame`: an x range to show.
import { ExprError } from './errors.js';
import { parse } from './parser.js';
import { toText, formatLiteral } from './print.js';
import { toPolynomial, MAX_DEGREE } from './polynomial.js';
import { substitute, add, sub, mul, div, num, sym } from './derive.js';
import { findRoots } from '../numerics/roots.js';
import { polyRoots } from '../numerics/poly.js';
import { solveLinearSystem } from '../numerics/linalg.js';
import { solveNonlinear } from '../numerics/nlsolve.js';

const AUTO_RANGES = [[-10, 10], [-1000, 1000], [-1e6, 1e6]];
const MAX_UNKNOWNS = 12;
const MAX_NONLINEAR_UNKNOWNS = 6;

function fail(e) {
  if (e instanceof ExprError) return { error: { message: e.message, start: e.start, end: e.end } };
  return { error: { message: String(e && e.message ? e.message : e), start: -1, end: -1 } };
}

// "lhs = rhs" or a bare expression (= 0) -> { g: lhs − rhs, lhs, rhs }.
function equationOf(text) {
  const ast = parse(text);
  if (ast.type === 'eq') {
    return { g: { type: 'bin', op: '-', left: ast.lhs, right: { ...ast.rhs, parens: true } }, lhs: ast.lhs, rhs: ast.rhs };
  }
  if (ast.expr.type === 'tuple') throw new ExprError('Enter an equation, e.g. x^2 = 2', ast.expr.start, ast.expr.end);
  return { g: ast.expr, lhs: ast.expr, rhs: num(0) };
}

const listNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// ---- one equation, one unknown ---------------------------------------------------------

// options: { solveFor, given: { name: text }, from, to }
// Returns { error } or
//   { unknowns, solveFor, needs: [names], givenErrors: { name: message },
//     roots: [{ x, residual, iterations, tangential }], range: [a, b], auto, graph, frame }
export function solveEquation(analysis, text, options = {}) {
  if (!text.trim()) return { empty: true };
  let eq;
  try {
    eq = equationOf(text);
  } catch (e) {
    return fail(e);
  }
  const unknowns = analysis.unknownsOf(eq.g);
  if (!unknowns.length) {
    return { error: { message: 'There is no unknown to solve for – every name here already has a value', start: -1, end: -1 } };
  }
  const solveFor = unknowns.includes(options.solveFor) ? options.solveFor : unknowns.includes('x') ? 'x' : unknowns[0];
  const others = unknowns.filter((n) => n !== solveFor);
  const given = {};
  const needs = [];
  const givenErrors = {};
  for (const n of others) {
    const t = (options.given && options.given[n]) || '';
    if (!t.trim()) {
      needs.push(n);
      continue;
    }
    const r = analysis.evaluate(t);
    if (r.error) givenErrors[n] = r.error.message;
    else if (!Number.isFinite(r.value)) givenErrors[n] = 'Must be a finite number';
    else given[n] = r.value;
  }
  const base = { unknowns, solveFor, needs, givenErrors };
  if (needs.length || Object.keys(givenErrors).length) return base;

  let g;
  let dg = null;
  try {
    const fn = analysis.compileIn(eq.g, [solveFor], given);
    const frame = [0];
    g = (x) => {
      frame[0] = x;
      return fn(frame);
    };
    try {
      const d = analysis.compileIn(analysis.derivativeAst(eq.g, solveFor), [solveFor], given);
      const f2 = [0];
      dg = (x) => {
        f2[0] = x;
        return d(f2);
      };
    } catch {
      dg = null; // no derivative: Brent alone
    }
  } catch (e) {
    return { ...base, ...fail(e) };
  }

  // Search range: the user's, or growing automatic ranges until something is found.
  const bound = (t, which) => {
    if (!t || !t.trim()) return null;
    const r = analysis.evaluate(t);
    if (r.error) throw new ExprError(`${which}: ${r.error.message}`, -1, -1);
    if (!Number.isFinite(r.value)) throw new ExprError(`${which}: must be a finite number`, -1, -1);
    return r.value;
  };
  let from;
  let to;
  try {
    from = bound(options.from, 'From');
    to = bound(options.to, 'To');
  } catch (e) {
    return { ...base, ...fail(e) };
  }
  const auto = from === null && to === null;
  const ranges = auto ? AUTO_RANGES : [[from ?? -10, to ?? 10]];
  if (!auto && !(ranges[0][1] > ranges[0][0])) {
    return { ...base, error: { message: "The search range is empty: 'to' must be greater than 'from'", start: -1, end: -1 } };
  }
  let roots = [];
  let range = ranges[0];
  for (const [a, b] of ranges) {
    range = [a, b];
    roots = findRoots(g, a, b, { samples: 2000, df: dg || undefined });
    if (roots.length) break;
  }
  roots = roots.map((r) => ({ x: r.x, residual: Math.abs(g(r.x)), iterations: r.iterations, tangential: !!r.tangential }));

  // Show on graph: both sides as functions of x (the unknown renamed to x).
  const map = { [solveFor]: sym('x') };
  for (const [n, v] of Object.entries(given)) map[n] = num(v);
  const side = (node) => toText(substitute(node, map));
  const graph = [];
  try {
    const l = side(eq.lhs);
    const r = side(eq.rhs);
    if (r === '0') graph.push(`y = ${l}`);
    else graph.push(`y = ${l}`, `y = ${r}`);
  } catch {
    // nothing to graph
  }
  const frame = frameAround(roots.map((r) => r.x), range);
  return { ...base, roots, range, auto, graph, frame, renamed: solveFor !== 'x' ? solveFor : null };
}

// An x range showing all the given points with some margin.
function frameAround(xs, fallback) {
  if (!xs.length) return fallback[1] - fallback[0] <= 100 ? fallback : [-10, 10];
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const span = Math.max(hi - lo, 1e-9 * Math.max(1, Math.abs(lo)), 2);
  return [lo - 0.3 * span, hi + 0.3 * span];
}

// ---- polynomials -----------------------------------------------------------------------------

// Returns { error } or { variable, degree, coefficients (ascending), roots, iterations,
// converged, text (expanded form), graph, frame }.
export function solvePolynomial(analysis, text) {
  if (!text.trim()) return { empty: true };
  let eq;
  try {
    eq = equationOf(text);
  } catch (e) {
    return fail(e);
  }
  const unknowns = analysis.unknownsOf(eq.g);
  if (!unknowns.length) return { error: { message: 'There is no unknown – write a polynomial in x, e.g. x^3 - 2x - 5', start: -1, end: -1 } };
  if (unknowns.length > 1) {
    return { error: { message: `A polynomial needs one unknown, but this has ${listNames(unknowns)}. Use the Equation solver to give the others values.`, start: -1, end: -1 } };
  }
  const v = unknowns[0];
  let coeffs;
  try {
    const value = (node) => {
      const x = analysis.compileIn(node, [], {})([]);
      if (!Number.isFinite(x)) throw new ExprError('A coefficient is undefined or infinite', node.start ?? -1, node.end ?? -1);
      return x;
    };
    coeffs = toPolynomial(eq.g, v, { value, func: analysis.functionDef, angle: analysis.angle });
  } catch (e) {
    return fail(e);
  }
  if (!coeffs) {
    return { error: { message: `This isn't a polynomial in ${v} (only +, −, ×, ÷ by numbers and whole-number powers up to ${MAX_DEGREE}). Use the Equation solver instead.`, start: -1, end: -1 } };
  }
  const degree = coeffs.length - 1;
  if (degree < 1) {
    return { error: { message: coeffs[0] === 0 ? `This is true for every ${v}` : `There is no solution: this simplifies to ${formatLiteral(coeffs[0])} = 0`, start: -1, end: -1 } };
  }
  const r = polyRoots(coeffs);
  const realRoots = r.roots.filter((z) => z.im === 0).map((z) => z.re);
  return {
    variable: v,
    degree,
    coefficients: coeffs,
    roots: r.roots,
    iterations: r.iterations,
    converged: r.converged,
    graph: [`y = ${toText(substitute(eq.rhs.type === 'num' && eq.rhs.value === 0 ? eq.lhs : sub(eq.lhs, eq.rhs), { [v]: sym('x') }))}`],
    frame: frameAround(realRoots, [-10, 10]),
    renamed: v !== 'x' ? v : null,
  };
}

// ---- linear systems ----------------------------------------------------------------------------

// texts: one equation per entry (blank entries are ignored).
// Returns { error, index? } or { unknowns, status: 'unique'|'none'|'infinite',
//   values?, residual?, relations?, nearlySingular?, graph, frame }.
export function solveSystem(analysis, texts) {
  const items = texts.map((t, index) => ({ t, index })).filter((e) => e.t.trim());
  if (!items.length) return { empty: true };
  const eqs = [];
  for (const { t, index } of items) {
    try {
      eqs.push({ ...equationOf(t), index });
    } catch (e) {
      return { ...fail(e), index };
    }
  }
  const unknowns = [];
  for (const e of eqs) for (const n of analysis.unknownsOf(e.g)) if (!unknowns.includes(n)) unknowns.push(n);
  if (!unknowns.length) return { error: { message: 'There are no unknowns – every name already has a value', start: -1, end: -1 } };
  if (unknowns.length > MAX_UNKNOWNS) return { error: { message: `Too many unknowns (at most ${MAX_UNKNOWNS})`, start: -1, end: -1 } };

  const n = unknowns.length;
  const A = [];
  const b = [];
  for (const e of eqs) {
    let fn;
    try {
      fn = analysis.compileIn(e.g, unknowns, {});
    } catch (err) {
      return { ...fail(err), index: e.index };
    }
    const at = (p) => fn(p);
    const zero = new Array(n).fill(0);
    const c0 = at(zero);
    const row = unknowns.map((_, j) => {
      const p = [...zero];
      p[j] = 1;
      return at(p) - c0;
    });
    // Check linearity at two other points.
    for (const scale of [0.37, -2.9]) {
      const p = unknowns.map((_, j) => scale * (j + 1.3));
      const predicted = c0 + row.reduce((s, a, j) => s + a * p[j], 0);
      const actual = at(p);
      const size = Math.abs(c0) + row.reduce((s, a, j) => s + Math.abs(a * p[j]), 0) + 1;
      if (!Number.isFinite(actual) || !Number.isFinite(c0) || Math.abs(actual - predicted) > 1e-9 * size) {
        return solveNonlinearSystem(analysis, eqs, unknowns);
      }
    }
    A.push(row);
    b.push(-c0);
  }

  const sol = solveLinearSystem(A, b);
  const out = { unknowns, status: sol.status, equations: eqs.length };
  if (sol.status === 'unique') {
    out.values = sol.x;
    out.residual = sol.residual;
    out.nearlySingular = sol.nearlySingular;
  } else if (sol.status === 'infinite') {
    out.relations = sol.relations.map((r) => ({
      unknown: unknowns[r.unknown],
      constant: r.constant,
      terms: r.terms.map((t) => ({ unknown: unknowns[t.unknown], coef: t.coef })),
    }));
    out.free = sol.free.map((i) => unknowns[i]);
  }

  // Show on graph: with two unknowns, each equation is a line in the plane.
  out.graph = [];
  if (n === 2) {
    const [u, w] = unknowns;
    const lit = (v) => num(Number(v.toPrecision(12)));
    const nice = (v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-9 * Math.max(1, Math.abs(v * 1000));
    A.forEach(([a1, a2], i) => {
      let c = b[i];
      if (a2 !== 0) {
        const m = -a1 / a2;
        const k = c / a2;
        if (nice(m) && nice(k)) {
          out.graph.push(`y = ${toText(add(mul(lit(m), sym('x')), lit(k)))}`);
        } else {
          // Exact fraction form, with a positive denominator: y = (c − a₁x)/a₂
          const s = a2 < 0 ? -1 : 1;
          out.graph.push(`y = ${toText(div(sub(lit(s * c), mul(lit(s * a1), sym('x'))), lit(s * a2)))}`);
        }
      } else if (a1 !== 0) {
        c /= a1;
        out.graph.push(`x = ${toText(lit(c))}`);
      }
    });
    if (sol.status === 'unique') {
      out.graph.push(`(${formatLiteral(sol.x[0])}, ${formatLiteral(sol.x[1])})`);
      out.frame = frameAround([sol.x[0]], [-10, 10]);
    }
    if (u !== 'x' || w !== 'y') out.renamed = { [u]: 'x', [w]: 'y' };
  }
  return out;
}

// ---- non-linear systems (D44) -------------------------------------------------------------------

// Returns { error, index? } or { unknowns, status: 'nonlinear', equations, solutions:
//   [{ values, residual, iterations }], box, widened, graph, frame }.
function solveNonlinearSystem(analysis, eqs, unknowns) {
  const n = unknowns.length;
  if (eqs.length !== n) {
    const e = `${eqs.length} equation${eqs.length === 1 ? '' : 's'}`;
    const u = `${n} unknown${n === 1 ? '' : 's'} (${listNames(unknowns)})`;
    return { error: { message: `These equations aren't all linear, so they need as many equations as unknowns: there are ${e} and ${u}.`, start: -1, end: -1 } };
  }
  if (n > MAX_NONLINEAR_UNKNOWNS) {
    return { error: { message: `Non-linear systems can have at most ${MAX_NONLINEAR_UNKNOWNS} unknowns`, start: -1, end: -1 } };
  }
  const fns = [];
  for (const e of eqs) {
    try {
      fns.push(analysis.compileIn(e.g, unknowns, {}));
    } catch (err) {
      return { ...fail(err), index: e.index };
    }
  }
  // Exact Jacobian from symbolic derivatives where possible.
  let J = null;
  try {
    const d = eqs.map((e) => unknowns.map((u) => analysis.compileIn(analysis.derivativeAst(e.g, u), unknowns, {})));
    J = (x) => d.map((row) => row.map((fn) => fn(x)));
  } catch {
    J = null; // numeric differences instead
  }
  const F = (x) => fns.map((fn) => fn(x));

  let box = [-10, 10];
  let r = solveNonlinear(F, n, { J, box });
  let widened = false;
  if (!r.solutions.length) {
    box = [-1000, 1000];
    r = solveNonlinear(F, n, { J, box });
    widened = true;
  }
  const out = {
    unknowns, status: 'nonlinear', equations: eqs.length, box, widened, starts: r.starts, complete: r.complete,
    solutions: r.solutions.map((q) => ({ values: q.x, residual: q.residual, iterations: q.iterations })),
    graph: [],
  };

  // Show on graph: with two unknowns, each equation is a curve in the plane.
  if (n === 2) {
    const [u, w] = unknowns;
    const rename = { [u]: sym('x'), [w]: sym('y') };
    for (const e of eqs) {
      out.graph.push(`${toText(substitute(e.lhs, rename))} = ${toText(substitute(e.rhs, rename))}`);
    }
    for (const q of out.solutions) out.graph.push(`(${formatLiteral(q.values[0])}, ${formatLiteral(q.values[1])})`);
    out.frame = frameAround(out.solutions.map((q) => q.values[0]), [-10, 10]);
    if (u !== 'x' || w !== 'y') out.renamed = { [u]: 'x', [w]: 'y' };
  }
  return out;
}

// Coefficients (ascending) as readable text: "x³ − 6x² + 11x − 6".
export function polynomialText(coeffs, v, format) {
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const power = (k) => (k === 1 ? v : `${v}${String(k).split('').map((c) => SUP[c]).join('')}`);
  const parts = [];
  for (let k = coeffs.length - 1; k >= 0; k--) {
    const c = coeffs[k];
    if (c === 0) continue;
    const mag = Math.abs(c);
    let body;
    if (k === 0) body = format(mag);
    else body = `${mag === 1 ? '' : format(mag)}${power(k)}`;
    if (!parts.length) parts.push(c < 0 ? `−${body}` : body);
    else parts.push(c < 0 ? `− ${body}` : `+ ${body}`);
  }
  return parts.length ? parts.join(' ') : '0';
}
