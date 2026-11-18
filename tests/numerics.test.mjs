import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brent, findRoots } from '../src/js/numerics/roots.js';
import { brentMin } from '../src/js/numerics/minimise.js';
import { findExtrema, pointsOfInterest } from '../src/js/numerics/analysis.js';
import { integrate } from '../src/js/numerics/integrate.js';
import { polyRoots } from '../src/js/numerics/poly.js';
import { solveLinearSystem } from '../src/js/numerics/linalg.js';
import { toPolynomial } from '../src/js/expr/polynomial.js';
import { parseExpression } from '../src/js/expr/parser.js';

const close = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const xs = (roots) => roots.map((r) => r.x);

test('brent: converges to full precision and refuses bad brackets', () => {
  const r = brent((x) => x * x - 2, 0, 2);
  assert.ok(close(r.x, Math.SQRT2, 1e-15));
  assert.ok(r.iterations < 20);
  assert.equal(brent((x) => x * x + 1, -1, 1), null);
  const cos = brent(Math.cos, 0, 3);
  assert.ok(close(cos.x, Math.PI / 2, 1e-15));
  // the classic hard case: very flat near the root
  const flat = brent((x) => (x - 1) ** 3, 0, 3);
  assert.ok(Math.abs(flat.x - 1) < 1e-5);
});

test('findRoots: sign changes, touching roots, close pairs', () => {
  assert.deepEqual(xs(findRoots((x) => x * x - 4, -10, 10)).map((x) => Math.round(x * 1e9) / 1e9), [-2, 2]);
  const sin = findRoots(Math.sin, -10, 10);
  assert.equal(sin.length, 7);
  sin.forEach((r, i) => assert.ok(close(r.x, (i - 3) * Math.PI, 1e-14)));
  // touching root (x - 1)² and a double root of x³ - 3x + 2 at 1
  const t = findRoots((x) => (x - 1) ** 2, -5.13, 5);
  assert.equal(t.length, 1);
  assert.ok(Math.abs(t[0].x - 1) < 1e-7 && t[0].tangential);
  const cubic = findRoots((x) => x ** 3 - 3 * x + 2, -5.13, 5);
  assert.equal(cubic.length, 2);
  assert.ok(close(cubic[0].x, -2, 1e-12) && Math.abs(cubic[1].x - 1) < 1e-7);
  // two roots closer than the sample spacing
  const pair = findRoots((x) => (x - 1) * (x - 1.001), -10.07, 10, { samples: 100 });
  assert.equal(pair.length, 2);
  assert.ok(close(pair[0].x, 1, 1e-12) && close(pair[1].x, 1.001, 1e-12));
});

test('findRoots: poles and jumps are not roots', () => {
  assert.equal(findRoots((x) => 1 / x, -5, 5).length, 0);
  assert.equal(findRoots((x) => Math.floor(x) - 0.5, -3, 3).length, 0);
  const tan = findRoots(Math.tan, -5, 5);
  assert.deepEqual(tan.map((r) => Math.round(r.x / Math.PI)), [-1, 0, 1]);
  // undefined regions are skipped: sqrt(x) - 1
  const sq = findRoots((x) => Math.sqrt(x) - 1, -5, 5);
  assert.equal(sq.length, 1);
  assert.ok(close(sq[0].x, 1, 1e-14));
});

test('findRoots: Newton polishing with a derivative', () => {
  const f = (x) => x ** 3 - 2 * x - 5;
  const r = findRoots(f, -10, 10, { df: (x) => 3 * x * x - 2 });
  assert.equal(r.length, 1);
  assert.ok(close(r[0].x, 2.0945514815423265, 1e-15));
});

