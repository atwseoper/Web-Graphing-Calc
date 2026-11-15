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
//
// parse() returns { type: 'eq', lhs, rhs } or { type: 'expr', expr }.
//
// Precedence (low -> high): + -  <  * / and implicit multiplication  <  unary -  <  ^  <  !
// so -x^2 = -(x^2), 2^-1 = 0.5, 1/2x = (1/2)x, 2x^2 = 2(x^2).
//
// Functions without parentheses take the following product of non-function
// factors as their argument: sin 2x = sin(2x), sin x cos x = sin(x)·cos(x),
// sin x^2 = sin(x^2), sin x + 1 = sin(x) + 1.
// sin^2 x = (sin x)^2 and sin^-1 x = asin x.
import { ExprError } from './errors.js';
import { tokenize } from './tokenizer.js';
import { isFunctionName, INVERSE_OF } from './builtins.js';

const BP = { add: 10, mul: 20, neg: 30, pow: 40, fact: 50 };

export function parse(src) {
  const p = new Parser(tokenize(src));
  if (p.peek().type === 'eof') throw new ExprError('Empty expression', 0, 0);
  const lhs = p.expr(0);
  let result;
  if (p.isOp('=')) {
    const eq = p.next();
    if (p.peek().type === 'eof') throw new ExprError("Expected an expression after '='", eq.start, eq.end);
    const rhs = p.expr(0);
    if (p.isOp('=')) {
      const t = p.peek();
      throw new ExprError("Only one '=' is allowed", t.start, t.end);
    }
    result = { type: 'eq', lhs, rhs };
  } else {
    result = { type: 'expr', expr: lhs };
  }
  p.expectEnd();
  return result;
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
    throw new ExprError(`Unexpected ${describe(t)}`, t.start, t.end);
  }

  // Can this token start an operand that follows another operand directly
  // (implicit multiplication)? Numbers cannot: "x2" and "2 3" are errors.
  startsImplicitOperand(t) {
    return t.type === 'name' || (t.type === 'op' && t.value === '(');
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
    if (t.type === 'eof' || (t.type === 'op' && (t.value === ')' || t.value === ',' || t.value === '='))) {
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
      if (t.value === '(') return this.parenthesised(t);
      if (t.value === ')') throw new ExprError("Unexpected ')'", t.start, t.end);
      throw new ExprError(`Unexpected '${t.value}'`, t.start, t.end);
    }

    if (t.type === 'name') {
      if (isFunctionName(t.value)) return this.functionCall(t);
      if (this.isOp('(') && !isFunctionName(t.value)) {
        const open = this.next();
        const args = this.argList(open);
        const close = this.tokens[this.pos - 1];
        return { type: 'apply', name: t.value, args, nameStart: t.start, nameEnd: t.end, start: t.start, end: close.end };
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
      args = this.argList(open);
      end = this.tokens[this.pos - 1].end;
    } else {
      const t = this.peek();
      if (t.type === 'eof' || (t.type === 'op' && !['(', '-', '+'].includes(t.value))) {
        throw new ExprError(`${nameTok.value} needs an argument, e.g. ${nameTok.value}(x)`, nameTok.start, nameTok.end);
      }
      // Argument without brackets: a product of non-function factors.
      let arg = this.expr(BP.mul + 1);
      for (;;) {
        const n = this.peek();
        if (n.type === 'name' && !isFunctionName(n.value)) {
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
      return this.parenthesised(t);
    }
    if (t.type === 'name' && !isFunctionName(t.value)) {
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
