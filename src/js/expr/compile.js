// Compiles an AST into a fast JavaScript closure. No eval / new Function.
//
// compile(node, ctx) returns (frame) => number, where `frame` is an array holding
// the values of the slot variables (e.g. [x]).
//
// ctx = {
//   slots: { name: index },                  variables read from the frame
//   angle: 'rad' | 'deg',
//   variable(name) -> number | undefined,    user-defined constants
//   func(name) -> { arity, call(args) } | undefined,   user-defined functions
//   funcDeriv(name, order, node) -> { arity, call(args) } | undefined   f'(x), f''(x)
//   used: Set (optional)                     collects the slot names actually read
//   unknown(name, node) -> never (optional)  custom error for undefined names
// }
import { ExprError } from './errors.js';
import { FUNCTIONS, CONSTANTS, isConstantName } from './builtins.js';
import { factorial, realPow } from '../numerics/special.js';

const MAX_SERIES_TERMS = 1e6;

export function compile(node, ctx) {
  const c = compileNode(node, ctx);
  return c.fn;
}

// Internal: returns { fn, constant: boolean, value? } so constant subtrees fold.
function compileNode(node, ctx) {
  switch (node.type) {
    case 'num':
      return constant(node.value);

    case 'sym':
      return compileSym(node, ctx);

    case 'neg': {
      const a = compileNode(node.arg, ctx);
      if (a.constant) return constant(-a.value);
      const f = a.fn;
      return dynamic((fr) => -f(fr));
    }

    case 'bin': {
      const a = compileNode(node.left, ctx);
      const b = compileNode(node.right, ctx);
      const op = BINARY[node.op];
      if (a.constant && b.constant) return constant(op(a.value, b.value));
      const fa = a.fn;
      const fb = b.fn;
      switch (node.op) {
        case '+': return dynamic((fr) => fa(fr) + fb(fr));
        case '-': return dynamic((fr) => fa(fr) - fb(fr));
        case '*': return dynamic((fr) => fa(fr) * fb(fr));
        case '/': return dynamic((fr) => fa(fr) / fb(fr));
        case '^':
          if (b.constant && b.value === 2) return dynamic((fr) => { const v = fa(fr); return v * v; });
          return dynamic((fr) => realPow(fa(fr), fb(fr)));
        default: throw new ExprError(`Unknown operator ${node.op}`, node.start, node.end);
      }
    }

    case 'fact': {
      const a = compileNode(node.arg, ctx);
      if (a.constant) return constant(factorial(a.value));
      const f = a.fn;
      return dynamic((fr) => factorial(f(fr)));
    }

    case 'call':
      return compileBuiltinCall(node, ctx);

    case 'apply':
      return compileApply(node, ctx);

    case 'tuple':
      throw new ExprError('A point (a, b) can only be used on its own', node.start, node.end);

    case 'piecewise':
      return compilePiecewise(node, ctx);

    case 'cmp':
      throw new ExprError('A comparison can only be used as a condition in { }', node.start, node.end);

    case 'series':
      return compileSeries(node, ctx);

    case 'nderiv':
      return compileNumericDerivative(node, ctx);

    case 'lookup':
      return compileLookup(node, ctx);

    case 'list':
    case 'range':
    case 'index':
    case 'column':
      // Lists are taken apart before compiling (lists.js); one left here is somewhere a
      // single number is needed.
      throw new ExprError('A list can’t be used here – this needs a single number', node.start, node.end);

    default:
      throw new ExprError(`Unknown expression`, node.start, node.end);
  }
}

const BINARY = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '^': realPow,
};

function constant(value) {
  return { constant: true, value, fn: () => value };
}
function dynamic(fn) {
  return { constant: false, fn };
}

// ---- conditions ---------------------------------------------------------------------

const COMPARE = {
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '>=': (a, b) => a >= b,
};

function compileCondition(cmp, ctx) {
  const items = cmp.items.map((a) => compileNode(a, ctx).fn);
  const tests = cmp.ops.map((op) => COMPARE[op]);
  if (items.length === 2) {
    const [fa, fb] = items;
    const t = tests[0];
    return (fr) => t(fa(fr), fb(fr));
  }
  return (fr) => {
    let prev = items[0](fr);
    for (let i = 0; i < tests.length; i++) {
      const next = items[i + 1](fr);
      if (!tests[i](prev, next)) return false;
      prev = next;
    }
    return true;
  };
}

function compilePiecewise(node, ctx) {
  const conds = node.branches.map((b) => compileCondition(b.cond, ctx));
  const values = node.branches.map((b) => (b.value ? compileNode(b.value, ctx).fn : () => 1));
  const otherwise = node.otherwise ? compileNode(node.otherwise, ctx).fn : () => NaN;
  const n = conds.length;
  if (n === 1) {
    const [c] = conds;
    const [v] = values;
    return dynamic((fr) => (c(fr) ? v(fr) : otherwise(fr)));
  }
  return dynamic((fr) => {
    for (let i = 0; i < n; i++) if (conds[i](fr)) return values[i](fr);
    return otherwise(fr);
  });
}

