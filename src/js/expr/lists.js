// Lists (Phase 9a): [1, 2, 3], ranges [1...10] and [0, 0.5...5], indexing L[2] and
// L[2...4], list variables L = […], functions of a whole list (length, sum, mean …) and
// arithmetic that applies to each element.
//
// The compiler only knows single numbers, so lists are taken apart here first. expand()
// rewrites an expression into either one ordinary expression (where every list has been
// used up, as in mean(L) or L[2]) or a list of ordinary expressions, one per element:
// y = L·x with L = [1, 2, 3] becomes y = 1·x, y = 2·x, y = 3·x, a family of curves.
// Each of those then compiles, differentiates and plots like any other row.
//
// Rules (D61):
//  - Operations and functions apply element by element. Two lists in one expression pair
//    up element by element; if their lengths differ the shorter length is used, with a
//    warning.
//  - Positions count from 1 by default (env.base = 0 counts from 0). A position outside
//    the list, or not a whole number, gives undefined with a warning. A position that
//    varies (a sum's counting letter, x, a sequence's n) becomes a 'lookup' node, which
//    the compiler evaluates.
//  - Lists hold numbers, not lists; at most MAX_LIST elements.
//
// Pure module – no DOM access.
//
// env = {
//   angle: 'rad' | 'deg',
//   base: 1 | 0,
//   listVar(name) -> number[] | undefined      a list variable's elements
//   func(name) -> undefined                     not a user function (or has an error)
//               | { listy: false, call(args) }  a function giving a number
//               | { listy: true, params, body } a function giving a list (inlined)
//   constant(node) -> number                    the value of an expression that doesn't
//                                               vary (may throw ExprError)
//   column(set, col, node) -> number[]          a data set's column (Phase 9a-2)
//   warn(message)                               a warning for the row being expanded
// }
import { ExprError } from './errors.js';
import { FUNCTIONS, LIST_FUNCTIONS } from './builtins.js';
import { referencedNames } from './compile.js';
import { factorial, realPow } from '../numerics/special.js';
import { formatNumber } from './format.js';

export const MAX_LIST = 10000;
export const MAX_CURVES = 50;

const PLOT_LOCALS = ['x', 'y', 'r', 'θ', 't'];
const MAX_INLINE_DEPTH = 40;

const S = (node) => ({ s: node });
const L = (items, names = []) => ({ l: items, names });
const numAt = (value, at) => ({ type: 'num', value, start: at ? at.start : -1, end: at ? at.end : -1 });
const fmt = (v) => formatNumber(v, 6);

// Values like 0.1·3 come out as 0.30000000000000004; ranges show them as typed.
function clean(v) {
  return Number.isFinite(v) && v !== 0 ? Number(v.toPrecision(15)) : v;
}

// ---- the expression's children, in a fixed order --------------------------------------

function kidsOf(node) {
  switch (node.type) {
    case 'neg':
    case 'fact': return [node.arg];
    case 'bin': return [node.left, node.right];
    case 'call':
    case 'apply': return node.args;
    case 'tuple':
    case 'cmp': return node.items;
    case 'piecewise': {
      const out = [];
      for (const b of node.branches) {
        out.push(b.cond);
        if (b.value) out.push(b.value);
      }
      if (node.otherwise) out.push(node.otherwise);
      return out;
    }
    case 'lookup': return [node.index];
    default: return [];
  }
}

function rebuild(node, kids) {
  switch (node.type) {
    case 'neg':
    case 'fact': return { ...node, arg: kids[0] };
    case 'bin': return { ...node, left: kids[0], right: kids[1] };
    case 'call':
    case 'apply': return { ...node, args: kids };
    case 'tuple':
    case 'cmp': return { ...node, items: kids };
    case 'piecewise': {
      let i = 0;
      const branches = node.branches.map((b) => {
        const cond = kids[i++];
        const value = b.value ? kids[i++] : null;
        return { cond, value };
      });
      const otherwise = node.otherwise ? kids[i++] : null;
      return { ...node, branches, otherwise };
    }
    case 'lookup': return { ...node, index: kids[0] };
    default: return node;
  }
}

// ---- folding constants (so list arithmetic doesn't compile once per element) ---------------

const BINARY = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '^': realPow,
};

