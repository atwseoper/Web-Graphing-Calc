// Pretty-printing (D33): turns a parsed expression into a tree of layout boxes that the
// UI draws as maths – stacked fractions, raised powers, radicals, Σ with limits – and
// into a one-line Unicode string (x², √x, ·) for places that can only show text, like
// the key of an exported image. Pure module – no DOM access.
//
// Boxes:
//   { t: 'text', s, k }            k: 'var' | 'num' | 'op' | 'sign' | 'fn' | 'punct'
//   { t: 'row', c: [box…] }
//   { t: 'frac', n, d }
//   { t: 'sup', b, e }             b raised to e
//   { t: 'sub', b, s }             b with subscript s
//   { t: 'sqrt', c, i? }           radical, optional index (∛)
//   { t: 'paren', c, open, close } brackets that grow with their contents
//   { t: 'bigop', op, lo, hi, c }  Σ / Π with limits below and above

import { isDyDx } from './parser.js';

const PREC = { cmp: 0, add: 1, mul: 2, neg: 3, pow: 4, atom: 5 };

const FN_NAMES = {
  asin: ['sin', '-1'], acos: ['cos', '-1'], atan: ['tan', '-1'],
  asinh: ['sinh', '-1'], acosh: ['cosh', '-1'], atanh: ['tanh', '-1'],
  ncr: 'nCr', npr: 'nPr', gamma: 'Γ',
};
const CMP = { '<': '<', '>': '>', '<=': '≤', '>=': '≥' };

const text = (s, k) => ({ t: 'text', s, k });
const row = (...c) => ({ t: 'row', c: c.flat().filter(Boolean) });
const op = (s) => text(s, 'op');
const sign = () => text('−', 'sign'); // unary minus
const paren = (c, open = '(', close = ')') => ({ t: 'paren', c, open, close });

function formatNum(v) {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return text(String(Math.abs(v)), 'num');
  if (!Number.isFinite(v)) return text('∞', 'num');
  const s = String(Number(Math.abs(v).toPrecision(12)));
  const m = /^([\d.]+)e([+-]\d+)$/.exec(s);
  if (!m) return text(s, 'num');
  return row(text(m[1], 'num'), op('×'), { t: 'sup', b: text('10', 'num'), e: text(String(Number(m[2])).replace('-', '−'), 'num') });
}

function symbol(name) {
  if (name === 'Ans') return text('Ans', 'fn');
  const m = /^(.+?)_(.+)$/.exec(name);
  if (m) return { t: 'sub', b: text(m[1], 'var'), s: text(m[2], /^\d+$/.test(m[2]) ? 'num' : 'var') };
  return text(name, name === 'π' || name === 'e' ? 'num' : 'var');
}

function precOf(node) {
  switch (node.type) {
    case 'num': return node.value < 0 ? PREC.neg : PREC.atom;
    case 'neg': return PREC.neg;
    case 'cmp': return PREC.cmp;
    case 'bin':
      if (node.op === '+' || node.op === '-') return PREC.add;
      if (node.op === '*') return PREC.mul;
      if (node.op === '/') return PREC.atom; // drawn as a stacked fraction
      return PREC.pow;
    default: return PREC.atom;
  }
}

const isNeg = (n) => n.type === 'neg' || (n.type === 'num' && n.value < 0);