// ---- sum / prod --------------------------------------------------------------------------

// A child context with an extra slot for `name`, appended after the existing slots.
function withSlot(ctx, name) {
  const slots = { ...(ctx.slots || {}) };
  const size = Object.values(ctx.slots || {}).reduce((m, i) => Math.max(m, i + 1), 0);
  slots[name] = size;
  const child = { ...ctx, slots, used: new Set() };
  return { child, index: size, size: size + 1 };
}

function propagateUsed(child, ctx, except) {
  if (!ctx.used) return;
  for (const u of child.used) if (u !== except) ctx.used.add(u);
}

function compileSeries(node, ctx) {
  const from = compileNode(node.from, ctx).fn;
  const to = compileNode(node.to, ctx).fn;
  const { child, index, size } = withSlot(ctx, node.index);
  const body = compileNode(node.body, child).fn;
  propagateUsed(child, ctx, node.index);
  const isSum = node.op === 'sum';
  const buf = new Array(size).fill(0);
  return dynamic((fr) => {
    const a = Math.ceil(from(fr) - 1e-9);
    const b = Math.floor(to(fr) + 1e-9);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
    if (b - a + 1 > MAX_SERIES_TERMS) return NaN;
    for (let i = 0; i < index; i++) buf[i] = fr[i];
    let acc = isSum ? 0 : 1;
    for (let k = a; k <= b; k++) {
      buf[index] = k;
      const v = body(buf);
      acc = isSum ? acc + v : acc * v;
    }
    return acc;
  });
}

// ---- numeric derivative ---------------------------------------------------------------------

// d expr / dv at v = at, by central differences with Richardson extrapolation.
function compileNumericDerivative(node, ctx) {
  const at = node.at ? compileNode(node.at, ctx).fn : compileSym({ type: 'sym', name: node.v, start: -1, end: -1 }, ctx).fn;
  const { child, index, size } = withSlot(ctx, node.v);
  const f = compileNode(node.expr, child).fn;
  propagateUsed(child, ctx, node.v);
  const buf = new Array(size).fill(0);
  return dynamic((fr) => {
    const x = at(fr);
    if (!Number.isFinite(x)) return NaN;
    for (let i = 0; i < index; i++) buf[i] = fr[i];
    const ev = (t) => {
      buf[index] = t;
      return f(buf);
    };
    const h = 1e-3 * Math.max(1, Math.abs(x));
    const d1 = (ev(x + h) - ev(x - h)) / (2 * h);
    const d2 = (ev(x + h / 2) - ev(x - h / 2)) / h;
    return d2 + (d2 - d1) / 3;
  });
}

// L[k] where the position isn't fixed (k counts in a sum, or is a sequence's n): the
// element at that position of a list of numbers, or undefined (Phase 9a).
function compileLookup(node, ctx) {
  const { values, base } = node;
  const idx = compileNode(node.index, ctx);
  const pick = (i) => {
    const k = i - base;
    return Number.isInteger(k) && k >= 0 && k < values.length ? values[k] : NaN;
  };
  if (idx.constant) return constant(pick(idx.value));
  const f = idx.fn;
  return dynamic((fr) => pick(f(fr)));
}

function compileSym(node, ctx) {
  const name = node.name;
  if (ctx.slots && Object.prototype.hasOwnProperty.call(ctx.slots, name)) {
    const i = ctx.slots[name];
    if (ctx.used) ctx.used.add(name);
    return dynamic((fr) => fr[i]);
  }
  if (isConstantName(name)) return constant(CONSTANTS[name]);
  const v = ctx.variable ? ctx.variable(name, node) : undefined;
  if (v !== undefined) return constant(v);
  if (ctx.func && ctx.func(name, node)) {
    throw new ExprError(`${name} is a function – use ${name}(…)`, node.start, node.end);
  }
  if (FUNCTIONS[name]) {
    throw new ExprError(`${name} needs an argument, e.g. ${name}(x)`, node.start, node.end);
  }
  if (ctx.unknown) ctx.unknown(name, node);
  const e = new ExprError(`'${name}' is not defined`, node.start, node.end);
  e.missing = name;
  throw e;
}

function checkArity(name, arity, n, node) {
  const [min, max] = arity;
  if (n < min || n > max) {
    const expected = min === max ? `${min}` : max === Infinity ? `at least ${min}` : max === min + 1 ? `${min} or ${max}` : `${min} to ${max}`;
    throw new ExprError(
      `${name} takes ${expected} argument${expected === '1' ? '' : 's'}, not ${n}`,
      node.nameStart ?? node.start, node.nameEnd ?? node.end,
    );
  }
}