function fold(node, c) {
  const kids = kidsOf(node);
  if (!kids.length || !kids.every((k) => k.type === 'num')) return node;
  const v = kids.map((k) => k.value);
  switch (node.type) {
    case 'neg': return numAt(-v[0], node);
    case 'fact': return numAt(factorial(v[0]), node);
    case 'bin': return BINARY[node.op] ? numAt(BINARY[node.op](v[0], v[1]), node) : node;
    case 'call': {
      const def = FUNCTIONS[node.name];
      if (!def || v.length < def.arity[0] || v.length > def.arity[1]) return node;
      return numAt((c.env.angle === 'deg' ? def.deg : def.rad)(...v), node);
    }
    case 'apply': {
      if (node.primes || c.locals.has(node.name)) return node;
      const f = c.env.func(node.name);
      if (!f || f.listy || f.arity !== v.length) return node;
      return numAt(f.call(v), node);
    }
    default: return node;
  }
}

// ---- combining children element by element ------------------------------------------------

function merge(node, kids, vals, make, c) {
  let n = -1;
  const lengths = new Set();
  const names = [];
  for (const v of vals) {
    if (!v.l) continue;
    lengths.add(v.l.length);
    n = n < 0 ? v.l.length : Math.min(n, v.l.length);
    for (const nm of v.names) if (!names.some((m) => m.name === nm.name)) names.push(nm);
  }
  if (n < 0) {
    if (vals.every((v, i) => v.s === kids[i])) return S(node);
    return S(fold(make(vals.map((v) => v.s)), c));
  }
  if (lengths.size > 1) {
    c.env.warn(`The lists have different lengths (${[...lengths].sort((a, b) => a - b).join(' and ')}), so the first ${n} element${n === 1 ? '' : 's'} of each are used`);
  }
  const out = new Array(n);
  for (let k = 0; k < n; k++) out[k] = fold(make(vals.map((v) => (v.l ? v.l[k] : v.s))), c);
  return L(out, names);
}

function elementwise(node, c) {
  const kids = kidsOf(node);
  const vals = kids.map((k) => ex(k, c));
  return merge(node, kids, vals, (k) => rebuild(node, k), c);
}

// ---- helpers --------------------------------------------------------------------------------

// A context for an inner part: extra names that vary (a sum's counting letter), or
// parameters standing for given values (a function being inlined). Each hides any
// outer meaning of the same name.
function child(c, { locals = [], values = null } = {}) {
  const out = { ...c, locals: new Set(c.locals), values: new Map(c.values) };
  for (const n of locals) {
    out.locals.add(n);
    out.values.delete(n);
  }
  if (values) {
    for (const [k, v] of Object.entries(values)) {
      out.values.set(k, v);
      out.locals.delete(k);
    }
  }
  return out;
}

function varies(node, c) {
  for (const n of referencedNames(node).names) if (c.locals.has(n)) return true;
  return false;
}

// The value of a part that must be a fixed number (a range's ends, a position).
function fixed(node, c, what) {
  const v = ex(node, c);
  if (v.l) throw new ExprError(`The ${what} must be a single number, not a list`, node.start, node.end);
  if (varies(v.s, c)) {
    const n = [...referencedNames(v.s).names].find((m) => c.locals.has(m));
    throw new ExprError(`The ${what} must be a fixed number (it can’t depend on ${n})`, node.start, node.end);
  }
  return v.s.type === 'num' ? v.s.value : c.env.constant(v.s);
}

function rangeValues(node, c) {
  const first = fixed(node.first, c, 'start of a range');
  const last = fixed(node.last, c, 'end of a range');
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    throw new ExprError('The ends of a range must be finite numbers', node.start, node.end);
  }
  let step = last >= first ? 1 : -1;
  if (node.second) {
    const second = fixed(node.second, c, 'second value of a range');
    if (!Number.isFinite(second)) throw new ExprError('The second value of a range must be a finite number', node.second.start, node.second.end);
    step = second - first;
    if (step === 0) throw new ExprError('The first two values of a range must be different', node.start, node.end);
  }
  const span = (last - first) / step;
  if (span < -1e-9) {
    throw new ExprError(`Counting from ${fmt(first)} in steps of ${fmt(step)} never reaches ${fmt(last)}`, node.start, node.end);
  }
  const count = Math.floor(span + 1e-9) + 1;
  if (count > MAX_LIST) {
    throw new ExprError(`A list can have at most ${MAX_LIST.toLocaleString('en')} elements (this range has ${count.toLocaleString('en')})`, node.start, node.end);
  }
  const out = new Array(count);
  for (let k = 0; k < count; k++) out[k] = clean(first + k * step);
  return out;
}

