import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../src/js/expr/model.js';
import { solveEquation, solvePolynomial, solveSystem, polynomialText } from '../src/js/expr/solve.js';
import { serialize, deserialize } from '../src/js/state/persist.js';
import { defaultState } from '../src/js/state/defaults.js';

const close = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const A = analyse([{ text: 'k = 2' }, { text: 'f(x) = x^2' }]);

test('solveEquation: one unknown, with residuals and graph rows', () => {
  const r = solveEquation(A, 'x^3 - 2x = 5');
  assert.equal(r.roots.length, 1);
  assert.ok(close(r.roots[0].x, 2.0945514815423265, 1e-15));
  assert.ok(r.roots[0].residual < 1e-14);
  assert.deepEqual(r.graph, ['y = x^3 - 2x', 'y = 5']);
  assert.ok(r.frame[0] < 2.09 && r.frame[1] > 2.1);

  const dottie = solveEquation(A, 'cos x = x');
  assert.ok(close(dottie.roots[0].x, 0.7390851332151607, 1e-15));

  // Graph definitions can be used
  const fk = solveEquation(A, 'f(x) = k');
  assert.deepEqual(fk.roots.map((z) => Math.round(z.x * 1e12) / 1e12), [-1.414213562373, 1.414213562373]);

  // Nothing in [-10, 10]: the search widens automatically
  const far = solveEquation(A, 'x = 123.5');
  assert.ok(close(far.roots[0].x, 123.5));
  assert.deepEqual(far.range, [-1000, 1000]);

  // a user range
  const sin = solveEquation(A, 'sin(x) = 0.5', { from: '0', to: '2π' });
  assert.equal(sin.roots.length, 2);
  assert.ok(close(sin.roots[0].x, Math.PI / 6, 1e-14) && close(sin.roots[1].x, (5 * Math.PI) / 6, 1e-14));
  assert.equal(sin.auto, false);

  // touching root
  const touch = solveEquation(A, '(x - 3.3)^2', { from: '-9.87', to: '10' });
  assert.equal(touch.roots.length, 1);
  assert.ok(touch.roots[0].tangential && Math.abs(touch.roots[0].x - 3.3) < 1e-7);

  assert.equal(solveEquation(A, 'x^2 + 1 = 0').roots.length, 0);
  assert.equal(solveEquation(A, '   ').empty, true);
});

test('solveEquation: solving a formula for any unknown', () => {
  const r = solveEquation(A, 'v = u + a t', { solveFor: 't', given: { v: '20', u: '5', a: '9.8' } });
  assert.equal(r.solveFor, 't');
  assert.ok(close(r.roots[0].x, 15 / 9.8));
  assert.equal(r.renamed, 't');
  assert.deepEqual(r.graph, ['y = 20', 'y = 5 + 9.8x']);
  const needs = solveEquation(A, 'v = u + a t', { solveFor: 'a', given: { v: '1' } });
  assert.deepEqual(needs.needs, ['u', 't']);
  assert.equal(needs.roots, undefined);
  const bad = solveEquation(A, 'v = u + a t', { solveFor: 'a', given: { v: '1', u: 'q', t: '2' } });
  assert.match(bad.givenErrors.u, /'q' is not defined/);
  assert.match(solveEquation(A, 'k = 2').error.message, /no unknown/);
  assert.match(solveEquation(A, 'x^2 = ').error.message, /Expected an expression/);
});

