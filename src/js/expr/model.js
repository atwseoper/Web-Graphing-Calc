// Analyses the list of expression rows: parses each row, resolves user-defined
// variables and functions (with duplicate and cycle detection), classifies each
// row and compiles what needs plotting or evaluating.
//
// Row kinds:
//   'empty'       blank row
//   'error'       { error: { message, start, end, missing? } }
//                 missing: names that are not defined (offered as sliders)
//   'value'       a constant expression: { value }
//   'variable'    a = …: { name, value, slider }  (slider: the value is a plain number)
//   'function'    f(x) = …: { name, params, f? }  (f is set, and plotted, when the only parameter is x)
//   'cartesian'   y = f(x) or a bare expression in x: { f }
//   'cartesian-x' x = g(y): { f }
//   'polar'       r = f(θ): { f, domain: { min, max } }
//   'parametric'  (x(t), y(t)): { fx, fy, domain: { min, max } }
//   'point'       (a, b): { x, y, expr } (expr: the parsed pair, for dragging, Phase 6a)
//   'implicit'    an equation in x and y not solved for either, x^2 + y^2 = 4:
//                 { F(x, y) } with the curve where F = 0 (F = left − right)
//   'inequality'  y < f(x), x ≥ g(y), or any chain of comparisons in x and y:
//                 { form: 'y'|'x', f, above, strict } shades above/below y = f(x)
//                 (form 'x': right/left of x = f(y)); or { form: 'general',
//                 test(x, y) -> boolean, edges: [{ F(x, y), strict }] }
//   'slope'       dy/dx = f(x, y) or y' = f(x, y): { f(x, y) }, a slope field
//   'list'        a list of numbers (Phase 9a): { values, name? } – L = [1, 2, 3], [1...10]^2
//   'points'      several points from lists, (L, M): { xs, ys }
//   'family'      one curve per element of a list, y = L·x: { of, members: [result…],
//                 labels: ['L = 1', …], total } where `of` is the kind of every member
//                 ('cartesian', 'cartesian-x', 'polar', 'parametric') and total is the
//                 number of curves before the cap of 50 (D61)
// Any result may carry warning: text shown under the row (lists of different lengths,
// a position outside a list, curves left out).
// Polar and parametric rows may also carry domainError: { which: 'min'|'max', message }.
// Rows with an f of x also have derivative(): { f, text } | null, computed on first use,
// and body: the expression in x as an AST (for Taylor polynomials, Phase 6b).
import { ExprError } from './errors.js';
import { parse, parseExpression, isDyDx } from './parser.js';
import { tokenize } from './tokenizer.js';
import { compile, referencedNames } from './compile.js';
import { derive } from './derive.js';
import { toText } from './print.js';
import { isConstantName, isFunctionName } from './builtins.js';
import { DISCRETE_FUNCTIONS } from '../numerics/distributions.js';
import { expand, expandParts, MAX_CURVES } from './lists.js';

export const PLOT_VARS = new Set(['x', 'y', 'r', 'θ', 't']);

const HINTS = {
  r: 'r is used in polar graphs: write r = …',
  'θ': 'θ is used in polar graphs: write r = …',
  t: 't is used in parametric curves: write (x(t), y(t))',
  Ans: 'Ans can only be used in the Calc tab',
};

const MAX_DERIVATIVE_TEXT = 140;

// Kinds of graph a list can make a family of (Phase 9a), and those it can't yet.
const FAMILY_KINDS = new Set(['cartesian', 'cartesian-x', 'polar', 'parametric']);
const KIND_WORDS = {
  implicit: 'implicit curves', inequality: 'inequalities', slope: 'slope fields',
};

function errorOf(e) {
  if (e instanceof ExprError) {
    const out = { message: e.message, start: e.start, end: e.end };
    if (e.missing) out.missing = [e.missing];
    return out;
  }
  return { message: String(e && e.message ? e.message : e), start: -1, end: -1 };
}

// Wrap a compiled closure taking a frame into a one-argument function with a reused frame.
function unary(fn) {
  const frame = [0];
  return (v) => {
    frame[0] = v;
    return fn(frame);
  };
}

// The same for a closure of (x, y).
function binary(fn) {
  const frame = [0, 0];
  return (x, y) => {
    frame[0] = x;
    frame[1] = y;
    return fn(frame);
  };
}

const STRICT = new Set(['<', '>']);
const FLIP = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' };
const holds = (op, a, b) => (op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b);

function hasNumericDerivative(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'nderiv') return true;
  return Object.values(node).some((v) => (Array.isArray(v) ? v.some(hasNumericDerivative) : hasNumericDerivative(v)));
}

export function defaultDomain(angle) {
  return angle === 'deg' ? { min: 0, max: 360, minText: '0', maxText: '360' } : { min: 0, max: 2 * Math.PI, minText: '0', maxText: '2π' };
}

// "'b' and 'c' depend on each other" etc.
function loopMessage(names) {
  const q = names.map((n) => `'${n}'`);
  if (q.length === 1) return `${q[0]} is defined in terms of itself`;
  if (q.length === 2) return `${q[0]} and ${q[1]} depend on each other`;
  return `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]} depend on each other in a loop`;
}

