// Analyses the list of expression rows: parses each row, resolves user-defined
// variables and functions (with duplicate and cycle detection), classifies each
// row and compiles what needs plotting or evaluating.
//
// Row kinds:
//   'empty'       blank row
//   'error'       { error: { message, start, end } }
//   'value'       a constant expression: { value }
//   'variable'    a = …: { name, value }
//   'function'    f(x) = …: { name, params, f? }  (f is set, and plotted, when the only parameter is x)
//   'cartesian'   y = f(x) or a bare expression in x: { f }
//   'cartesian-x' x = g(y): { f }
//   'polar'       r = f(θ): { f, domain: { min, max } }
//   'parametric'  (x(t), y(t)): { fx, fy, domain: { min, max } }
//   'point'       (a, b): { x, y }
// Polar and parametric rows may also carry domainError: { which: 'min'|'max', message }.
import { ExprError } from './errors.js';
import { parse, parseExpression } from './parser.js';
import { compile } from './compile.js';
import { isConstantName } from './builtins.js';

export const PLOT_VARS = new Set(['x', 'y', 'r', 'θ', 't']);

const HINTS = {
  'θ': 'θ is used in polar graphs: write r = …',
  t: 't is used in parametric curves: write (x(t), y(t))',
  Ans: 'Ans can only be used in the Calc tab',
};