function balanced(op, items, at) {
  if (items.length === 1) return items[0];
  const m = items.length >> 1;
  return { type: 'bin', op, left: balanced(op, items.slice(0, m), at), right: balanced(op, items.slice(m), at), start: at.start, end: at.end };
}

const AGGREGATE = {
  length: (v) => v.length,
  sum: (v) => v.reduce((s, a) => s + a, 0),
  prod: (v) => v.reduce((s, a) => s * a, 1),
  min: (v) => (v.length ? v.reduce((m, a) => (a < m || Number.isNaN(a) ? a : m), v[0]) : NaN),
  max: (v) => (v.length ? v.reduce((m, a) => (a > m || Number.isNaN(a) ? a : m), v[0]) : NaN),
};

// length(L), sum(L), mean(L) …: one number from a list's elements.
function aggregate(name, items, node, c) {
  if (items.every((i) => i.type === 'num')) {
    const v = items.map((i) => i.value);
    const f = AGGREGATE[name] || ((a) => FUNCTIONS[name].rad(...a));
    return numAt(f(v), node);
  }
  switch (name) {
    case 'length': return numAt(items.length, node);
    case 'sum': return items.length ? balanced('+', items, node) : numAt(0, node);
    case 'prod': return items.length ? balanced('*', items, node) : numAt(1, node);
    case 'mean':
      return items.length
        ? { type: 'bin', op: '/', left: balanced('+', items, node), right: numAt(items.length, node), start: node.start, end: node.end }
        : numAt(NaN, node);
    default:
      return items.length ? { ...node, args: items, flat: true } : numAt(NaN, node);
  }
}

function indexMessage(target) {
  if (target.type === 'sym') {
    return PLOT_LOCALS.includes(target.name)
      ? `${target.name} isn’t a list, so it can’t be followed by [ ]. To multiply, write ${target.name}·[…]`
      : `'${target.name}' isn’t a list, so it can’t be followed by [ ]. To multiply, write ${target.name}·[…]`;
  }
  return 'Only a list can be followed by a position in [ ]';
}

// The element at a fixed position.
function pick(items, pos, at, c) {
  const k = pos - c.env.base;
  if (!Number.isInteger(k)) {
    c.env.warn(`A position must be a whole number, not ${fmt(pos)}`);
    return numAt(NaN, at);
  }
  if (k < 0 || k >= items.length) {
    const first = c.env.base;
    c.env.warn(items.length
      ? `Position ${fmt(pos)} is outside the list, which has positions ${first} to ${first + items.length - 1}`
      : `Position ${fmt(pos)} is outside the list, which is empty`);
    return numAt(NaN, at);
  }
  return items[k];
}

function exIndex(node, c) {
  const target = ex(node.target, c);
  if (!target.l) throw new ExprError(indexMessage(node.target), node.target.start, node.target.end);
  const items = target.l;
  const iv = ex(node.index, c);
  if (iv.l) {
    // Several positions: a list.
    const out = iv.l.map((p) => {
      if (varies(p, c)) throw new ExprError('Positions in a list of positions must be fixed numbers', node.index.start, node.index.end);
      return pick(items, p.type === 'num' ? p.value : c.env.constant(p), node, c);
    });
    return L(out);
  }
  const p = iv.s;
  if (varies(p, c)) {
    // A position that changes (L[k] in a sum, L[n] in a sequence): looked up as it runs.
    if (!items.every((i) => i.type === 'num')) {
      throw new ExprError('Here the position must be a fixed number, because the list depends on other values', node.start, node.end);
    }
    return S({
      type: 'lookup', values: items.map((i) => i.value), base: c.env.base, index: p, start: node.start, end: node.end,
    });
  }
  return S(pick(items, p.type === 'num' ? p.value : c.env.constant(p), node, c));
}