// Better wording for an undefined single letter that is part of a longer word:
// "sum(1, 2)" -> Unknown function 'sum'. Only the message changes, not the meaning.
export function explainUnknown(error, text) {
  if (!error || !error.missing || error.start < 0) return error;
  let toks;
  try {
    toks = tokenize(text);
  } catch {
    return error;
  }
  const i = toks.findIndex((t) => t.type === 'name' && t.start === error.start);
  if (i < 0) return error;
  const letter = (t) => t && t.type === 'name' && t.end - t.start === 1 && t.value.length === 1 && /[A-Za-z]/.test(t.value);
  if (!letter(toks[i])) return error;
  let a = i;
  let b = i;
  while (letter(toks[a - 1]) && toks[a - 1].end === toks[a].start) a--;
  while (letter(toks[b + 1]) && toks[b].end === toks[b + 1].start) b++;
  const word = text.slice(toks[a].start, toks[b].end);
  const next = toks[b + 1];
  if (b > a && next && next.type === 'op' && next.value === '(' && next.start === toks[b].end) {
    return { message: `Unknown function '${word}'`, start: toks[a].start, end: toks[b].end };
  }
  if (b - a >= 2) {
    const product = word.split('').join('·');
    return { ...error, message: `${error.message} – names are single letters, so '${word}' means ${product}` };
  }
  return error;
}