function errorOf(e) {
  if (e instanceof ExprError) return { message: e.message, start: e.start, end: e.end };
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

export function defaultDomain(angle) {
  return angle === 'deg' ? { min: 0, max: 360, minText: '0', maxText: '360' } : { min: 0, max: 2 * Math.PI, minText: '0', maxText: '2π' };
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
  const inProgress = new Set();

  function dependencyError(name, node) {
    return new ExprError(`'${name}' has an error – fix its definition first`, node ? node.start : -1, node ? node.end : -1);
  }

  function resolveVariable(name, node) {
    const def = defs.get(name);
    if (!def || def.kind !== 'variable') return undefined;
    if (def.duplicate) throw new ExprError(`'${name}' is defined more than once`, node ? node.start : -1, node ? node.end : -1);
    if (varCache.has(name)) {
      const c = varCache.get(name);
      if (c.error) throw dependencyError(name, node);
      return c.value;
    }
    if (inProgress.has(name)) {
      throw new ExprError(`'${name}' is defined in terms of itself`, node ? node.start : -1, node ? node.end : -1);
    }
    inProgress.add(name);
    try {
      const fn = compile(def.body, makeCtx({
        unknown(n, at) {
          if (PLOT_VARS.has(n)) {
            throw new ExprError(`'${name}' can't depend on ${n}. To make a function, write ${name}(${n}) = …`, at.start, at.end);
          }
        },
      }));
      const value = fn([]);
      varCache.set(name, { value });
      return value;
    } catch (e) {
      varCache.set(name, { error: errorOf(e) });
      throw e.message && e.message.includes('in terms of itself') ? e : dependencyError(name, node);
    } finally {
      inProgress.delete(name);
    }
  }

  function resolveFunction(name, node) {
    const def = defs.get(name);
    if (!def || def.kind !== 'function') return undefined;
    if (def.duplicate) throw new ExprError(`'${name}' is defined more than once`, node ? node.start : -1, node ? node.end : -1);
    if (fnCache.has(name)) {
      const c = fnCache.get(name);
      if (c.error) throw dependencyError(name, node);
      return c.value;
    }
    if (inProgress.has(name)) {
      throw new ExprError(`'${name}' is defined in terms of itself`, node ? node.start : -1, node ? node.end : -1);
    }
    inProgress.add(name);
    try {
      const slots = {};
      def.params.forEach((p, k) => { slots[p.name] = k; });
      const body = compile(def.body, makeCtx({ slots }));
      const value = { arity: def.params.length, call: (args) => body(args) };
      fnCache.set(name, { value });
      return value;
    } catch (e) {
      fnCache.set(name, { error: errorOf(e) });
      throw e.message && e.message.includes('in terms of itself') ? e : dependencyError(name, node);
    } finally {
      inProgress.delete(name);
    }
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
      unknown(name, node) {
        if (unknown) unknown(name, node);
        if (HINTS[name]) throw new ExprError(HINTS[name], node.start, node.end);
      },
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
        resolveVariable(def.name, null);
        results[i] = { kind: 'variable', name: def.name, value: varCache.get(def.name).value };
      } else {
        const fn = resolveFunction(def.name, null);
        const r = { kind: 'function', name: def.name, params: def.params.map((p) => p.name) };
        if (def.params.length === 1 && def.params[0].name === 'x') r.f = unary(fn.call);
        results[i] = r;
      }
    } catch (e) {
      const cached = def.kind === 'variable' ? varCache.get(def.name) : fnCache.get(def.name);
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
          return { kind: 'cartesian', f: unary(fn) };
        }
        if (lhs.name === 'x') {
          const { fn } = compileWith(rhs, 'y', bothSides('x'));
          return { kind: 'cartesian-x', f: unary(fn) };
        }
        if (lhs.name === 'r') {
          const { fn } = compileWith(rhs, 'θ', (n, at) => {
            if (n === 'r') throw new ExprError("Equations with r on both sides aren't supported yet", at.start, at.end);
            if (n === 'x') throw new ExprError('Use θ (not x) in polar equations', at.start, at.end);
          });
          return { kind: 'polar', f: unary(fn), ...domainOf(row) };
        }
        if (lhs.name === 'θ' || lhs.name === 't') {
          throw new ExprError(`${lhs.name} can't be given a value`, lhs.start, lhs.end);
        }
      }
      throw new ExprError("This kind of equation isn't supported yet. Try y = …, x = …, r = … or a(x) = …", lhs.start, rhs.end);
    }

    const expr = ast.expr;
    if (expr.type === 'tuple') {
      if (expr.items.length !== 2) {
        throw new ExprError('A point needs exactly two coordinates, e.g. (1, 2)', expr.start, expr.end);
      }
      const unknownT = (n, at) => {
        if (n === 'x' || n === 'y') throw new ExprError(`Use t (not ${n}) in parametric curves, e.g. (cos(t), sin(t))`, at.start, at.end);
      };
      const cx = compileWith(expr.items[0], 't', unknownT);
      const cy = compileWith(expr.items[1], 't', unknownT);
      if (cx.uses || cy.uses) {
        return { kind: 'parametric', fx: unary(cx.fn), fy: unary(cy.fn), ...domainOf(row) };
      }
      return { kind: 'point', x: cx.fn([0]), y: cy.fn([0]) };
    }

    const { fn, uses } = compileWith(expr, 'x', (n, at) => {
      if (n === 'y') throw new ExprError('To graph a function, write y = …', at.start, at.end);
    });
    if (uses) return { kind: 'cartesian', f: unary(fn) };
    return { kind: 'value', value: fn([0]) };
  }

  function bothSides(v) {
    return (n, at) => {
      if (n === v) throw new ExprError(`Equations with ${v} on both sides aren't supported yet`, at.start, at.end);
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
        unknown(n, at) {
          if (n === 'x' || n === 'y') throw new ExprError(`${n} has no value here`, at.start, at.end);
        },
      });
      return { value: compile(ast, ctx)([]) };
    } catch (e) {
      return { error: errorOf(e) };
    }
  }

  return { rows: results, angle, evaluate };
}

function checkDefinableName(def) {
  const n = def.node;
  const at = (msg) => ({ message: msg, start: n.nameStart ?? n.start, end: n.nameEnd ?? n.end });
  if (isConstantName(def.name)) return at(`'${def.name}' is a built-in constant`);
  if (def.name === 'Ans') return at("'Ans' can't be redefined");
  if (def.kind === 'function') {
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