function exApply(node, c) {
  const name = node.name;
  if (c.values.has(name) || c.locals.has(name)) return elementwise(node, c);
  const f = node.primes ? null : c.env.func(name);
  if (!f) {
    // Not a function: a(…) multiplies. A list variable multiplies element by element.
    if (!node.primes && node.args.length === 1 && c.env.listVar(name)) {
      return ex({
        type: 'bin', op: '*', implicit: true,
        left: { type: 'sym', name, start: node.nameStart ?? node.start, end: node.nameEnd ?? node.end },
        right: node.args[0], start: node.start, end: node.end,
      }, c);
    }
    if (node.primes && c.env.func(name) && c.env.func(name).listy) {
      throw new ExprError(`${name}${"'".repeat(node.primes)} can’t be worked out, because ${name} gives a list`, node.start, node.end);
    }
    return elementwise(node, c);
  }
  if (!f.listy) return elementwise(node, c);
  // A function whose value is a list: its body, with the arguments in place of its
  // parameters.
  if (node.args.length !== f.params.length) {
    const n = f.params.length;
    throw new ExprError(`${name} takes ${n} argument${n === 1 ? '' : 's'}, not ${node.args.length}`, node.nameStart ?? node.start, node.nameEnd ?? node.end);
  }
  if (c.depth > MAX_INLINE_DEPTH) throw new ExprError('Functions call each other too deeply', node.start, node.end);
  const values = {};
  f.params.forEach((p, i) => { values[p] = ex(node.args[i], c); });
  const inner = child(c, { values });
  inner.depth = c.depth + 1;
  return ex(f.body, inner);
}

function ex(node, c) {
  switch (node.type) {
    case 'num':
      return S(node);
    case 'sym': {
      if (c.values.has(node.name)) return c.values.get(node.name);
      if (c.locals.has(node.name)) return S(node);
      const values = c.env.listVar(node.name);
      if (values) return L(values.map((v) => numAt(v, node)), [{ name: node.name, values }]);
      return S(node);
    }
    case 'list': {
      if (node.items.length > MAX_LIST) {
        throw new ExprError(`A list can have at most ${MAX_LIST.toLocaleString('en')} elements`, node.start, node.end);
      }
      const items = node.items.map((it) => {
        const v = ex(it, c);
        if (v.l) throw new ExprError('A list can’t contain lists', it.start, it.end);
        return v.s;
      });
      return L(items);
    }
    case 'range':
      return L(rangeValues(node, c).map((v) => numAt(v, node)));
    case 'index':
      return exIndex(node, c);
    case 'column':
      return L(c.env.column(node.set, node.col, node).map((v) => numAt(v, node)));
    case 'call': {
      const single = node.args.length === 1;
      if (LIST_FUNCTIONS.has(node.name) && !node.flat) {
        if (!single) {
          throw new ExprError(`${node.name} takes one list, e.g. ${node.name}([1, 2, 3])`, node.nameStart ?? node.start, node.nameEnd ?? node.end);
        }
        const v = ex(node.args[0], c);
        return S(aggregate(node.name, v.l || [v.s], node, c));
      }
      if ((node.name === 'min' || node.name === 'max') && single && !node.flat) {
        const v = ex(node.args[0], c);
        if (v.l) return S(aggregate(node.name, v.l, node, c));
        return v.s === node.args[0] ? S(node) : S(fold({ ...node, args: [v.s] }, c));
      }
      return elementwise(node, c);
    }
    case 'apply':
      return exApply(node, c);
    case 'series': {
      const kids = [node.from, node.to, node.body];
      const inner = child(c, { locals: [node.index] });
      const vals = [ex(node.from, c), ex(node.to, c), ex(node.body, inner)];
      return merge(node, kids, vals, (k) => ({ ...node, from: k[0], to: k[1], body: k[2] }), c);
    }
    case 'nderiv': {
      const kids = node.at ? [node.expr, node.at] : [node.expr];
      const inner = child(c, { locals: [node.v] });
      const vals = [ex(node.expr, inner), ...(node.at ? [ex(node.at, c)] : [])];
      return merge(node, kids, vals, (k) => ({ ...node, expr: k[0], at: node.at ? k[1] : node.at }), c);
    }
    default:
      return elementwise(node, c);
  }
}

function context(env, opts = {}) {
  return {
    env,
    locals: new Set([...PLOT_LOCALS, ...(opts.locals || [])]),
    values: new Map(),
    depth: 0,
  };
}

// Labels for the members of a family: "a = 2" from the list variables that vary, or
// "2 of 5" when the lists have no names.
function labelsOf(n, names) {
  const out = new Array(n);
  for (let k = 0; k < n; k++) {
    const parts = names.filter((nm) => k < nm.values.length).map((nm) => `${nm.name} = ${fmt(nm.values[k])}`);
    out[k] = parts.length ? parts.join(', ') : `${k + 1} of ${n}`;
  }
  return out;
}

