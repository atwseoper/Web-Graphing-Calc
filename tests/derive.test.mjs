import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseExpression } from '../src/js/expr/parser.js';
import { derive } from '../src/js/expr/derive.js';
import { toText } from '../src/js/expr/print.js';
import { analyse } from '../src/js/expr/model.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// Numeric derivative of y = text at x, for cross-checking symbolic results.
function numericSlope(text, x, angle = 'rad') {
  const r = analyse([{ text: `y = ${text}` }], { angle }).rows[0];
  const h = 1e-5 * Math.max(1, Math.abs(x));
  return (r.f(x + h) - r.f(x - h)) / (2 * h);
}
function symbolic(text, angle = 'rad') {
  const r = analyse([{ text: `y = ${text}` }], { angle }).rows[0];
  assert.ok(r.derivative, `${text}: ${JSON.stringify(r.error)}`);
  const d = r.derivative();
  assert.ok(d, `${text}: no derivative`);
  return d;
}

test('derive: symbolic results print simply', () => {
  const d = (s) => toText(derive(parseExpression(s), 'x'));
  assert.equal(d('x^3 - 2x'), '3x^2 - 2');
  assert.equal(d('sin(x)cos(x)'), 'cos(x)^2 - sin(x)^2');
  assert.equal(d('1/x'), '-1/x^2');
  assert.equal(d('sqrt(x^2+1)'), 'x/sqrt(x^2 + 1)');
  assert.equal(d('ln(x)/x'), '(1 - ln(x))/x^2');
  assert.equal(d('x^x'), 'x^x·(ln(x) + 1)');
  assert.equal(d('x^(1/3)'), 'x^(-2/3)/3');
  assert.equal(d('a x^2 + b x'), '2a·x + b');
  assert.equal(d('abs(x)'), 'sign(x)');
  assert.equal(d('{x < 0: -x, x^2}'), '{x < 0: -1, 2x}');
  assert.equal(d('x^2{0 < x < 2}'), '2x{0 < x < 2}');
  assert.equal(d('5'), '0');
  assert.equal(d('k'), '0');
});

test('derive: matches numeric slopes across the function library', () => {
  const cases = [
    ['sin(3x) + cos(x)^2', 0.7], ['tan(x)', 0.4], ['sec(x) + csc(x) + cot(x)', 1.1],
    ['asin(x/2) + acos(x/3) + atan(x)', 0.3], ['sinh(x) cosh(x) tanh(x)', 0.6],
    ['asinh(x) + acosh(x + 2) + atanh(x/2)', 0.5], ['exp(-x^2)', 0.8], ['ln(x^2 + 1)', 1.7],
    ['log(x)', 2.5], ['log(x, 2)', 3], ['cbrt(x)', -2], ['2^x·3^(-x)', 1.2], ['x^x', 1.3],
    ['mod(x, 2)', 0.7], ['min(x, 1 - x)', 0.2], ['max(x^2, 2)', 1.9], ['x^(1/3)', -8],
    ['sum(x^k/k!, k, 0, 6)', 1.1], ['gamma(x)', 2.5], ['x!', 1.5], ['nCr(x, 2)', 4.5],
  ];
  for (const [text, x] of cases) {
    const d = symbolic(text);
    assert.ok(close(d.f(x), numericSlope(text, x), 1e-6), `${text} at ${x}: ${d.f(x)} vs ${numericSlope(text, x)}`);
  }
});

test('derive: degree mode scales trig derivatives', () => {
  const d = symbolic('sin(x)', 'deg');
  assert.ok(close(d.f(60), (Math.PI / 180) * 0.5));
  const inv = symbolic('atan(x)', 'deg');
  assert.ok(close(inv.f(1), (180 / Math.PI) * 0.5));
});

test("derive: f'(x), f''(x) and user functions inside rows", () => {
  const a = analyse([
    { text: 'f(x) = x^3 - 2x' },
    { text: "y = f'(x)" },
    { text: "f''(2)" },
    { text: 'g(t) = sin(t) + k' },
    { text: 'k = 4' },
    { text: "y = g'(2x)" },
    { text: 'y = f(x) g(x)' },
  ]);
  assert.equal(a.rows[0].derivative().text, '3x^2 - 2');
  assert.ok(close(a.rows[1].f(2), 10));
  assert.equal(a.rows[2].value, 12);
  assert.ok(close(a.rows[5].f(0.5), Math.cos(1)));
  const fg = a.rows[6].derivative();
  const x = 0.9;
  const expected = (3 * x * x - 2) * (Math.sin(x) + 4) + (x ** 3 - 2 * x) * Math.cos(x);
  assert.ok(close(fg.f(x), expected));
  // numeric fallbacks are flagged and have no text
  const gm = symbolic('gamma(x)');
  assert.equal(gm.numeric, true);
  assert.equal(gm.text, null);
});