test('brentMin and findExtrema', () => {
  const m = brentMin((x) => (x - 0.3) ** 2 + 1, -2, 2);
  assert.ok(Math.abs(m.x - 0.3) < 1e-7 && close(m.fx, 1));
  const ext = findExtrema((x) => x ** 3 - 3 * x, -3, 3, { df: (x) => 3 * x * x - 3 });
  assert.deepEqual(ext.map((e) => [e.kind, Math.round(e.x * 1e12) / 1e12, Math.round(e.y * 1e12) / 1e12]), [['max', -1, 2], ['min', 1, -2]]);
  // without a derivative the minimiser is used
  const s = findExtrema(Math.sin, 0, 7);
  assert.deepEqual(s.map((e) => e.kind), ['max', 'min']);
  assert.ok(Math.abs(s[0].x - Math.PI / 2) < 1e-7);
  // cusp |x| is a minimum; 1/x² and tan have none
  const cusp = findExtrema(Math.abs, -2, 2.1, { df: Math.sign });
  assert.equal(cusp.length, 1);
  assert.ok(Math.abs(cusp[0].x) < 1e-12 && cusp[0].kind === 'min');
  assert.equal(findExtrema((x) => 1 / x ** 2, -2, 2.1, { df: (x) => -2 / x ** 3 }).length, 0);
  assert.equal(findExtrema((x) => 1 / x, -2, 2.1).length, 0);
  assert.equal(findExtrema(Math.tan, -4, 4).length, 0);
});

test('pointsOfInterest: roots, extrema, intercept and intersections', () => {
  const pois = pointsOfInterest({ f: (x) => x * x - 1, df: (x) => 2 * x }, -3, 3, { others: [{ id: 7, f: (x) => x + 1 }] });
  const kinds = pois.map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['intersection', 'intersection', 'min', 'root', 'root', 'y-intercept']);
  const inter = pois.filter((p) => p.kind === 'intersection').map((p) => [Math.round(p.x * 1e9) / 1e9, Math.round(p.y * 1e9) / 1e9]);
  assert.deepEqual(inter, [[-1, 0], [2, 3]]);
  assert.equal(pois.find((p) => p.kind === 'intersection').with, 7);
});

test('integrate: accurate with error estimates', () => {
  const p = integrate((x) => x ** 5 - 3 * x, 0, 2);
  assert.ok(close(p.value, 64 / 6 - 6, 1e-14) && p.ok);
  const s = integrate(Math.sin, 0, Math.PI);
  assert.ok(close(s.value, 2, 1e-14));
  assert.ok(s.error < 1e-10);
  const g = integrate((x) => Math.exp(-x * x), -10, 10);
  assert.ok(close(g.value, Math.sqrt(Math.PI), 1e-12));
  // integrable endpoint singularity
  const sing = integrate((x) => 1 / Math.sqrt(x), 0, 1);
  assert.ok(Math.abs(sing.value - 2) < 1e-6, String(sing.value));
  // oscillatory
  const osc = integrate((x) => Math.cos(50 * x), 0, 1);
  assert.ok(close(osc.value, Math.sin(50) / 50, 1e-12));
  // reversed limits, and undefined inside the range
  assert.ok(close(integrate((x) => x, 1, 0).value, -0.5));
  const bad = integrate((x) => Math.sqrt(x), -1, 1);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /undefined or infinite for some x between −1 and 0/);
  const pole = integrate((x) => 1 / x, -1, 1);
  assert.equal(pole.ok, false);
  assert.match(pole.message, /infinite near x = 0/);
  const divergent = integrate((x) => 1 / x, 0, 1);
  assert.equal(divergent.ok, false);
  assert.match(divergent.message, /converge/);
  const hit = integrate((x) => 1 / (x - 0.5), 0, 1);
  assert.equal(hit.ok, false);
  assert.match(hit.message, /near x = 0.5/);
});