function lay(node) {
  switch (node.type) {
    case 'num': return node.value < 0 ? row(sign(), formatNum(node.value)) : formatNum(node.value);
    case 'sym': return symbol(node.name);
    case 'neg': {
      const inner = lay(node.arg);
      return row(sign(), precOf(node.arg) <= PREC.add ? paren(inner) : inner);
    }
    case 'fact': {
      const inner = lay(node.arg);
      return row(precOf(node.arg) < PREC.atom || node.arg.type === 'bin' ? paren(inner) : inner, op('!'));
    }
    case 'bin': return layBin(node);
    case 'call': return layCall(node);
    case 'apply': {
      const name = symbol(node.name);
      const primes = node.primes ? text('′'.repeat(node.primes), 'op') : null;
      return row(name, primes, paren(list(node.args)));
    }
    case 'tuple': return paren(list(node.items));
    case 'cmp': {
      const out = [lay(node.items[0])];
      node.ops.forEach((o, i) => out.push(op(CMP[o] || o), lay(node.items[i + 1])));
      return row(out);
    }
    case 'piecewise': {
      const parts = [];
      node.branches.forEach((b, i) => {
        if (i) parts.push(text(', ', 'punct'));
        parts.push(lay(b.cond));
        if (b.value) parts.push(text(': ', 'punct'), lay(b.value));
      });
      if (node.otherwise) parts.push(text(', ', 'punct'), lay(node.otherwise));
      return paren(row(parts), '{', '}');
    }
    case 'series': {
      const body = lay(node.body);
      return {
        t: 'bigop',
        op: node.op === 'sum' ? 'Σ' : 'Π',
        lo: row(symbol(node.index), op('='), lay(node.from)),
        hi: lay(node.to),
        c: precOf(node.body) <= PREC.add ? paren(body) : body,
      };
    }
    case 'yprime': return text('y′', 'var');
    case 'nderiv':
      return row({ t: 'frac', n: text('d', 'fn'), d: row(text('d', 'fn'), symbol(node.v)) }, paren(lay(node.expr)));
    default:
      return text('?', 'punct');
  }
}

function list(items) {
  const out = [];
  items.forEach((it, i) => {
    if (i) out.push(text(', ', 'punct'));
    out.push(lay(it));
  });
  return row(out);
}

function layCall(node) {
  const { name, args } = node;
  if (name === 'sqrt') return { t: 'sqrt', c: lay(args[0]) };
  if (name === 'cbrt') return { t: 'sqrt', c: lay(args[0]), i: text('3', 'num') };
  if (name === 'abs') return paren(lay(args[0]), '|', '|');
  if (name === 'floor') return paren(lay(args[0]), '⌊', '⌋');
  if (name === 'ceil') return paren(lay(args[0]), '⌈', '⌉');
  if (name === 'exp' && args.length === 1) return { t: 'sup', b: text('e', 'num'), e: lay(args[0]) };
  if (name === 'log' && args.length === 2) {
    return row({ t: 'sub', b: text('log', 'fn'), s: lay(args[1]) }, paren(lay(args[0])));
  }
  const n = FN_NAMES[name] || name;
  const head = Array.isArray(n) ? { t: 'sup', b: text(n[0], 'fn'), e: text(n[1].replace('-', '−'), 'num') } : text(n, 'fn');
  return row(head, paren(list(args)));
}

function layBin(node) {
  const { op: o, left, right } = node;
  const lp = precOf(left);
  const rp = precOf(right);

  if (o === '/') return { t: 'frac', n: lay(left), d: lay(right) };

  if (o === '^') {
    let base = lay(left);
    // sin(x)^2 is drawn as sin²(x)
    if (left.type === 'call' && !['sqrt', 'cbrt', 'abs', 'floor', 'ceil', 'exp'].includes(left.name) && !FN_NAMES[left.name] && !(left.name === 'log' && left.args.length === 2)) {
      return row({ t: 'sup', b: text(left.name, 'fn'), e: lay(right) }, paren(list(left.args)));
    }
    const atomic = (left.type === 'num' && left.value >= 0) || left.type === 'sym' || left.type === 'call' || left.type === 'apply' || left.type === 'tuple';
    if (!atomic) base = paren(base);
    return { t: 'sup', b: base, e: lay(right) };
  }

  if (o === '+' || o === '-') {
    const L = lay(left);
    if (o === '+' && isNeg(right)) {
      // a + -b: show it as a − b only when it reads the same
      const R = right.type === 'neg' ? lay(right.arg) : formatNum(right.value);
      const wrapR = right.type === 'neg' && precOf(right.arg) <= PREC.add;
      return row(L, op('−'), wrapR ? paren(R) : R);
    }
    const R = lay(right);
    return row(L, op(o === '-' ? '−' : '+'), o === '-' && rp <= PREC.add ? paren(R) : R);
  }

  // multiplication
  let L = lay(left);
  let R = lay(right);
  if (lp < PREC.mul) L = paren(L);
  if (rp < PREC.mul || isNeg(right)) R = paren(R);
  const numThenNum = (left.type === 'num' || (left.type === 'bin' && left.op === '*' && left.right.type === 'num')) && right.type === 'num';
  if (node.implicit && !numThenNum) return row(L, R);
  return row(L, op('·'), R);
}

