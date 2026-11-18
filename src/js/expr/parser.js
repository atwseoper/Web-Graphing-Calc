// Pratt parser: tokens -> AST.
//
// AST node shapes (all carry start/end source offsets):
//   { type: 'num', value }
//   { type: 'sym', name }                      variable or constant
//   { type: 'neg', arg }                       unary minus
//   { type: 'bin', op: '+'|'-'|'*'|'/'|'^', left, right, implicit? }
//   { type: 'fact', arg }                      postfix !
//   { type: 'call', name, args }               built-in function call
//   { type: 'apply', name, args }              name(args): user function call, or
//                                              multiplication if `name` is a variable
//   { type: 'tuple', items }                   (a, b)
//   { type: 'apply', name, args, primes }      f'(x), f''(x): derivative of a user function
//   { type: 'piecewise', branches: [{ cond, value }], otherwise }
//                                              {x < 0: -x, x}; value may be null (= 1),
//                                              otherwise may be null (= undefined)
//   { type: 'cmp', ops: ['<', '<='...], items } chained comparison, only inside { }
//   { type: 'series', op: 'sum'|'prod', body, index, from, to }
//                                              sum(k^2, k, 1, 10)
//
// parse() returns { type: 'eq', lhs, rhs } or { type: 'expr', expr }; with
// { graph: true } also { type: 'ineq', ops, items } for y < x^2 (chains allowed:
// 0 < y < 1), and y' (alone on the left of '=') parses as { type: 'yprime' }.
//
// Precedence (low -> high): + -  <  * / and implicit multiplication  <  unary -  <  ^  <  !
// so -x^2 = -(x^2), 2^-1 = 0.5, 1/2x = (1/2)x, 2x^2 = 2(x^2).
//
// Functions without parentheses take the following product of non-function
// factors as their argument: sin 2x = sin(2x), sin x cos x = sin(x)·cos(x),
// sin x^2 = sin(x^2), sin x + 1 = sin(x) + 1.
// sin^2 x = (sin x)^2 and sin^-1 x = asin x.
//
// Conditions use braces: {x < 0: -x, x} is -x when x < 0 and x otherwise; a branch
// without ':' restricts, so x^2{0 < x < 2} is x^2 for 0 < x < 2 and undefined elsewhere.
// Comparisons are only allowed inside braces.
import { ExprError } from './errors.js';
import { tokenize } from './tokenizer.js';
import { isFunctionName, INVERSE_OF, SERIES } from './builtins.js';

const BP = { add: 10, mul: 20, neg: 30, pow: 40, fact: 50 };
const COMPARISONS = new Set(['<', '>', '<=', '>=']);
const STOPPERS = new Set([')', ',', '=', '}', ':']);
const isCallable = (name) => isFunctionName(name) || SERIES.has(name);

export function parse(src, { graph = false } = {}) {
  const p = new Parser(tokenize(src));
  // Graph rows (graph: true) may also be inequalities, y < x^2 or x^2 + y^2 <= 4, and
  // slope fields written y' = f(x, y).
  p.graph = graph;
  p.topCmp = graph;
  if (p.peek().type === 'eof') throw new ExprError('Empty expression', 0, 0);
  const lhs = p.expr(0);
  let result;
  if (graph && p.peek().type === 'op' && COMPARISONS.has(p.peek().value)) {
    const ops = [];
    const items = [lhs];
    while (p.peek().type === 'op' && COMPARISONS.has(p.peek().value)) {
      const opTok = p.next();
      ops.push(opTok.value);
      items.push(p.operand(0, opTok));
    }
    if (p.isOp('=')) {
      const t = p.peek();
      throw new ExprError("Use either '=' or an inequality (<, ≤, >, ≥), not both", t.start, t.end);
    }
    result = { type: 'ineq', ops, items, start: lhs.start, end: items[items.length - 1].end };
  } else if (p.isOp('=')) {
    const eq = p.next();
    if (p.peek().type === 'eof') throw new ExprError("Expected an expression after '='", eq.start, eq.end);
    const rhs = p.expr(0);
    if (p.isOp('=')) {
      const t = p.peek();
      throw new ExprError("Only one '=' is allowed", t.start, t.end);
    }
    if (p.peek().type === 'op' && COMPARISONS.has(p.peek().value)) {
      const t = p.peek();
      throw new ExprError("Use either '=' or an inequality (<, ≤, >, ≥), not both", t.start, t.end);
    }
    result = { type: 'eq', lhs, rhs };
  } else {
    result = { type: 'expr', expr: lhs };
  }
  p.expectEnd();
  return result;
}

