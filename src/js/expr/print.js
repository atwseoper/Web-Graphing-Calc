// Prints an AST back to text that the parser reads the same way, with as few
// brackets as the precedence rules allow. Used to show derivatives and to send
// equations from the Solve tab to the graph.
//
// Multiplication is implicit after a number (2x, 3sin(x)) and between brackets;
// elsewhere it is written with '·' so that letters never run together into a
// function name ("e·x·p", not "exp").

const PREC = { add: 1, mul: 2, neg: 3, pow: 4, atom: 5 };

export function formatLiteral(v) {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : v > 0 ? '1e309' : '-1e309';
  const s = String(Number(v.toPrecision(12)));
  return s.replace('e+', 'e');
}

function precOf(node) {
  switch (node.type) {
    case 'num': return node.value < 0 ? PREC.neg : PREC.atom;
    case 'neg': return PREC.neg;
    case 'bin':
      if (node.op === '+' || node.op === '-') return PREC.add;
      if (node.op === '*' || node.op === '/') return PREC.mul;
      return PREC.pow;
    default: return PREC.atom;
  }
}

const wrap = (s) => `(${s})`;

export function toText(node) {
  switch (node.type) {
    case 'num': return formatLiteral(node.value);
    case 'sym': return node.name;
    case 'neg': {
      const inner = toText(node.arg);
      return `-${precOf(node.arg) <= PREC.add ? wrap(inner) : inner}`;
    }
    case 'fact': {
      const inner = toText(node.arg);
      return `${precOf(node.arg) < PREC.atom ? wrap(inner) : inner}!`;
    }
    case 'bin': return printBin(node);
    case 'call':
    case 'apply':
      return `${node.name}${"'".repeat(node.primes || 0)}(${node.args.map(toText).join(', ')})`;
    case 'tuple': return `(${node.items.map(toText).join(', ')})`;
    case 'cmp': {
      let s = toText(node.items[0]);
      node.ops.forEach((op, i) => { s += ` ${op} ${toText(node.items[i + 1])}`; });
      return s;
    }
    case 'piecewise': {
      const parts = node.branches.map((b) => (b.value ? `${toText(b.cond)}: ${toText(b.value)}` : toText(b.cond)));
      if (node.otherwise) parts.push(toText(node.otherwise));
      return `{${parts.join(', ')}}`;
    }
    case 'series':
      return `${node.op}(${toText(node.body)}, ${node.index}, ${toText(node.from)}, ${toText(node.to)})`;
    case 'nderiv':
      return `(d/d${node.v})(${toText(node.expr)})`;
    default:
      return '?';
  }
}

function printBin(node) {
  const { op, left, right } = node;
  const lp = precOf(left);
  const rp = precOf(right);
  const L = toText(left);
  const R = toText(right);

  if (op === '+' || op === '-') {
    const r = rp <= PREC.add && op === '-' ? wrap(R) : R;
    // a + (-b) prints as a + -b otherwise; brackets keep it readable
    const rr = op === '+' && (right.type === 'neg' || (right.type === 'num' && right.value < 0)) ? wrap(R) : r;
    return `${L} ${op} ${rr}`;
  }

  if (op === '*' || op === '/') {
    const l = lp < PREC.mul ? wrap(L) : L;
    // Same precedence, left to right: the right side needs brackets if it is itself * or /
    // (for '/'), or anything looser than a product.
    const needR = rp < PREC.mul || (op === '/' && rp === PREC.mul) || right.type === 'neg' || (right.type === 'num' && right.value < 0);
    const r = needR ? wrap(R) : R;
    if (op === '/') return `${l}/${r}`;
    const leftIsNumber = left.type === 'num' && left.value >= 0;
    const rightStartsWord = /^[\p{L}(√]/u.test(r) && !/^[eE][+-]?\d/.test(r);
    if (leftIsNumber && rightStartsWord && !/[eE]$/.test(l)) return `${l}${r}`;
    if (l.endsWith(')') && r.startsWith('(')) return `${l}${r}`;
    if (r.startsWith('{')) return `${l}${r}`;
    return `${l}·${r}`;
  }

  // ^ is right-associative: brackets on the left for anything that isn't an atom,
  // on the right for anything looser than a power.
  const l = lp < PREC.atom || left.type === 'fact' ? wrap(L) : L;
  const r = rp < PREC.pow ? wrap(R) : R;
  return `${l}^${r}`;
}