test('solvePolynomial: all roots, complex and repeated', () => {
  const r = solvePolynomial(A, 'x^3 - 6x^2 + 11x = 6');
  assert.deepEqual(r.coefficients, [-6, 11, -6, 1]);
  assert.deepEqual(r.roots.map((z) => [Math.round(z.re * 1e12) / 1e12, z.im]), [[1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(r.graph, ['y = x^3 - 6x^2 + 11x - 6']);
  const z = solvePolynomial(A, 'z^2 + 2z + 5');
  assert.equal(z.variable, 'z');
  assert.deepEqual(z.roots.map((w) => [w.re, w.im]), [[-1, 2], [-1, -2]]);
  const rep = solvePolynomial(A, '(x - 2)^2 (x + 1)');
  assert.deepEqual(rep.roots.map((w) => [Math.round(w.re * 1e12) / 1e12, w.multiplicity]), [[-1, 1], [2, 2]]);
  const withDefs = solvePolynomial(A, 'f(x) - k');
  assert.deepEqual(withDefs.coefficients, [-2, 0, 1]);
  assert.match(solvePolynomial(A, 'sin(x)').error.message, /isn't a polynomial/);
  assert.match(solvePolynomial(A, 'x y').error.message, /one unknown/);
  assert.match(solvePolynomial(A, 'x - x + 3').error.message, /no solution/);
  assert.match(solvePolynomial(A, 'x - x').error.message, /true for every x/);
});

test('solveSystem: unique, none, infinite and non-linear', () => {
  const r = solveSystem(A, ['2x + 3y = 5', 'x - y = 1']);
  assert.equal(r.status, 'unique');
  assert.ok(close(r.values[0], 1.6) && close(r.values[1], 0.6));
  assert.deepEqual(r.graph, ['y = (5 - 2x)/3', 'y = x - 1', '(1.6, 0.6)']);
  const three = solveSystem(A, ['a + b + c = 6', 'a - b = 0', 'a + c = 5', '']);
  assert.equal(three.status, 'unique');
  three.values.forEach((v, i) => assert.ok(close(v, [1, 1, 4][i], 1e-14)));
  assert.equal(solveSystem(A, ['x + y = 1', 'x + y = 3']).status, 'none');
  const inf = solveSystem(A, ['x + y = 1', '2x + 2y = 2']);
  assert.equal(inf.status, 'infinite');
  assert.deepEqual(inf.free, ['y']);
  assert.deepEqual(inf.relations[0], { unknown: 'x', constant: 1, terms: [{ unknown: 'y', coef: -1 }] });
  // Non-linear: solved numerically (D44). x + y = 3, xy = 1 -> x = (3 ± √5)/2.
  const nl = solveSystem(A, ['x + y = 3', 'x y = 1']);
  assert.equal(nl.status, 'nonlinear');
  assert.equal(nl.solutions.length, 2);
  assert.ok(close(nl.solutions[0].values[0], (3 - Math.sqrt(5)) / 2));
  assert.ok(close(nl.solutions[1].values[0], (3 + Math.sqrt(5)) / 2));
  // Graph definitions are constants here
  const kk = solveSystem(A, ['k x = 4']);
  assert.ok(close(kk.values[0], 2));
});

test('polynomialText and solve state persistence', () => {
  assert.equal(polynomialText([-6, 11, -6, 1], 'x', String), 'x³ − 6x² + 11x − 6');
  assert.equal(polynomialText([0, -1, 0.5], 't', String), '0.5t² − t');
  const s = defaultState();
  s.solve = { ...s.solve, mode: 'system', system: ['x + y = 1', 'x - y = 0'], given: { a: '2' } };
  s.rows[0] = { ...s.rows[0], showAnalysis: true, atX: '1', intFrom: '0', intTo: 'π', sliderMin: '-5' };
  const back = deserialize(serialize(s));
  assert.equal(back.solve.mode, 'system');
  assert.deepEqual(back.solve.system, ['x + y = 1', 'x - y = 0']);
  assert.deepEqual(back.solve.given, { a: '2' });
  assert.equal(back.rows[0].showAnalysis, true);
  assert.equal(back.rows[0].intTo, 'π');
  assert.equal(back.rows[0].sliderMin, '-5');
  // old saves without the new fields still load
  const old = JSON.parse(serialize(defaultState()));
  delete old.solve;
  const fromOld = deserialize(JSON.stringify(old));
  assert.equal(fromOld.solve.mode, 'equation');
});
