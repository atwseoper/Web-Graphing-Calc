import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newtonFrom, solveNonlinear, startPoints } from '../src/js/numerics/nlsolve.js';
import { solveSystem } from '../src/js/expr/solve.js';
import { analyse } from '../src/js/expr/model.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

test('damped Newton converges from a poor start', () => {
  const F = ([x, y]) => [x * x + y * y - 4, x - y];
  const r = newtonFrom(F, [10, -3]);
  assert.ok(r);
  assert.ok(close(Math.abs(r.x[0]), Math.SQRT2) && close(r.x[0], r.x[1]));
  assert.ok(r.residual < 1e-12);
});

test('no solution: every start fails', () => {
  const r = solveNonlinear(([x, y]) => [x * x + y * y - 1, x + y - 3], 2, { count: 60 });
  assert.equal(r.solutions.length, 0);
});

test('finds every solution and merges duplicates', () => {
  // x y z = 6, x + y + z = 6, x² + y² + z² = 14: the six orderings of (1, 2, 3).
  const F = ([x, y, z]) => [x * y * z - 6, x + y + z - 6, x * x + y * y + z * z - 14];
  const r = solveNonlinear(F, 3);
  assert.equal(r.solutions.length, 6);
  for (const s of r.solutions) assert.deepEqual([...s.x].sort(), [1, 2, 3]);
});

test('start points cover the box', () => {
  const pts = startPoints(2, [-10, 10], 100);
  assert.ok(pts.length >= 100);
  for (const p of pts) for (const v of p) assert.ok(v >= -10 && v <= 10);
  const many = startPoints(5, [0, 1], 50);
  assert.equal(many.length, 51);
});

test('Solve tab: a non-linear system in two unknowns', () => {
  const r = solveSystem(analyse([]), ['x^2 + y^2 = 4', 'y = x^2 - 1']);
  assert.equal(r.status, 'nonlinear');
  assert.equal(r.solutions.length, 2);
  const yv = (Math.sqrt(13) - 1) / 2; // y² + y − 3 = 0
  for (const s of r.solutions) {
    assert.ok(close(s.values[1], yv));
    assert.ok(close(Math.abs(s.values[0]), Math.sqrt(yv + 1)));
  }
  assert.deepEqual(r.graph.slice(0, 2), ['x^2 + y^2 = 4', 'y = x^2 - 1']);
  assert.equal(r.graph.length, 4, 'two curves and two points');
});

test('Solve tab: other letters, large terms and Graph-tab definitions', () => {
  const r = solveSystem(analyse([{ text: 'k = 5000' }]), ['e^a = k b', 'a + b = 10']);
  assert.equal(r.status, 'nonlinear');
  assert.equal(r.solutions.length, 1);
  const [a, b] = r.solutions[0].values;
  assert.ok(close(Math.exp(a), 5000 * b, 1e-9));
  assert.ok(close(a + b, 10));
  assert.deepEqual(r.renamed, { a: 'x', b: 'y' });
  assert.equal(r.graph[0], 'e^x = k·y');
});

test('Solve tab: non-linear systems need as many equations as unknowns', () => {
  const r = solveSystem(analyse([]), ['x^2 + y = 1']);
  assert.match(r.error.message, /as many equations as unknowns/);
  // Linear systems still allow any shape.
  assert.equal(solveSystem(analyse([]), ['x + y = 1']).status, 'infinite');
  // A system that is linear stays exact.
  assert.equal(solveSystem(analyse([]), ['2x + 3y = 5', 'x - y = 1']).status, 'unique');
});

test('Solve tab: widens the search when nothing is near the origin', () => {
  const r = solveSystem(analyse([]), ['x y = 40000', 'x - y = 0']);
  assert.equal(r.solutions.length, 2);
  for (const s of r.solutions) assert.ok(close(Math.abs(s.values[0]), 200));
});