test('print: output parses back to the same structure', () => {
  const cases = ['1/(2x)', '(a + b)^2', '-x^2', '(-x)^2', 'a - (b - c)', '2^3^2', '(2^3)^2', 'x^(-1)',
    'sin(x)^2', '{x < 0: -x, x}', 'sum(k^2, k, 1, n)', "f'(x)", '2x·sin(x)', 'e^(2x)', '(x + 1)(x - 1)', 'x!^2', '-(x + 1)'];
  for (const s of cases) {
    const once = toText(parseExpression(s));
    const twice = toText(parseExpression(once));
    assert.equal(twice, once, `${s} -> ${once} -> ${twice}`);
  }
  assert.equal(toText(parseExpression('e x p')), 'e·x·p'); // never runs letters into "exp"
  assert.equal(toText(parseExpression('1/(2x)')), '1/(2x)');
  // values agree after printing
  const r = analyse([{ text: `y = ${toText(derive(parseExpression('x^x sin(x)/ln(x)'), 'x'))}` }]).rows[0];
  assert.ok(close(r.f(2.2), numericSlope('x^x sin(x)/ln(x)', 2.2), 1e-6));
});

test('syntax: conditions, restrictions, sum and prod', () => {
  const val = (t) => analyse([{ text: t }]).rows[0].value;
  const fx = (t, x) => analyse([{ text: t }]).rows[0].f(x);
  assert.equal(fx('y = {x < 0: -x, x^2}', -3), 3);
  assert.equal(fx('y = {x < 0: -x, x^2}', 3), 9);
  assert.ok(Number.isNaN(fx('y = x^2{0 < x < 2}', 3)));
  assert.equal(fx('y = x^2{0 < x < 2}', 1.5), 2.25);
  assert.equal(fx('y = {x <= 1: 5, x >= 2: 7}', 1), 5);
  assert.ok(Number.isNaN(fx('y = {x <= 1: 5, x >= 2: 7}', 1.5)));
  assert.equal(fx('y = {x ≥ 2: 7, 0}', 2), 7);
  assert.equal(val('sum(k^2, k, 1, 10)'), 385);
  assert.equal(val('Σ(k, k, 1, 100)'), 5050);
  assert.equal(val('prod(k, k, 1, 5)'), 120);
  assert.equal(val('sum(k, k, 5, 1)'), 0); // empty sum
  assert.ok(close(fx('y = sum(x^k/k!, k, 0, 20)', 1), Math.E));
  // the counting letter is local: it doesn't need defining and doesn't clash with x
  assert.equal(fx('y = sum(x, x, 1, 3)', 99), 6);

  const err = (t) => analyse([{ text: t }]).rows[0].error.message;
  assert.match(err('y = x < 1'), /Inequalities aren't supported yet/);
  assert.match(err('y = {x}'), /need a condition/);
  assert.match(err('y = {x < 0: 1, 2, x > 3: 4}'), /must come last/);
  assert.match(err('sum(k, k, 1)'), /4 arguments/);
  assert.match(err('sum(k, 2, 1, 3)'), /counting letter/);
  assert.match(err("f'(x) = 2"), /worked out from f/);
  assert.match(err("y = sin'(x)"), /define f\(x\) = sin\(x\)/);
  assert.equal(parse("f''(x)").expr.primes, 2);
});

test('fixes: unknown multi-letter functions and missing names', () => {
  const a = analyse([{ text: 'y = set(x)' }, { text: 'foo' }, { text: 'y = k x + c' }, { text: 'y = q(x + 1)' }, { text: 'b = 2m' }]);
  assert.equal(a.rows[0].error.message, "Unknown function 'set'");
  assert.equal(a.rows[0].error.missing, undefined);
  assert.match(a.rows[1].error.message, /'foo' means f·o·o/);
  assert.deepEqual(a.rows[2].error.missing, ['k', 'c']);
  assert.deepEqual(a.rows[3].error.missing, ['q']);
  assert.deepEqual(a.rows[4].error.missing, ['m']);
  assert.equal(a.evaluate('abc(2)').error.message, "Unknown function 'abc'");
  // defined letters still multiply: ab(x) = a·b·x
  const ok = analyse([{ text: 'a = 2' }, { text: 'b = 3' }, { text: 'ab(4)' }]);
  assert.equal(ok.rows[2].value, 24);
  // sliders: variables set to a plain number
  const s = analyse([{ text: 'a = -2.5' }, { text: 'b = 2a' }]);
  assert.equal(s.rows[0].slider, true);
  assert.equal(s.rows[1].slider, false);
});
