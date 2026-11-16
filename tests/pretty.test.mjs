import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/js/expr/parser.js';
import { prettyLayout, plainText, isRich } from '../src/js/expr/pretty.js';

const plain = (src) => plainText(prettyLayout(parse(src)));
const rich = (src) => isRich(prettyLayout(parse(src)));

test('powers, roots and subscripts become Unicode in plain text', () => {
  assert.equal(plain('y = x^2 - 3'), 'y = x² − 3');
  assert.equal(plain('y = 2x^-1'), 'y = 2x⁻¹');
  assert.equal(plain('a_1 = 2'), 'a₁ = 2');
  assert.equal(plain('y = sqrt(x)'), 'y = √x');
  assert.equal(plain('y = cbrt(x + 1)'), 'y = ∛(x + 1)');
  assert.equal(plain('y = x^(a+1)'), 'y = x^(a+1)');
  assert.equal(plain('y = 2^3^2'), 'y = 2^(3²)');
});

test('fractions keep the meaning the parser gave them', () => {
  assert.equal(plain('y = 1/2x'), 'y = (1/2)x', '1/2x is (1/2)·x (D11)');
  assert.equal(plain('y = 1/(2x)'), 'y = 1/(2x)');
  assert.equal(plain('y = 2x/3'), 'y = 2x/3');
  assert.equal(plain('y = 1/sqrt(x)'), 'y = 1/√x');
  assert.equal(plain('y = (x+1)/(x-1)'), 'y = (x + 1)/(x − 1)');
  assert.equal(plain('y = e^(-x^2/2)'), 'y = e^(−x²/2)');
});

test('functions, inverse trig, abs, log base and exp', () => {
  assert.equal(plain('y = sin^2 x'), 'y = sin²(x)');
  assert.equal(plain('y = sin^-1 x'), 'y = sin⁻¹(x)');
  assert.equal(plain('y = abs(x - 1)'), 'y = |x − 1|');
  assert.equal(plain('y = log(x, 2)'), 'y = log₂(x)');
  assert.equal(plain('y = exp(x)'), 'y = eˣ');
  assert.equal(plain('y = nCr(5, k)'), 'y = nCr(5, k)');
  assert.equal(plain("y = f'(x)"), 'y = f′(x)');
});

test('signs, products and comparisons', () => {
  assert.equal(plain('y = -x^2'), 'y = −x²');
  assert.equal(plain('y = x + -2'), 'y = x − 2');
  assert.equal(plain('y = x - (x - 1)'), 'y = x − (x − 1)');
  assert.equal(plain('y = 3*4'), 'y = 3·4');
  assert.equal(plain('y = 3x'), 'y = 3x');
  assert.equal(plain('y = (x+1)(x-1)'), 'y = (x + 1)(x − 1)');
  assert.equal(plain('y = {x <= 0: -x, x^2}'), 'y = {x ≤ 0: −x, x²}');
  assert.equal(plain('y = 1.5e-7x'), 'y = 1.5 × 10⁻⁷x');
});

test('sums and products show their limits', () => {
  assert.equal(plain('sum(k^2, k, 1, n)'), 'Σ(k=1…n) k²');
  const box = prettyLayout(parse('prod(k, k, 1, 5)'));
  assert.equal(box.t, 'bigop');
  assert.equal(box.op, 'Π');
});

test('isRich picks out rows worth a preview', () => {
  for (const s of ['y = x^2', 'y = 1/x', 'y = sqrt(x)', 'a_1 = 3', 'sum(k, k, 1, 4)', 'y = abs(x)']) assert.ok(rich(s), s);
  for (const s of ['y = sin(x)', 'y = 2x + 1', 'r = 1 + cos(θ)', '(cos(t), sin(t))', 'a = 2']) assert.ok(!rich(s), s);
});

test('layout boxes have the documented shapes', () => {
  const b = prettyLayout(parse('y = (x+1)/sqrt(x)'));
  assert.equal(b.t, 'row');
  const frac = b.c[2];
  assert.equal(frac.t, 'frac');
  assert.equal(frac.d.t, 'sqrt');
});
