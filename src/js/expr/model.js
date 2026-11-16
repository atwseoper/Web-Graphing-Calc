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
//   'point'       (a, b): { x, y }
// Polar and parametric rows may also carry domainError: { which: 'min'|'max', message }.
// Rows with an f of x also have derivative(): { f, text } | null, computed on first use.
import { ExprError } from './errors.js';
import { parse, parseExpression } from './parser.js';
import { tokenize } from './tokenizer.js';
import { compile, referencedNames } from './compile.js';
import { derive } from './derive.js';
import { toText } from './print.js';
import { isConstantName, isFunctionName } from './builtins.js';

export const PLOT_VARS = new Set(['x', 'y', 'r', 'θ', 't']);

const HINTS = {
  'θ': 'θ is used in polar graphs: write r = …',
  t: 't is used in parametric curves: write (x(t), y(t))',
  Ans: 'Ans can only be used in the Calc tab',
};

const MAX_DERIVATIVE_TEXT = 140;

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
  const results = rows.map(() => null);
  const parsed = rows.map((row) => {
    const text = (row.text || '').trim();
    if (!text) return { empty: true };
    try {
      return { ast: parse(row.text) };
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

  function resolveVariable(name, node) {
    const def = definition(name, 'variable', node);
    if (!def) return undefined;
    return resolve(varCache, name, node, () => {
      const fn = compile(def.body, makeCtx({
        unknown(n, where) {
          if (PLOT_VARS.has(n)) {
            throw new ExprError(`'${name}' can't depend on ${n}. To make a function, write ${name}(${n}) = …`, where.start, where.end);
          }
        },
      }));
      return fn([]);
    });
  }

  function resolveFunction(name, node) {
    const def = definition(name, 'function', node);
    if (!def) return undefined;
    return resolve(fnCache, name, node, () => {
      const slots = {};
      def.params.forEach((p, k) => { slots[p.name] = k; });
      const body = compile(def.body, makeCtx({ slots }));
      return { arity: def.params.length, call: (args) => body(args) };
    });
  }

  // User functions as { params, body } for symbolic differentiation (inlining).
  const deriveEnv = {
    angle,
    func(name) {
      const def = defs.get(name);
      if (!def || def.kind !== 'function' || def.duplicate) return undefined;
      return { params: def.params.map((p) => p.name), body: def.body };
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
        return resolveVariable(name, node);
      },
      func(name, node) {
        return resolveFunction(name, node);
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
        const b = def.body;
        const slider = b.type === 'num' || (b.type === 'neg' && b.arg.type === 'num');
        results[i] = { kind: 'variable', name: def.name, value, slider };
      } else {
        const fn = resolveFunction(def.name, null);
        const r = { kind: 'function', name: def.name, params: def.params.map((p) => p.name) };
        if (def.params.length === 1 && def.params[0].name === 'x') {
          r.f = unary(fn.call);
          r.derivative = lazyDerivative({ type: 'apply', name: def.name, args: [{ type: 'sym', name: 'x' }] });
        }
        results[i] = r;
      }
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
      results[i] = classify(p.ast, rows[i]);
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
    const missing = ast ? missingNames(ast) : explained.missing;
    results[i] = { kind: 'error', error: { ...explained, missing: missing.length ? missing : explained.missing } };
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
      node = { type: 'tuple', items: ast.lhs.type === 'sym' || ast.lhs.type === 'apply' ? [ast.rhs] : [ast.lhs, ast.rhs] };
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

  function classify(ast, row) {
    if (ast.type === 'eq') {
      let { lhs, rhs } = ast;
      // Allow "expr = y" as well as "y = expr".
      if (!(lhs.type === 'sym' && PLOT_VARS.has(lhs.name)) && rhs.type === 'sym' && ['x', 'y', 'r'].includes(rhs.name)) {
        [lhs, rhs] = [rhs, lhs];
      }
      if (lhs.type === 'sym' && !lhs.parens) {
        if (lhs.name === 'y') {
          const { fn } = compileWith(rhs, 'x', bothSides('y'));
          return { kind: 'cartesian', f: unary(fn), derivative: lazyDerivative(rhs) };
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
      throw new ExprError("This kind of equation isn't supported yet. Try y = …, x = …, r = … or a(x) = …", lhs.start, rhs.end);
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
      return { kind: 'point', x: cx.fn([0]), y: cy.fn([0]) };
    }

    const { fn, uses } = compileWith(expr, 'x', (n, where) => {
      if (n === 'y') throw new ExprError('To graph a function, write y = …', where.start, where.end);
    });
    if (uses) return { kind: 'cartesian', f: unary(fn), derivative: lazyDerivative(expr) };
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
  function evaluate(text, extraVars) {
    try {
      const ast = parseExpression(text);
      if (ast.type === 'tuple') throw new ExprError('Expected a single number', ast.start, ast.end);
      const ctx = makeCtx({
        extraVars,
        unknown(n, where) {
          if (n === 'x' || n === 'y') throw new ExprError(`${n} has no value here`, where.start, where.end);
        },
      });
      return { value: compile(ast, ctx)([]) };
    } catch (e) {
      return { error: explainUnknown(errorOf(e), text) };
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
    return compile(node, makeCtx({ slots, extraVars }));
  }

  // d node / d v as an AST (user functions inlined).
  function derivativeAst(node, v) {
    return derive(node, v, deriveEnv);
  }

  return {
    rows: results, angle, evaluate, unknownsOf, compileIn, derivativeAst,
    isDefined: (name) => defs.has(name),
    functionDef: deriveEnv.func,
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