// Expand one expression. Returns { node } (a single expression; the same object when
// nothing changed) or { list: [node…], labels }. opts.locals: names that vary (function
// parameters, as well as x, y, r, θ and t).
export function expand(node, env, opts = {}) {
  const v = ex(node, context(env, opts));
  if (!v.l) return { node: v.s };
  return { list: v.l, labels: labelsOf(v.l.length, v.names) };
}

// Expand several parts of one row together (both sides of an equation, the items of an
// inequality), so that lists pair up across them. Returns { parts } or
// { members: [[part…]…], labels }.
export function expandParts(parts, env, opts = {}) {
  const c = context(env, opts);
  const vals = parts.map((p) => ex(p, c));
  const holder = { type: 'parts' };
  const v = merge(holder, parts, vals, (k) => ({ type: 'parts', items: k }), c);
  if (!v.l) return { parts: v.s === holder ? parts : v.s.items };
  return { members: v.l.map((m) => m.items), labels: labelsOf(v.l.length, v.names) };
}

// ---- display -------------------------------------------------------------------------------

// "[1, 4, 9, …, 998001, 1000000]": every element when there are at most `all` of them,
// otherwise the first 3 and last 2 (D61).
export function listText(values, { sig = 8, all = 6 } = {}) {
  const f = (v) => formatNumber(v, sig);
  if (values.length <= all) return `[${values.map(f).join(', ')}]`;
  return `[${values.slice(0, 3).map(f).join(', ')}, …, ${values.slice(-2).map(f).join(', ')}]`;
}

export function countText(n) {
  return `${n.toLocaleString('en')} element${n === 1 ? '' : 's'}`;
}

// ---- converting positions between counting from 1 and from 0 (D61) -------------------------

// Shift every position in an expression's text by delta (+1 to go from counting from 0
// to counting from 1, −1 the other way), keeping the rest of the text as typed: L[2] →
// L[1], L[k] → L[k-1], L[k+1] → L[k], L[2...4] → L[1...3]. Text that doesn't parse is
// returned unchanged. Returns { text, changed }.
export function shiftPositions(text, delta, parse) {
  if (!text || !text.includes('[')) return { text, changed: false };
  let ast;
  try {
    ast = parse(text);
  } catch {
    return { text, changed: false };
  }
  const edits = []; // [start, end, replacement]
  const literal = (n) => (n.type === 'num' ? n.value : n.type === 'neg' && n.arg.type === 'num' && !n.parens ? -n.arg.value : null);
  const write = (v) => (v < 0 ? `-${String(-v)}` : String(v));
  function shift(n) {
    const v = literal(n);
    if (v !== null && n.start >= 0) {
      edits.push([n.start, n.end, write(v + delta)]);
      return;
    }
    if (n.type === 'list') {
      n.items.forEach(shift);
      return;
    }
    if (n.type === 'range') {
      shift(n.first);
      if (n.second) shift(n.second);
      shift(n.last);
      return;
    }
    // k + 1, k - 2: adjust the number at the end.
    if (n.type === 'bin' && (n.op === '+' || n.op === '-') && !n.parens && n.right.type === 'num' && !n.right.parens) {
      const c = (n.op === '+' ? n.right.value : -n.right.value) + delta;
      edits.push([n.left.end, n.end, c === 0 ? '' : c > 0 ? `+${c}` : `-${-c}`]);
      return;
    }
    edits.push([n.end, n.end, delta > 0 ? `+${delta}` : `-${-delta}`]);
  }
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (n.type === 'index') {
      walk(n.target);
      shift(n.index);
      // Positions inside the position itself (L[M[1]]) are shifted too.
      walkInside(n.index);
      return;
    }
    for (const [k, v] of Object.entries(n)) if (k !== 'type' && v && typeof v === 'object') walk(v);
  }
  function walkInside(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'index') {
      walk(n);
      return;
    }
    for (const [k, v] of Object.entries(n)) if (k !== 'type' && v && typeof v === 'object') walkInside(v);
  }
  walk(ast);
  if (!edits.length) return { text, changed: false };
  edits.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let out = text;
  for (const [s, e, r] of edits) out = out.slice(0, s) + r + out.slice(e);
  return { text: out, changed: out !== text };
}