export function analyse(rows, settings = {}) {
  const angle = settings.angle === 'deg' ? 'deg' : 'rad';
  const base = settings.listIndex === '0' ? 0 : 1; // list positions count from 1 or 0 (D61)
  const results = rows.map(() => null);
  const parsed = rows.map((row) => {
    const text = (row.text || '').trim();
    if (!text) return { empty: true };
    try {
      return { ast: parse(row.text, { graph: true }) };
    } catch (e) {
      return { error: errorOf(e) };
    }
  });

  // ---- 1. Collect definitions -------------------------------------------------
  const defs = new Map(); // name -> def
  const defsByIndex = new Map();
  parsed.forEach((p, i) => {
    if (!p.ast || p.ast.type !== 'eq') return;
    const { lhs, rhs } = p.ast;
    let def = null;
    if (lhs.type === 'sym' && !lhs.parens && !PLOT_VARS.has(lhs.name)) {
      def = { kind: 'variable', name: lhs.name, body: rhs, index: i, node: lhs };
    } else if (lhs.type === 'apply' && !PLOT_VARS.has(lhs.name)) {
      def = { kind: 'function', name: lhs.name, body: rhs, index: i, node: lhs, params: lhs.args };
    }
    if (!def) return;
    const nameErr = checkDefinableName(def);
    if (nameErr) {
      results[i] = { kind: 'error', error: nameErr };
      return;
    }
    if (defs.has(def.name)) {
      const first = defs.get(def.name);
      first.duplicate = true;
      def.duplicate = true;
      (first.others ||= []).push(def);
    } else {
      defs.set(def.name, def);
    }
    defsByIndex.set(i, def);
  });

  // ---- 2. Lazy resolution of definitions ----------------------------------------
  const varCache = new Map();
  const fnCache = new Map();
  const derivCache = new Map();
  const stack = []; // names being resolved, for loop detection

  const at = (node) => [node ? node.start : -1, node ? node.end : -1];

  function dependencyError(name, node) {
    return new ExprError(`'${name}' has an error – fix its definition first`, ...at(node));
  }

  function loopError(name, node) {
    const names = [...new Set(stack.slice(stack.indexOf(name)))].sort();
    const e = new ExprError(loopMessage(names), ...at(node));
    e.loop = names;
    return e;
  }

  // Resolve a definition with loop detection and caching of errors.
  function resolve(cache, name, node, build) {
    if (cache.has(name)) {
      const c = cache.get(name);
      if (c.error) throw c.loop && c.loop.includes(stack[stack.length - 1]) ? c.loopError : dependencyError(name, node);
      return c.value;
    }
    if (stack.includes(name)) throw loopError(name, node);
    stack.push(name);
    try {
      const value = build();
      cache.set(name, { value });
      return value;
    } catch (e) {
      const inLoop = !!e.loop && e.loop.includes(name);
      cache.set(name, { error: errorOf(e), loop: inLoop ? e.loop : null, loopError: inLoop ? e : null });
      // Pass a loop error on only to callers inside the same loop; anything outside it
      // is told which definition to fix.
      const caller = stack[stack.length - 2];
      throw inLoop && e.loop.includes(caller) ? e : dependencyError(name, node);
    } finally {
      stack.pop();
    }
  }

  function definition(name, kind, node) {
    const def = defs.get(name);
    if (!def || def.kind !== kind) return undefined;
    if (def.duplicate) throw new ExprError(`'${name}' is defined more than once`, ...at(node));
    return def;
  }

  // A variable's value: a number, or { list: [numbers] } for a list variable (Phase 9a).
  function resolveVariable(name, node) {
    const def = definition(name, 'variable', node);
    if (!def) return undefined;
    return resolve(varCache, name, node, () => {
      const ctx = makeCtx({
        unknown(n, where) {
          if (PLOT_VARS.has(n)) {
            // "R = cos(θ)", "Y = 2x": a capital where the graph letter was meant
            const lower = name.toLowerCase();
            const partner = { r: 'θ', y: 'x', x: 'y' }[lower];
            if (name !== lower && partner === n) {
              const kind = { r: 'polar graph', y: 'graph', x: 'graph' }[lower] || 'graph';
              throw new ExprError(`For a ${kind}, use a lowercase ${lower}: ${lower} = …`, def.node.start, def.node.end);
            }
            throw new ExprError(`'${name}' can't depend on ${n}. To make a function, write ${name}(${n}) = …`, where.start, where.end);
          }
        },
      });
      const ex = withWarnings(def.index, () => expandNode(def.body));
      if (ex.list) {
        return { list: ex.list.map((item) => (item.type === 'num' ? item.value : compile(item, ctx)([]))) };
      }
      return compile(ex.node, ctx)([]);
    });
  }

  // The elements of a list variable, or undefined (not a list, not defined, or an error –
  // which is reported where the name is compiled).
  function listValues(name) {
    try {
      const v = resolveVariable(name, null);
      return v && typeof v === 'object' ? v.list : undefined;
    } catch {
      return undefined;
    }
  }

  // { arity, call, ast } for a function giving a number (ast: its body with any lists used
  // up), or { arity, listy: true, params, body } for one giving a list, which is inlined
  // where it is used (Phase 9a).
  function resolveFunction(name, node) {
    const def = definition(name, 'function', node);
    if (!def) return undefined;
    return resolve(fnCache, name, node, () => {
      const slots = {};
      def.params.forEach((p, k) => { slots[p.name] = k; });
      const params = def.params.map((p) => p.name);
      const ex = withWarnings(def.index, () => expandNode(def.body, params));
      if (ex.list) return { arity: params.length, listy: true, params, body: def.body, members: ex.list, labels: ex.labels };
      const body = compile(ex.node, makeCtx({
        slots,
        unknown(n, where) {
          // f(x) = x + y: a graph letter that isn't a parameter has no value here.
          if (PLOT_VARS.has(n)) {
            const params = [...def.params.map((p) => p.name), n].join(', ');
            throw new ExprError(`'${n}' isn't a parameter of ${name}. To use it, write ${name}(${params}) = …`, where.start, where.end);
          }
        },
      }));
      return { arity: def.params.length, call: (args) => body(args), ast: ex.node };
    });
  }

  // For lists.js: a user function, or undefined.
  function functionInfo(name) {
    try {
      return resolveFunction(name, null);
    } catch {
      return undefined;
    }
  }

  // ---- lists (Phase 9a) ---------------------------------------------------------------------
  // Warnings from expanding lists go to the row being worked on: a definition's own row
  // while it is resolved, otherwise the row being classified.
  const warningsByRow = new Map(); // row index -> Set of messages
  let warnTo = null;
  function withWarnings(index, fn) {
    const saved = warnTo;
    warnTo = index;
    try {
      return fn();
    } finally {
      warnTo = saved;
    }
  }
  const listEnv = {
    angle,
    base,
    listVar: listValues,
    func: functionInfo,
    constant(node) {
      return compile(node, makeCtx())([]);
    },
    column(set, col, node) {
      throw new ExprError('Data set columns arrive in Phase 9a-2', node.start, node.end);
    },
    warn(message) {
      if (warnTo === null) return;
      if (!warningsByRow.has(warnTo)) warningsByRow.set(warnTo, new Set());
      warningsByRow.get(warnTo).add(message);
    },
  };
  function expandNode(node, locals = []) {
    return expand(node, listEnv, { locals });
  }
  function warningOf(i) {
    const w = warningsByRow.get(i);
    return w && w.size ? [...w].join('. ') : undefined;
  }

  // User functions as { params, body } for symbolic differentiation (inlining).
  const deriveEnv = {
    angle,
    func(name) {
      const def = defs.get(name);
      if (!def || def.kind !== 'function' || def.duplicate) return undefined;
      // The body with any lists used up (mean(L), L[2]); none for a function giving a list.
      const info = functionInfo(name);
      if (info && info.listy) return undefined;
      return { params: def.params.map((p) => p.name), body: info && info.ast ? info.ast : def.body };
    },
  };

  // f'(x), f''(x) …: the derivative AST of a one-parameter function, compiled.
  function resolveFunctionDerivative(name, order, node) {
    const base = resolveFunction(name, node); // reports errors in the definition itself
    if (!base) return undefined;
    const def = defs.get(name);
    if (def.params.length !== 1) {
      throw new ExprError(`${name}${"'".repeat(order)} needs a function of one variable`, ...at(node));
    }
    const key = `${name}:${order}`;
    if (derivCache.has(key)) return derivCache.get(key);
    const param = def.params[0].name;
    let ast = def.body;
    for (let k = 0; k < order; k++) ast = derive(ast, param, deriveEnv);
    const body = compile(ast, makeCtx({ slots: { [param]: 0 } }));
    const value = { arity: 1, call: (args) => body(args), ast, param };
    derivCache.set(key, value);
    return value;
  }

  function makeCtx({ slots = {}, unknown, extraVars } = {}) {
    return {
      slots,
      angle,
      used: new Set(),
      variable(name, node) {
        if (extraVars && Object.prototype.hasOwnProperty.call(extraVars, name)) return extraVars[name];
        const v = resolveVariable(name, node);
        if (v && typeof v === 'object') {
          throw new ExprError(`'${name}' is a list – this needs a single number, such as ${name}[1] or mean(${name})`, ...at(node));
        }
        return v;
      },
      func(name, node) {
        const f = resolveFunction(name, node);
        if (f && f.listy) throw new ExprError(`${name} gives a list – this needs a single number`, ...at(node));
        return f;
      },
      funcDeriv(name, order, node) {
        return resolveFunctionDerivative(name, order, node);
      },
      unknown(name, node) {
        if (unknown) unknown(name, node);
        if (HINTS[name]) throw new ExprError(HINTS[name], node.start, node.end);
      },
    };
  }

  // A lazily computed derivative of an expression in x: { f, text, numeric }.
  function lazyDerivative(ast, v = 'x') {
    let done = false;
    let value = null;
    return () => {
      if (done) return value;
      done = true;
      try {
        const d = derive(ast, v, deriveEnv);
        const fn = compile(d, makeCtx({ slots: { [v]: 0 } }));
        const numeric = hasNumericDerivative(d);
        let text = numeric ? null : toText(d);
        if (text && text.length > MAX_DERIVATIVE_TEXT) text = null;
        value = { f: unary(fn), text, numeric, ast: d };
      } catch {
        value = null;
      }
      return value;
    };
  }

  // Resolve a definition row and record its result.
  function defineRow(def) {
    const i = def.index;
    if (def.duplicate) {
      results[i] = { kind: 'error', error: { message: `'${def.name}' is defined more than once`, start: def.node.start, end: def.node.end } };
      return;
    }
    try {
      if (def.kind === 'variable') {
        const value = resolveVariable(def.name, null);
        if (value && typeof value === 'object') {
          results[i] = { kind: 'list', name: def.name, values: value.list };
        } else {
          const b = def.body;
          const slider = b.type === 'num' || (b.type === 'neg' && b.arg.type === 'num');
          results[i] = { kind: 'variable', name: def.name, value, slider };
        }
      } else {
        const fn = resolveFunction(def.name, null);
        const r = { kind: 'function', name: def.name, params: def.params.map((p) => p.name) };
        if (fn.listy) {
          // f(x) = a·x with a list: a family of curves; otherwise just a definition.
          results[i] = def.params.length === 1 && def.params[0].name === 'x'
            ? familyOf(fn.members.map((m) => ({ type: 'eq', lhs: { type: 'sym', name: 'y' }, rhs: m })), fn.labels, rows[i], { type: 'eq' })
            : { ...r, listy: true };
          const w = warningOf(i);
          if (w) results[i].warning = w;
          return;
        }
        if (def.params.length === 1 && def.params[0].name === 'x') {
          r.f = unary(fn.call);
          r.body = { type: 'apply', name: def.name, args: [{ type: 'sym', name: 'x' }] };
          r.derivative = lazyDerivative(r.body);
          r.discrete = discreteIn(def.body, 'x');
        }
        results[i] = r;
      }
      const w = warningOf(i);
      if (w) results[i].warning = w;
    } catch (e) {
      const cache = def.kind === 'variable' ? varCache : fnCache;
      const cached = cache.get(def.name);
      results[i] = { kind: 'error', error: cached && cached.error ? cached.error : errorOf(e) };
    }
  }

  // ---- 3. Classify and compile every row ------------------------------------------
  parsed.forEach((p, i) => {
    if (results[i]) return;
    if (p.empty) { results[i] = { kind: 'empty' }; return; }
    if (p.error) { results[i] = { kind: 'error', error: p.error }; return; }
    if (defsByIndex.has(i)) { defineRow(defsByIndex.get(i)); return; }
    try {
      results[i] = withWarnings(i, () => classifyRow(p.ast, rows[i]));
      const w = warningOf(i);
      if (w && results[i].kind !== 'error') results[i].warning = results[i].warning || w;
    } catch (e) {
      results[i] = { kind: 'error', error: errorOf(e) };
    }
  });

  // ---- 4. Friendlier errors for undefined names, and every missing name for sliders ----
  results.forEach((r, i) => {
    if (r.kind !== 'error' || !r.error.missing) return;
    const explained = explainUnknown(r.error, rows[i].text || '');
    if (!explained.missing) {
      results[i] = { kind: 'error', error: explained };
      return;
    }
    const ast = parsed[i].ast;
    // Never offer a slider for a graph letter (x, y, r, θ, t) or Ans: "y = 1" would be a
    // graph, not a value.
    const offerable = (n) => !PLOT_VARS.has(n) && n !== 'Ans';
    const fromAst = ast ? missingNames(ast) : [];
    const missing = fromAst.length ? fromAst : explained.missing.filter(offerable);
    const error = { ...explained, missing };
    if (!missing.length) delete error.missing;
    results[i] = { kind: 'error', error };
  });

  function isKnownName(n) {
    return defs.has(n) || isConstantName(n) || isFunctionName(n) || PLOT_VARS.has(n) || n === 'Ans';
  }

  // Undefined names in a row, in order of appearance (definitions' own parameters excluded).
  function missingNames(ast) {
    let node = ast;
    const local = new Set();
    if (ast.type === 'eq') {
      if (ast.lhs.type === 'apply') ast.lhs.args.forEach((a) => a.type === 'sym' && local.add(a.name));
      if (ast.lhs.type === 'yprime' || isDyDx(ast.lhs)) node = ast.rhs;
      else node = { type: 'tuple', items: ast.lhs.type === 'sym' || ast.lhs.type === 'apply' ? [ast.rhs] : [ast.lhs, ast.rhs] };
    } else if (ast.type === 'ineq') {
      node = { type: 'tuple', items: ast.items };
    } else {
      node = ast.expr;
    }
    const refs = referencedNames(node);
    const out = [];
    for (const n of refs.names) if (!isKnownName(n) && !local.has(n)) out.push(n);
    return out.filter((n) => /^[A-Za-z](_\w+)?$/.test(n));
  }

  function compileWith(node, slotName, unknown) {
    const ctx = makeCtx({ slots: slotName ? { [slotName]: 0 } : {}, unknown });
    const fn = compile(node, ctx);
    return { fn, uses: ctx.used.has(slotName) };
  }

  // Compile an expression in x and y: (x, y) => number.
  function compileXY(node, what) {
    const ctx = makeCtx({
      slots: { x: 0, y: 1 },
      unknown(n, where) {
        if (n === 'r' || n === 'θ' || n === 't') throw new ExprError(`${what} use x and y, not ${n}`, where.start, where.end);
      },
    });
    return binary(compile(node, ctx));
  }

  function mentions(node, v) {
    return referencedNames(node).names.has(v);
  }

  // Does y = f(x) involve a discrete distribution of x (binompdf(10, 0.3, x)…), directly
  // or through user functions? Such graphs are drawn as stems at whole numbers (Phase 7b).
  function discreteIn(node, v, seen = new Set()) {
    if (!node || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some((n) => discreteIn(n, v, seen));
    if (node.type === 'call' && DISCRETE_FUNCTIONS.has(node.name)) {
      // Only the counting arguments: x in binompdf(n, p, x), a and b in binomcdf(n, p, a, b).
      const from = node.name.startsWith('binom') ? 2 : 1;
      if (node.args.slice(from).some((a) => mentions(a, v))) return true;
    }
    if (node.type === 'apply' && !seen.has(node.name)) {
      const def = defs.get(node.name);
      if (def && def.kind === 'function' && node.args.some((a) => mentions(a, v))) {
        seen.add(node.name);
        if (def.params.some((prm) => discreteIn(def.body, prm.name, seen))) return true;
      }
    }
    return Object.entries(node).some(([k, c]) => k !== 'type' && c && typeof c === 'object' && discreteIn(c, v, seen));
  }
  function mentionsXY(node) {
    return mentions(node, 'x') || mentions(node, 'y');
  }

  function classifyInequality(ast) {
    const { ops, items } = ast;
    if (!items.some(mentionsXY)) {
      throw new ExprError('An inequality to graph needs x or y in it, e.g. y < x^2', ast.start, ast.end);
    }
    // y < f(x) and x ≥ g(y): shade exactly between the curve and the edge of the graph.
    if (items.length === 2) {
      for (const v of ['y', 'x']) {
        const isV = (n) => n.type === 'sym' && n.name === v && !n.parens;
        let side = null;
        let op = ops[0];
        if (isV(items[0]) && !mentions(items[1], v)) side = items[1];
        else if (isV(items[1]) && !mentions(items[0], v)) {
          side = items[0];
          op = FLIP[op];
        }
        if (!side) continue;
        const other = v === 'y' ? 'x' : 'y';
        const { fn } = compileWith(side, other, (n, where) => {
          if (n === 'r' || n === 'θ' || n === 't') throw new ExprError(`Inequalities use x and y, not ${n}`, where.start, where.end);
        });
        return { kind: 'inequality', form: v, f: unary(fn), above: op === '>' || op === '>=', strict: STRICT.has(op) };
      }
    }
    // Anything else: test every comparison at each point of a grid.
    const fs = items.map((n) => compileXY(n, 'Inequalities'));
    const edges = [];
    for (let k = 0; k < ops.length; k++) {
      const a = fs[k];
      const b = fs[k + 1];
      edges.push({ F: (x, y) => a(x, y) - b(x, y), strict: STRICT.has(ops[k]) });
    }
    // Every comparison holds, except (optionally) number `skip`.
    const testExcept = (skip, x, y) => {
      let prev = fs[0](x, y);
      for (let k = 0; k < ops.length; k++) {
        const next = fs[k + 1](x, y);
        if (k !== skip && !holds(ops[k], prev, next)) return false;
        prev = next;
      }
      return true;
    };
    const test = (x, y) => testExcept(-1, x, y);
    return { kind: 'inequality', form: 'general', test, testExcept, edges };
  }

  function implicitOf(lhs, rhs) {
    const F = compileXY({ type: 'bin', op: '-', left: lhs, right: rhs, start: lhs.start, end: rhs.end }, 'Equations like this');
    return { kind: 'implicit', F };
  }

  // ---- rows with lists (Phase 9a) ------------------------------------------------------------
  // Expand the lists in a row: either one ordinary row, or one row per element.
  function classifyRow(ast, row) {
    let ex;
    if (ast.type === 'ineq') {
      ex = expandParts(ast.items, listEnv);
      if (ex.members) return familyOf(ex.members.map((items) => ({ ...ast, items })), ex.labels, row, ast);
      return classify(ex.parts === ast.items ? ast : { ...ast, items: ex.parts }, row);
    }
    if (ast.type === 'eq') {
      if (ast.lhs.type === 'yprime' || isDyDx(ast.lhs)) {
        ex = expandParts([ast.rhs], listEnv);
        if (ex.members) return familyOf(ex.members.map(([rhs]) => ({ ...ast, rhs })), ex.labels, row, ast);
        return classify(ex.parts[0] === ast.rhs ? ast : { ...ast, rhs: ex.parts[0] }, row);
      }
      ex = expandParts([ast.lhs, ast.rhs], listEnv);
      if (ex.members) return familyOf(ex.members.map(([lhs, rhs]) => ({ ...ast, lhs, rhs })), ex.labels, row, ast);
      const [lhs, rhs] = ex.parts;
      return classify(lhs === ast.lhs && rhs === ast.rhs ? ast : { ...ast, lhs, rhs }, row);
    }
    ex = expandParts([ast.expr], listEnv);
    if (ex.members) return familyOf(ex.members.map(([expr]) => ({ type: 'expr', expr })), ex.labels, row, ast);
    return classify(ex.parts[0] === ast.expr ? ast : { type: 'expr', expr: ex.parts[0] }, row);
  }

  // One result for a row whose lists give several members (each an ordinary parsed row).
  function familyOf(members, labels, row, ast) {
    const n = members.length;
    const isExpr = ast.type === 'expr';
    if (!n) {
      // An empty list: nothing to draw (or the empty list itself).
      const mentionsPlot = isExpr && [...referencedNames(ast.expr).names].some((v) => PLOT_VARS.has(v));
      return isExpr && !mentionsPlot ? { kind: 'list', values: [] } : { kind: 'family', of: 'cartesian', members: [], labels: [], total: 0 };
    }
    const num = (m) => m.type === 'num';
    // Fast paths: lists of numbers and of points, up to 10,000 elements.
    if (isExpr && members.every((m) => num(m.expr))) return { kind: 'list', values: members.map((m) => m.expr.value) };
    if (isExpr && members.every((m) => m.expr.type === 'tuple' && m.expr.items.length === 2 && m.expr.items.every(num))) {
      return { kind: 'points', xs: members.map((m) => m.expr.items[0].value), ys: members.map((m) => m.expr.items[1].value) };
    }
    const first = classify(members[0], row);
    if (first.kind === 'value' || first.kind === 'point') {
      const all = members.map((m, k) => (k ? classify(m, row) : first));
      if (all.every((r) => r.kind === 'value')) return { kind: 'list', values: all.map((r) => r.value) };
      if (all.every((r) => r.kind === 'point')) return { kind: 'points', xs: all.map((r) => r.x), ys: all.map((r) => r.y) };
    }
    if (KIND_WORDS[first.kind]) {
      throw new ExprError(`Lists can't be used in ${KIND_WORDS[first.kind]} yet – only in y = …, x = …, r = …, parametric curves and points`, ast.start ?? -1, ast.end ?? -1);
    }
    const shown = Math.min(n, MAX_CURVES);
    const out = [];
    let of = null;
    for (let k = 0; k < shown; k++) {
      let r = k ? classify(members[k], row) : first;
      // y = [x, 2]: a number among curves is a horizontal line.
      if (r.kind === 'value' && isExpr) {
        const v = r.value;
        r = { kind: 'cartesian', f: () => v, body: { type: 'num', value: v }, derivative: () => null };
      }
      if (r.kind === 'function' && r.f) r = { ...r, kind: 'cartesian' };
      if (!FAMILY_KINDS.has(r.kind) || (of && r.kind !== of)) {
        throw new ExprError('Every element of the list must give the same kind of graph', ast.start ?? -1, ast.end ?? -1);
      }
      of = r.kind;
      out.push(r);
    }
    const result = { kind: 'family', of, members: out, labels: labels.slice(0, shown), total: n };
    if (out[0].domainError) result.domainError = out[0].domainError;
    if (n > shown) listEnv.warn(`Showing the first ${MAX_CURVES} of ${n.toLocaleString('en')} curves`);
    return result;
  }

  function classify(ast, row) {
    if (ast.type === 'ineq') return classifyInequality(ast);
    if (ast.type === 'eq' && (ast.lhs.type === 'yprime' || isDyDx(ast.lhs))) {
      return { kind: 'slope', f: compileXY(ast.rhs, 'Slope fields') };
    }
    if (ast.type === 'eq') {
      let { lhs, rhs } = ast;
      // Allow "expr = y" as well as "y = expr".
      if (!(lhs.type === 'sym' && PLOT_VARS.has(lhs.name)) && rhs.type === 'sym' && ['x', 'y', 'r'].includes(rhs.name)) {
        [lhs, rhs] = [rhs, lhs];
      }
      if (lhs.type === 'sym' && !lhs.parens) {
        if ((lhs.name === 'y' && mentions(rhs, 'y')) || (lhs.name === 'x' && mentions(rhs, 'x'))) {
          return implicitOf(lhs, rhs);
        }
        if (lhs.name === 'y') {
          const { fn } = compileWith(rhs, 'x', bothSides('y'));
          return { kind: 'cartesian', f: unary(fn), body: rhs, derivative: lazyDerivative(rhs), discrete: discreteIn(rhs, 'x') };
        }
        if (lhs.name === 'x') {
          const { fn } = compileWith(rhs, 'y', bothSides('x'));
          return { kind: 'cartesian-x', f: unary(fn) };
        }
        if (lhs.name === 'r') {
          const { fn } = compileWith(rhs, 'θ', (n, where) => {
            if (n === 'r') throw new ExprError("Equations with r on both sides aren't supported yet", where.start, where.end);
            if (n === 'x') throw new ExprError('Use θ (not x) in polar equations', where.start, where.end);
          });
          return { kind: 'polar', f: unary(fn), ...domainOf(row) };
        }
        if (lhs.name === 'θ' || lhs.name === 't') {
          throw new ExprError(`${lhs.name} can't be given a value`, lhs.start, lhs.end);
        }
      }
      if (lhs.type === 'apply' && lhs.primes) {
        throw new ExprError(`${lhs.name}${"'".repeat(lhs.primes)} is worked out from ${lhs.name} – define ${lhs.name}(x) instead`, lhs.start, lhs.end);
      }
      if (mentionsXY(lhs) || mentionsXY(rhs)) {
        if (mentions(lhs, 'r') || mentions(rhs, 'r') || mentions(lhs, 'θ') || mentions(rhs, 'θ')) {
          throw new ExprError('Polar equations need r alone on one side: r = …', lhs.start, rhs.end);
        }
        return implicitOf(lhs, rhs);
      }
      throw new ExprError("This kind of equation isn't supported. Try y = …, x = …, r = …, x^2 + y^2 = 4 or a(x) = …", lhs.start, rhs.end);
    }

    const expr = ast.expr;
    if (expr.type === 'tuple') {
      if (expr.items.length !== 2) {
        throw new ExprError('A point needs exactly two coordinates, e.g. (1, 2)', expr.start, expr.end);
      }
      const unknownT = (n, where) => {
        if (n === 'x' || n === 'y') throw new ExprError(`Use t (not ${n}) in parametric curves, e.g. (cos(t), sin(t))`, where.start, where.end);
      };
      const cx = compileWith(expr.items[0], 't', unknownT);
      const cy = compileWith(expr.items[1], 't', unknownT);
      if (cx.uses || cy.uses) {
        return { kind: 'parametric', fx: unary(cx.fn), fy: unary(cy.fn), ...domainOf(row) };
      }
      return { kind: 'point', x: cx.fn([0]), y: cy.fn([0]), expr };
    }

    const { fn, uses } = compileWith(expr, 'x', (n, where) => {
      if (n === 'y') throw new ExprError('To graph a function, write y = …', where.start, where.end);
    });
    if (uses) return { kind: 'cartesian', f: unary(fn), body: expr, derivative: lazyDerivative(expr), discrete: discreteIn(expr, 'x') };
    return { kind: 'value', value: fn([0]) };
  }

  function bothSides(v) {
    return (n, where) => {
      if (n === v) throw new ExprError(`Equations with ${v} on both sides aren't supported yet`, where.start, where.end);
    };
  }

  function domainOf(row) {
    const def = defaultDomain(angle);
    const out = { domain: { min: def.min, max: def.max } };
    for (const which of ['min', 'max']) {
      const text = (which === 'min' ? row.domainMin : row.domainMax) || '';
      if (!text.trim()) continue;
      const r = evaluate(text);
      if (r.error) {
        out.domainError = { which, message: r.error.message };
        return out;
      }
      if (!Number.isFinite(r.value)) {
        out.domainError = { which, message: 'Must be a finite number' };
        return out;
      }
      out.domain[which] = r.value;
    }
    if (!(out.domain.max > out.domain.min)) {
      out.domainError = { which: 'max', message: 'The end must be greater than the start' };
    }
    return out;
  }

  // Evaluate a constant expression using the user's definitions.
  // extraVars, e.g. { Ans: 3 }, are extra named values.
  // With { allowList: true } a list gives { list: [numbers], warning? } (the Calc tab);
  // elsewhere a list is an error, since a single number is needed.
  function evaluate(text, extraVars, { allowList = false } = {}) {
    const warnings = new Set();
    const savedWarn = listEnv.warn;
    listEnv.warn = (m) => warnings.add(m);
    try {
      const ast = parseExpression(text);
      if (ast.type === 'tuple') throw new ExprError('Expected a single number', ast.start, ast.end);
      const ctx = makeCtx({
        extraVars,
        unknown(n, where) {
          if (n === 'x' || n === 'y') throw new ExprError(`${n} has no value here`, where.start, where.end);
        },
      });
      const ex = withWarnings(null, () => expand(ast, listEnv));
      const warning = warnings.size ? [...warnings].join('. ') : undefined;
      if (ex.list) {
        if (!allowList) throw new ExprError('This gives a list – a single number is needed here', 0, text.length);
        return { list: ex.list.map((item) => (item.type === 'num' ? item.value : compile(item, ctx)([]))), warning };
      }
      return { value: compile(ex.node, ctx)([]), warning };
    } catch (e) {
      return { error: explainUnknown(errorOf(e), text) };
    } finally {
      listEnv.warn = savedWarn;
    }
  }

  // ---- helpers for the Solve tab ------------------------------------------------------

  // Names in an AST that have no definition (the unknowns of an equation), in order.
  function unknownsOf(node) {
    const refs = referencedNames(node);
    const out = [];
    for (const n of refs.names) {
      if (defs.has(n) || isConstantName(n) || isFunctionName(n) || n === 'Ans') continue;
      out.push(n);
    }
    for (const n of refs.calls) {
      if (!defs.has(n) && !out.includes(n)) out.push(n);
    }
    return out;
  }

  // Compile an AST with the given names as frame slots and extra fixed values.
  // Returns (frame) => number, or throws an ExprError.
  function compileIn(node, slotNames = [], extraVars) {
    const slots = {};
    slotNames.forEach((n, k) => { slots[n] = k; });
    const ex = expandNode(node, slotNames);
    if (ex.list) throw new ExprError('A list can’t be used here – this needs a single number', node.start ?? -1, node.end ?? -1);
    return compile(ex.node, makeCtx({ slots, extraVars }));
  }

  // d node / d v as an AST (user functions inlined).
  function derivativeAst(node, v) {
    return derive(node, v, deriveEnv);
  }

  // A string that changes exactly when something `text` can depend on changes: the
  // angle unit and the text of every definition it uses, directly or through other
  // definitions. Lets callers keep results across edits to unrelated rows.
  function dependencyKey(text) {
    let ast;
    try {
      ast = parseExpression(String(text || ''));
    } catch {
      return `${angle}|`;
    }
    const seen = new Set();
    const queue = (node) => {
      const refs = referencedNames(node);
      return [...refs.names, ...refs.calls];
    };
    const todo = queue(ast);
    while (todo.length) {
      const n = todo.pop();
      if (seen.has(n)) continue;
      seen.add(n);
      const def = defs.get(n);
      if (!def) continue;
      for (const d of [def, ...(def.others || [])]) todo.push(...queue(d.body));
    }
    const parts = [];
    for (const n of [...seen].sort()) {
      const def = defs.get(n);
      if (def) parts.push([def, ...(def.others || [])].map((d) => rows[d.index].text).join('\u0001'));
    }
    return `${angle}|${parts.join('\u0000')}`;
  }

  // Every name the definition of `name` uses, directly or through other definitions
  // (function parameters excluded), or null if `name` isn't defined.
  function dependencies(name) {
    if (!defs.has(name)) return null;
    const seen = new Set();
    const todo = [name];
    while (todo.length) {
      const def = defs.get(todo.pop());
      if (!def) continue;
      for (const d of [def, ...(def.others || [])]) {
        const own = new Set(d.kind === 'function' ? d.params.map((p) => p.name) : []);
        const refs = referencedNames(d.body);
        for (const m of [...refs.names, ...refs.calls]) {
          if (own.has(m) && !refs.calls.has(m)) continue;
          if (!seen.has(m)) {
            seen.add(m);
            todo.push(m);
          }
        }
      }
    }
    return seen;
  }

  return {
    rows: results, angle, evaluate, unknownsOf, compileIn, derivativeAst, dependencyKey, dependencies,
    isDefined: (name) => defs.has(name),
    functionDef: deriveEnv.func,
    // The body of a variable definition (a = …), or undefined (exact Taylor
    // coefficients follow slider values through it, Phase 6c).
    variableDef(name) {
      const def = defs.get(name);
      if (!def || def.kind !== 'variable' || def.duplicate) return undefined;
      return { body: def.body };
    },
  };
}

function checkDefinableName(def) {
  const n = def.node;
  const at = (msg) => ({ message: msg, start: n.nameStart ?? n.start, end: n.nameEnd ?? n.end });
  if (isConstantName(def.name)) return at(`'${def.name}' is a built-in constant`);
  if (def.name === 'Ans') return at("'Ans' can't be redefined");
  if (def.kind === 'function') {
    if (n.primes) return at(`${def.name}${"'".repeat(n.primes)} is worked out from ${def.name} – define ${def.name}(x) instead`);
    const seen = new Set();
    for (const p of def.params) {
      if (p.type !== 'sym' || p.parens || isConstantName(p.name)) {
        return { message: `Function parameters must be single letters, e.g. ${def.name}(x) = …`, start: p.start, end: p.end };
      }
      if (seen.has(p.name)) return { message: `Parameter '${p.name}' is repeated`, start: p.start, end: p.end };
      seen.add(p.name);
    }
  }
  return null;
}