test('polyRoots: real, complex and repeated roots', () => {
  const r9 = (v) => Math.round(v * 1e9) / 1e9 + 0; // + 0 turns −0 into 0
  const sorted = (r) => r.roots.map((z) => [r9(z.re), r9(z.im), z.multiplicity]);
  // (x-1)(x-2)(x-3) = x³ - 6x² + 11x - 6
  assert.deepEqual(sorted(polyRoots([-6, 11, -6, 1])), [[1, 0, 1], [2, 0, 1], [3, 0, 1]]);
  assert.deepEqual(sorted(polyRoots([1, 0, 1])), [[0, 1, 1], [0, -1, 1]]);
  // (x − 2)²(x² + 1): exact zeros for the real parts of ±i, not rounding noise
  const pure = polyRoots([4, -4, 5, -4, 1]).roots.filter((z) => z.im !== 0);
  assert.deepEqual(pure.map((z) => [z.re, z.im]), [[0, 1], [0, -1]]);
  assert.deepEqual(sorted(polyRoots([-1, 3, -3, 1])), [[1, 0, 3]]);
  assert.deepEqual(sorted(polyRoots([0, 0, 2, 1])), [[-2, 0, 1], [0, 0, 2]]);
  // x⁵ − 1: one real root and two conjugate pairs on the unit circle
  const five = polyRoots([-1, 0, 0, 0, 0, 1]);
  assert.equal(five.roots.length, 5);
  assert.equal(five.roots.filter((z) => z.im === 0).length, 1);
  for (const z of five.roots) assert.ok(close(Math.hypot(z.re, z.im), 1, 1e-13));
  // Wilkinson-style: roots 1..10
  let c = [1];
  for (let k = 1; k <= 10; k++) {
    const next = new Array(c.length + 1).fill(0);
    c.forEach((v, i) => { next[i + 1] += v; next[i] -= k * v; });
    c = next;
  }
  const w = polyRoots(c);
  assert.equal(w.roots.length, 10);
  w.roots.forEach((z, i) => assert.ok(Math.abs(z.re - (i + 1)) < 1e-8 && z.im === 0, JSON.stringify(z)));
  // quadratic without cancellation: x² − 1e8 x + 1
  const q = polyRoots([1, -1e8, 1]);
  assert.ok(close(q.roots[0].re, 1e-8, 1e-12));
});

test('solveLinearSystem: unique, none and infinitely many', () => {
  const u = solveLinearSystem([[2, 3], [1, -1]], [5, 1]);
  assert.equal(u.status, 'unique');
  assert.ok(close(u.x[0], 1.6) && close(u.x[1], 0.6));
  assert.equal(solveLinearSystem([[1, 1], [2, 2]], [1, 3]).status, 'none');
  const inf = solveLinearSystem([[1, 1], [2, 2]], [1, 2]);
  assert.equal(inf.status, 'infinite');
  assert.deepEqual(inf.free, [1]);
  // 3×3 needing pivoting (zero in the top-left)
  const p = solveLinearSystem([[0, 2, 1], [1, 1, 1], [2, 1, 3]], [7, 6, 13]);
  assert.equal(p.status, 'unique');
  p.x.forEach((v, i) => assert.ok(close(v, [1, 2, 3][i], 1e-14)));
  // Hilbert 4×4 with x = (1,1,1,1)
  const H = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => 1 / (i + j + 1)));
  const h = solveLinearSystem(H, H.map((r) => r.reduce((s, v) => s + v, 0)));
  h.x.forEach((v) => assert.ok(Math.abs(v - 1) < 1e-10));
});

test('toPolynomial: expansion and refusal', () => {
  const env = { value: (n) => (n.type === 'num' ? n.value : NaN), func: () => undefined };
  const P = (s) => toPolynomial(parseExpression(s), 'x', env);
  assert.deepEqual(P('(x - 1)(x + 1)'), [-1, 0, 1]);
  assert.deepEqual(P('(x + 1)^3'), [1, 3, 3, 1]);
  assert.deepEqual(P('x^2/2 - 3'), [-3, 0, 0.5]);
  assert.equal(P('sin(x)'), null);
  assert.equal(P('1/x'), null);
  assert.equal(P('x^0.5'), null);
  const withFn = toPolynomial(parseExpression("f'(x) + f(2x)"), 'x', {
    ...env, func: (n) => (n === 'f' ? { params: ['t'], body: parseExpression('t^2 + t') } : undefined),
  });
  assert.deepEqual(withFn, [1, 4, 4]); // (2x + 1) + (4x² + 2x)
});

import { sinExact, cosExact, tanExact } from '../src/js/numerics/special.js';

test('exact trig zeros never swallow real values at large x', () => {
  assert.equal(sinExact(Math.PI), 0);
  assert.equal(sinExact(1e6 * Math.PI), 0);
  assert.equal(cosExact(Math.PI / 2), 0);
  assert.equal(sinExact(1e-20), 1e-20);
  for (const x of [1e15 + 0.5, 2e14 + 1, 7e16]) {
    assert.equal(sinExact(x), Math.sin(x));
    assert.equal(cosExact(x), Math.cos(x));
    assert.equal(tanExact(x), Math.tan(x));
  }
});
