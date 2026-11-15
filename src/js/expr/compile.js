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
//   used: Set (optional)                     collects the slot names actually read
//   unknown(name, node) -> never (optional)  custom error for undefined names
// }
import { ExprError } from './errors.js';
import { FUNCTIONS, CONSTANTS, isConstantName } from './builtins.js';
import { factorial, realPow } from '../numerics/special.js';

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
  throw new ExprError(`'${name}' is not defined`, node.start, node.end);
}

function checkArity(name, arity, n, node) {
  const [min, max] = arity;
  if (n < min || n > max) {
    const expected = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min} or ${max}`;
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
  const userFn = ctx.func ? ctx.func(name, node) : undefined;
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
      for (const a of node.items) referencedNames(a, acc);
      break;
    default:
      break;
  }
  return acc;
}