function compileBuiltinCall(node, ctx) {
  const def = FUNCTIONS[node.name];
  checkArity(node.name, def.arity, node.args.length, node);
  const impl = ctx.angle === 'deg' ? def.deg : def.rad;
  const args = node.args.map((a) => compileNode(a, ctx));
  if (args.every((a) => a.constant)) return constant(impl(...args.map((a) => a.value)));
  const fns = args.map((a) => a.fn);
  if (fns.length === 1) {
    const f0 = fns[0];
    return dynamic((fr) => impl(f0(fr)));
  }
  if (fns.length === 2) {
    const [f0, f1] = fns;
    return dynamic((fr) => impl(f0(fr), f1(fr)));
  }
  return dynamic((fr) => impl(...fns.map((f) => f(fr))));
}

// name(args): user function call, or multiplication when name is a variable/slot/constant.
function compileApply(node, ctx) {
  const name = node.name;
  let userFn;
  if (node.primes) {
    userFn = ctx.funcDeriv ? ctx.funcDeriv(name, node.primes, node) : undefined;
    if (!userFn) {
      throw new ExprError(`'${name}' isn't a function – define ${name}(x) = … first`, node.nameStart ?? node.start, node.nameEnd ?? node.end);
    }
  } else {
    userFn = ctx.func ? ctx.func(name, node) : undefined;
  }
  if (userFn) {
    checkArity(name, [userFn.arity, userFn.arity], node.args.length, node);
    const args = node.args.map((a) => compileNode(a, ctx));
    const call = userFn.call;
    if (args.every((a) => a.constant)) return constant(call(args.map((a) => a.value)));
    const fns = args.map((a) => a.fn);
    if (fns.length === 1) {
      const f0 = fns[0];
      return dynamic((fr) => call([f0(fr)]));
    }
    return dynamic((fr) => call(fns.map((f) => f(fr))));
  }
  if (node.args.length !== 1) {
    // Not a function, so this can only be a multiplication – which needs exactly one factor.
    compileSym({ type: 'sym', name, start: node.nameStart, end: node.nameEnd }, ctx);
    throw new ExprError(`'${name}' is not a function`, node.nameStart, node.nameEnd);
  }
  const product = {
    type: 'bin', op: '*', implicit: true,
    left: { type: 'sym', name, start: node.nameStart, end: node.nameEnd },
    right: node.args[0],
    start: node.start, end: node.end,
  };
  return compileNode(product, ctx);
}

// Names referenced by an expression (excluding built-in functions and constants).
// Returns { names: Set of variable-like names, calls: Set of names used as name(...) }.
export function referencedNames(node, acc = { names: new Set(), calls: new Set() }) {
  switch (node.type) {
    case 'sym':
      if (!isConstantName(node.name)) acc.names.add(node.name);
      break;
    case 'neg':
    case 'fact':
      referencedNames(node.arg, acc);
      break;
    case 'bin':
      referencedNames(node.left, acc);
      referencedNames(node.right, acc);
      break;
    case 'call':
      for (const a of node.args) referencedNames(a, acc);
      break;
    case 'apply':
      acc.calls.add(node.name);
      for (const a of node.args) referencedNames(a, acc);
      break;
    case 'tuple':
    case 'cmp':
      for (const a of node.items) referencedNames(a, acc);
      break;
    case 'piecewise':
      for (const b of node.branches) {
        referencedNames(b.cond, acc);
        if (b.value) referencedNames(b.value, acc);
      }
      if (node.otherwise) referencedNames(node.otherwise, acc);
      break;
    case 'series': {
      referencedNames(node.from, acc);
      referencedNames(node.to, acc);
      const inner = referencedNames(node.body, { names: new Set(), calls: new Set() });
      inner.names.delete(node.index);
      for (const n of inner.names) acc.names.add(n);
      for (const n of inner.calls) acc.calls.add(n);
      break;
    }
    case 'nderiv': {
      const inner = referencedNames(node.expr, { names: new Set(), calls: new Set() });
      inner.names.delete(node.v);
      for (const n of inner.names) acc.names.add(n);
      for (const n of inner.calls) acc.calls.add(n);
      referencedNames(node.at || { type: 'sym', name: node.v }, acc);
      break;
    }
    case 'list':
      for (const a of node.items) referencedNames(a, acc);
      break;
    case 'range':
      referencedNames(node.first, acc);
      if (node.second) referencedNames(node.second, acc);
      referencedNames(node.last, acc);
      break;
    case 'index':
      referencedNames(node.target, acc);
      referencedNames(node.index, acc);
      break;
    case 'lookup':
      referencedNames(node.index, acc);
      break;
    default:
      break;
  }
  return acc;
}