// Layout for a parse() result ({ type: 'eq' } or { type: 'expr' }).
export function prettyLayout(parsed) {
  if (parsed.type === 'eq') {
    const lhs = isDyDx(parsed.lhs)
      ? { t: 'frac', n: text('dy', 'var'), d: text('dx', 'var') }
      : lay(parsed.lhs);
    return row(lhs, op('='), lay(parsed.rhs));
  }
  if (parsed.type === 'expr') return lay(parsed.expr);
  if (parsed.type === 'ineq') {
    const out = [lay(parsed.items[0])];
    parsed.ops.forEach((o, i) => out.push(op(CMP[o] || o), lay(parsed.items[i + 1])));
    return row(out);
  }
  return lay(parsed);
}

// Whether the layout shows anything a plain one-line reading doesn't: a fraction,
// power, radical, Σ/Π, subscript or |…|.
export function isRich(box) {
  switch (box.t) {
    case 'frac': case 'sup': case 'sqrt': case 'bigop': case 'sub': return true;
    case 'paren': return box.open !== '(' || isRich(box.c);
    case 'row': return box.c.some(isRich);
    default: return false;
  }
}

// ---- one-line Unicode text --------------------------------------------------------------
const SUP = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '+': '⁺', '−': '⁻', '-': '⁻', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', y: 'ʸ', '.': '·',
};
const SUB = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '−': '₋', '-': '₋',
};
const mapAll = (s, table) => ([...s].every((ch) => table[ch]) ? [...s].map((ch) => table[ch]).join('') : null);

// Plain text with brackets wherever the two-dimensional layout would be ambiguous.
export function plainText(box, ctx = {}) {
  switch (box.t) {
    case 'text': {
      if (box.k === 'op') return ['+', '−', '=', '<', '>', '≤', '≥', '×'].includes(box.s) ? ` ${box.s} ` : box.s;
      return box.s;
    }
    case 'row': {
      // A fraction followed directly by something else is bracketed: (1/2)x.
      return box.c.map((c, i) => {
        const t = plainText(c, ctx);
        const next = box.c[i + 1];
        return c.t === 'frac' && next && !(next.t === 'text' && next.k === 'op') && !t.startsWith('(') ? `(${t})` : t;
      }).join('');
    }
    case 'paren': return `${box.open}${plainText(box.c)}${box.close}`;
    case 'frac': {
      const n = plainText(box.n);
      const d = plainText(box.d);
      // a/b·c reads as (a/b)·c, so the denominator must be a single item; the
      // numerator only needs to be free of + − and other fractions.
      const simpleN = (!/[ /]/.test(n) && !/^\(/.test(n)) || (/^\(.*\)$/.test(n) && balanced(n));
      const simpleD = isAtom(box.d) && !/[ /]/.test(d);
      return `${simpleN ? n : `(${n})`}/${simpleD ? d : `(${d})`}`;
    }
    case 'sup': {
      const b = plainText(box.b);
      const e = plainText(box.e).replace(/ /g, '');
      const sup = mapAll(e, SUP);
      return sup ? `${b}${sup}` : `${b}^${/^[\p{L}\d.]+$/u.test(e) ? e : `(${e})`}`;
    }
    case 'sub': {
      const s = plainText(box.s);
      return `${plainText(box.b)}${mapAll(s, SUB) || `_${s}`}`;
    }
    case 'sqrt': {
      const c = plainText(box.c);
      const sym = box.i ? '∛' : '√';
      return /^[\p{L}\d.]+$/u.test(c) ? `${sym}${c}` : `${sym}(${c})`;
    }
    case 'bigop': {
      return `${box.op}(${plainText(box.lo).replace(/ /g, '')}…${plainText(box.hi).replace(/ /g, '')}) ${plainText(box.c)}`;
    }
    default: return '';
  }
}

function isAtom(box) {
  if (box.t === 'row') return box.c.length === 1 && isAtom(box.c[0]);
  return box.t === 'text' ? box.k !== 'op' && box.k !== 'sign' : box.t !== 'frac' && box.t !== 'bigop';
}

function balanced(s) {
  // "(a)(b)" starts and ends with brackets but isn't one bracketed group
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    if (depth === 0 && i < s.length - 1) return false;
  }
  return true;
}