// dy/dx as typed. Implicit multiplication binds like * and /, left to right (D11), so
// "dy/dx" parses as ((d·y)/d)·x.
export function isDyDx(node) {
  const sym = (n, name) => n && n.type === 'sym' && n.name === name && !n.parens;
  return node.type === 'bin' && node.op === '*' && node.implicit && !node.parens && sym(node.right, 'x')
    && node.left.type === 'bin' && node.left.op === '/' && !node.left.parens && sym(node.left.right, 'd')
    && node.left.left.type === 'bin' && node.left.left.op === '*' && node.left.left.implicit && !node.left.left.parens
    && sym(node.left.left.left, 'd') && sym(node.left.left.right, 'y');
}

// Parse a single expression (no '=' allowed), e.g. for domain bounds.
export function parseExpression(src) {
  const r = parse(src);
  if (r.type !== 'expr') throw new ExprError("'=' isn't allowed here", 0, src.length);
  return r.expr;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
    this.allowCmp = false; // true while parsing the operands of a condition
    this.topCmp = false; // comparisons allowed at the top level (graph inequalities)
    this.depth = 0; // nesting inside brackets, function calls and braces
    this.graph = false;
  }

  nested(fn) {
    this.depth++;
    try {
      return fn();
    } finally {
      this.depth--;
    }
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }
  next() {
    return this.tokens[this.pos++];
  }
  isOp(v, offset = 0) {
    const t = this.peek(offset);
    return t.type === 'op' && t.value === v;
  }
  expectOp(v, openTok) {
    if (this.isOp(v)) return this.next();
    const t = this.peek();
    if (t.type === 'eof') {
      throw new ExprError(v === ')' ? "Missing ')'" : `Expected '${v}'`, openTok ? openTok.start : t.start, t.end);
    }
    throw new ExprError(`Expected '${v}' but found ${describe(t)}`, t.start, t.end);
  }
  expectEnd() {
    const t = this.peek();
    if (t.type === 'eof') return;
    if (t.type === 'op' && t.value === ')') throw new ExprError("Unmatched ')'", t.start, t.end);
    if (t.type === 'op' && t.value === '}') throw new ExprError("Unmatched '}'", t.start, t.end);
    throw new ExprError(`Unexpected ${describe(t)}`, t.start, t.end);
  }

  // Can this token start an operand that follows another operand directly
  // (implicit multiplication)? Numbers cannot: "x2" and "2 3" are errors.
  startsImplicitOperand(t) {
    return t.type === 'name' || (t.type === 'op' && (t.value === '(' || t.value === '{'));
  }

  expr(minBp) {
    let left = this.prefix();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op') {
        const op = t.value;
        if ((op === '+' || op === '-') && BP.add > minBp) {
          this.next();
          const right = this.operand(BP.add, t);
          left = bin(op, left, right);
          continue;
        }
        if ((op === '*' || op === '/') && BP.mul > minBp) {
          this.next();
          const right = this.operand(BP.mul, t);
          left = bin(op, left, right);
          continue;
        }
        if (op === '^' && BP.pow > minBp) {
          this.next();
          const right = this.operand(BP.pow - 1, t); // right-associative
          left = bin('^', left, right);
          continue;
        }
        if (op === '!' && BP.fact > minBp) {
          this.next();
          left = { type: 'fact', arg: left, start: left.start, end: t.end };
          continue;
        }
        if (COMPARISONS.has(op)) {
          if (this.allowCmp || (this.topCmp && this.depth === 0)) return left;
          throw new ExprError(this.graph
            ? 'A comparison can be a whole row (y < x^2) or a condition in braces ({x > 0: x}), not part of an expression'
            : 'Inequalities can only be graphed (in the Graph tab). For a condition, use braces: {x > 0: x}', t.start, t.end);
        }
      }
      if (this.startsImplicitOperand(t) && BP.mul > minBp) {
        const right = this.expr(BP.mul);
        left = bin('*', left, right, true);
        continue;
      }
      if (t.type === 'num') {
        throw new ExprError(`Missing operator before ${describe(t)}`, t.start, t.end);
      }
      return left;
    }
  }

  // Parse the right-hand operand of a binary operator, with a friendly error if it's missing.
  operand(bp, opTok) {
    const t = this.peek();
    if (t.type === 'eof' || (t.type === 'op' && (STOPPERS.has(t.value) || COMPARISONS.has(t.value)))) {
      throw new ExprError(`Expected an expression after '${opTok.value}'`, opTok.start, opTok.end);
    }
    return this.expr(bp);
  }

  prefix() {
    const t = this.next();
    if (t.type === 'num') return { type: 'num', value: t.value, start: t.start, end: t.end };

    if (t.type === 'op') {
      if (t.value === '-') {
        const arg = this.operand(BP.neg, t);
        return { type: 'neg', arg, start: t.start, end: arg.end };
      }
      if (t.value === '+') return this.operand(BP.neg, t);
      if (t.value === '(') return this.nested(() => this.parenthesised(t));
      if (t.value === '{') return this.nested(() => this.piecewise(t));
      if (t.value === ')') throw new ExprError("Unexpected ')'", t.start, t.end);
      if (t.value === "'") throw new ExprError("A ' (derivative) goes after a function name, e.g. f'(x)", t.start, t.end);
      throw new ExprError(`Unexpected '${t.value}'`, t.start, t.end);
    }

    if (t.type === 'name') {
      if (SERIES.has(t.value)) return this.nested(() => this.series(t));
      if (isFunctionName(t.value)) {
        if (this.isOp("'")) {
          const q = this.peek();
          throw new ExprError(`Derivatives work on your own functions: define f(x) = ${t.value}(x), then use f'(x)`, t.start, q.end);
        }
        return this.functionCall(t); // only its brackets, if any, count as nesting
      }
      let primes = 0;
      let primeEnd = t.end;
      while (this.isOp("'")) {
        primeEnd = this.next().end;
        primes++;
      }
      if (this.isOp('(')) {
        const open = this.next();
        const args = this.nested(() => this.argList(open));
        const close = this.tokens[this.pos - 1];
        const node = { type: 'apply', name: t.value, args, nameStart: t.start, nameEnd: primeEnd, start: t.start, end: close.end };
        if (primes) node.primes = primes;
        return node;
      }
      if (primes === 1 && this.graph && t.value === 'y' && this.depth === 0 && this.pos === 2) {
        return { type: 'yprime', start: t.start, end: primeEnd }; // y' = f(x, y): a slope field
      }
      if (primes) {
        throw new ExprError(`Write the derivative with brackets, e.g. ${t.value}${"'".repeat(primes)}(x)`, t.start, primeEnd);
      }
      return { type: 'sym', name: t.value, start: t.start, end: t.end };
    }

    if (t.type === 'eof') throw new ExprError('The expression is incomplete', t.start, t.end);
    throw new ExprError(`Unexpected ${describe(t)}`, t.start, t.end);
  }

  parenthesised(open) {
    if (this.isOp(')')) {
      const close = this.next();
      throw new ExprError('Empty brackets', open.start, close.end);
    }
    const first = this.expr(0);
    if (this.isOp(',')) {
      const items = [first];
      while (this.isOp(',')) {
        const comma = this.next();
        if (this.isOp(')') || this.peek().type === 'eof') {
          throw new ExprError("Expected an expression after ','", comma.start, comma.end);
        }
        items.push(this.expr(0));
      }
      const close = this.expectOp(')', open);
      return { type: 'tuple', items, start: open.start, end: close.end };
    }
    const close = this.expectOp(')', open);
    return { ...first, start: open.start, end: close.end, parens: true };
  }

  // { cond: value, cond: value, otherwise } after '{' has been consumed.
  piecewise(open) {
    if (this.isOp('}')) {
      const close = this.next();
      throw new ExprError('Empty braces', open.start, close.end);
    }
    const branches = [];
    let otherwise = null;
    for (;;) {
      const t = this.peek();
      if (t.type === 'eof') throw new ExprError("Missing '}'", open.start, t.end);
      const saved = this.allowCmp;
      this.allowCmp = true;
      const first = this.expr(0);
      let cond = null;
      if (this.peek().type === 'op' && COMPARISONS.has(this.peek().value)) {
        const ops = [];
        const items = [first];
        while (this.peek().type === 'op' && COMPARISONS.has(this.peek().value)) {
          const opTok = this.next();
          ops.push(opTok.value);
          items.push(this.operand(0, opTok));
        }
        cond = { type: 'cmp', ops, items, start: first.start, end: items[items.length - 1].end };
      }
      this.allowCmp = saved;
      if (otherwise) {
        throw new ExprError('The value for "otherwise" must come last', otherwise.start, otherwise.end);
      }
      if (this.isOp(':')) {
        const colon = this.next();
        if (!cond) throw new ExprError("Expected a condition before ':', e.g. {x < 0: -x, x}", first.start, colon.end);
        branches.push({ cond, value: this.operand(0, colon) });
      } else if (cond) {
        branches.push({ cond, value: null });
      } else {
        otherwise = first;
      }
      if (this.isOp(',')) {
        const comma = this.next();
        if (this.isOp('}')) throw new ExprError("Expected a condition or value after ','", comma.start, comma.end);
        continue;
      }
      const close = this.expectOp('}', open);
      if (!branches.length) throw new ExprError('Braces need a condition, e.g. {x > 0}', open.start, close.end);
      return { type: 'piecewise', branches, otherwise, start: open.start, end: close.end };
    }
  }

  // sum(body, k, from, to) / prod(...)
  series(nameTok) {
    const label = nameTok.value;
    if (!this.isOp('(')) {
      throw new ExprError(`Write ${label}(expression, k, from, to), e.g. ${label}(k^2, k, 1, 10)`, nameTok.start, nameTok.end);
    }
    const open = this.next();
    const args = this.argList(open);
    const end = this.tokens[this.pos - 1].end;
    if (args.length !== 4) {
      throw new ExprError(`${label} takes 4 arguments: ${label}(expression, k, from, to)`, nameTok.start, end);
    }
    const [body, index, from, to] = args;
    if (index.type !== 'sym' || index.parens) {
      throw new ExprError(`The second argument of ${label} must be the counting letter, e.g. k`, index.start, index.end);
    }
    return { type: 'series', op: label, body, index: index.name, from, to, start: nameTok.start, end, nameStart: nameTok.start, nameEnd: nameTok.end };
  }

  // After '(' has been consumed: comma-separated expressions then ')'.
  argList(open) {
    const args = [];
    if (this.isOp(')')) {
      const close = this.next();
      throw new ExprError('Empty brackets', open.start, close.end);
    }
    for (;;) {
      args.push(this.expr(0));
      if (this.isOp(',')) {
        const comma = this.next();
        if (this.isOp(')') || this.peek().type === 'eof') {
          throw new ExprError("Expected an expression after ','", comma.start, comma.end);
        }
        continue;
      }
      this.expectOp(')', open);
      return args;
    }
  }

  functionCall(nameTok) {
    let name = nameTok.value;
    let power = null;

    // sin^2 x, sin^-1 x
    if (this.isOp('^')) {
      const caret = this.next();
      const exponent = this.functionPower(caret);
      if (exponent.type === 'neg' && exponent.arg.type === 'num' && exponent.arg.value === 1 && INVERSE_OF[name]) {
        name = INVERSE_OF[name];
      } else {
        power = exponent;
      }
    }

    let args;
    let end;
    if (this.isOp('(')) {
      const open = this.next();
      args = this.nested(() => this.argList(open));
      end = this.tokens[this.pos - 1].end;
    } else {
      const t = this.peek();
      if (t.type === 'eof' || (t.type === 'op' && !['(', '-', '+', '{'].includes(t.value))) {
        throw new ExprError(`${nameTok.value} needs an argument, e.g. ${nameTok.value}(x)`, nameTok.start, nameTok.end);
      }
      // Argument without brackets: a product of non-function factors.
      let arg = this.expr(BP.mul + 1);
      for (;;) {
        const n = this.peek();
        if (n.type === 'name' && !isCallable(n.value)) {
          arg = bin('*', arg, this.expr(BP.mul + 1), true);
        } else if (n.type === 'op' && n.value === '(') {
          arg = bin('*', arg, this.expr(BP.mul + 1), true);
        } else {
          break;
        }
      }
      args = [arg];
      end = arg.end;
    }

    let node = { type: 'call', name, args, nameStart: nameTok.start, nameEnd: nameTok.end, start: nameTok.start, end };
    if (power) node = { type: 'bin', op: '^', left: node, right: power, start: node.start, end };
    return node;
  }

  // Exponent directly after a function name: a number, a name, a bracketed
  // expression, or a negated one of those.
  functionPower(caret) {
    const t = this.peek();
    if (t.type === 'op' && t.value === '-') {
      this.next();
      const arg = this.functionPower(caret);
      return { type: 'neg', arg, start: t.start, end: arg.end };
    }
    if (t.type === 'num') {
      this.next();
      return { type: 'num', value: t.value, start: t.start, end: t.end };
    }
    if (t.type === 'op' && t.value === '(') {
      this.next();
      return this.nested(() => this.parenthesised(t));
    }
    if (t.type === 'name' && !isCallable(t.value)) {
      this.next();
      return { type: 'sym', name: t.value, start: t.start, end: t.end };
    }
    throw new ExprError("Expected an exponent after '^'", caret.start, caret.end);
  }
}

function bin(op, left, right, implicit = false) {
  const node = { type: 'bin', op, left, right, start: left.start, end: right.end };
  if (implicit) node.implicit = true;
  return node;
}

function describe(t) {
  if (t.type === 'num') return `'${t.value}'`;
  if (t.type === 'name') return `'${t.value}'`;
  if (t.type === 'eof') return 'end of expression';
  return `'${t.value}'`;
}
