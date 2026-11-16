import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tQuantile, tCdf, normalQuantile, chi2Sf, betaInc, gammaP, lnGamma } from '../src/js/numerics/stats.js';
import { leastSquares } from '../src/js/numerics/qr.js';
import { NORRIS, LONGLEY, WAMPLER } from './nist/linear.mjs';

// Relative agreement, or absolute for values that are (certified as) zero.
const near = (a, b, rel, abs = 0) => Math.abs(a - b) <= Math.max(rel * Math.abs(b), abs);

test('stats: distributions', () => {
  assert.ok(near(lnGamma(10), Math.log(362880), 1e-14));
  assert.ok(near(lnGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-14));
  assert.ok(near(betaInc(2, 3, 0.4), 0.5248, 1e-12));
  assert.ok(near(gammaP(1, 2), 1 - Math.exp(-2), 1e-14));
  assert.ok(near(tCdf(2.228138851986274, 10), 0.975, 1e-13));
  assert.ok(near(tQuantile(0.975, 10), 2.228138851986274, 1e-12));
  assert.ok(near(tQuantile(0.975, 1), 12.706204736174698, 1e-12));
  assert.ok(near(tQuantile(0.975, 2), 4.302652729749464, 1e-12));
  assert.ok(near(tQuantile(0.975, 1000), 1.9623390808264083, 1e-12)); // reference values from scipy
  assert.ok(near(tQuantile(0.025, 5), -2.570581835636314, 1e-12));
  assert.ok(near(normalQuantile(0.975), 1.959963984540054, 1e-14));
  assert.ok(near(normalQuantile(1e-10), -6.361340902404056, 1e-12));
  assert.ok(near(chi2Sf(3.841458820694124, 1), 0.05, 1e-12));
  assert.ok(near(chi2Sf(18.307038053275146, 10), 0.05, 1e-12));
});

// Fit y = Σ b_j x_j by QR and compare with NIST certified values.
function check(name, columns, y, cert, tol) {
  const r = leastSquares(columns, y);
  const n = y.length;
  const p = columns.length;
  assert.equal(r.rank, p, `${name}: rank`);
  const s2 = r.rss / (n - p);
  const mean = y.reduce((a, v) => a + v, 0) / n;
  const sst = y.reduce((a, v) => a + (v - mean) ** 2, 0);
  r.x.forEach((v, j) => assert.ok(near(v, cert.params[j], tol.params, tol.abs), `${name}: b${j} = ${v}, certified ${cert.params[j]}`));
  r.x.forEach((_, j) => {
    const se = Math.sqrt(s2 * r.cov[j][j]);
    assert.ok(near(se, cert.se[j], tol.se, tol.abs), `${name}: se b${j} = ${se}, certified ${cert.se[j]}`);
  });
  assert.ok(near(Math.sqrt(s2), cert.sd, tol.se, tol.abs), `${name}: residual sd ${Math.sqrt(s2)}`);
  assert.ok(near(1 - r.rss / sst, cert.r2, 1e-12), `${name}: R² ${1 - r.rss / sst}`);
}

test('QR least squares: NIST Norris, Longley, Wampler 1–4', () => {
  const ones = (n) => new Array(n).fill(1);
  check('Norris', [ones(36), NORRIS.data.map((r) => r[1])], NORRIS.data.map((r) => r[0]), NORRIS, { params: 1e-11, se: 1e-11 });
  const L = LONGLEY.data;
  check('Longley', [ones(16), ...[1, 2, 3, 4, 5, 6].map((j) => L.map((r) => r[j]))], L.map((r) => r[0]), LONGLEY, { params: 1e-9, se: 1e-9 });
  WAMPLER.forEach((w, k) => {
    const cols = [0, 1, 2, 3, 4, 5].map((d) => w.x.map((x) => x ** d));
    check(`Wampler${k + 1}`, cols, w.y, w, { params: 1e-8, se: 1e-8, abs: 1e-6 });
  });
});

test('QR least squares: rank deficiency is reported', () => {
  const r = leastSquares([[1, 1, 1], [2, 2, 2], [1, 2, 3]], [1, 2, 3]);
  assert.equal(r.rank, 2);
  assert.equal(r.x, null);
  assert.equal(r.dependent.length, 1);
});

import { analyse } from '../src/js/expr/model.js';
import { runFit } from '../src/js/fit/run.js';
import { buildModel, modelSource, equationText, customText, paramLabel } from '../src/js/fit/models.js';
import { newDataSet } from '../src/js/data/table.js';
import { newFit } from '../src/js/state/defaults.js';

const A0 = analyse([]);
const setOf = (xs, ys, extra = {}) => newDataSet(1, '#000000', 'T', xs.map((x, i) => ({ x, y: ys[i], s: extra.s ? extra.s[i] : null, off: false })), extra);

test('models: presets, custom parameters and linearity', () => {
  assert.equal(buildModel(A0, newFit(1, '#000', 'line')).linear, true);
  assert.equal(buildModel(A0, newFit(1, '#000', 'log')).linear, true);
  assert.equal(buildModel(A0, newFit(1, '#000', 'exp')).linear, false);
  assert.equal(buildModel(A0, newFit(1, '#000', 'sin')).linear, false);
  const poly = buildModel(A0, newFit(1, '#000', 'poly', { degree: 3 }));
  assert.deepEqual(poly.params, ['a_0', 'a_1', 'a_2', 'a_3']);
  assert.equal(poly.formula, 'y = a₀ + a₁x + a₂x² + a₃x³');
  assert.equal(paramLabel('a_12'), 'a₁₂');

  const custom = (t, an = A0) => buildModel(an, newFit(1, '#000', 'custom', { custom: t }));
  assert.deepEqual(custom('y = a + b sin(x) + c cos(x)').params, ['a', 'b', 'c']);
  assert.equal(custom('a + b sin(x) + c cos(x)').linear, true);
  assert.equal(custom('a e^(-b x) cos(c x)').linear, false);
  assert.equal(custom('a x^2 + b x').linear, true);
  // Graph-tab definitions are constants, not parameters (D27)
  const g = analyse([{ text: 'g = 9.81' }, { text: 'h(x) = x^2' }]);
  assert.deepEqual(custom('a g x + b h(x)', g).params, ['a', 'b']);
  assert.equal(custom('a g x + b h(x)', g).linear, true);
  // errors
  assert.match(custom('2x + 1').error.message, /at least one parameter/);
  assert.match(custom('a t').error.message, /Use x/);
  assert.match(custom('a + ').error.message, /./);
  assert.equal(custom('  ').empty, true);
  assert.equal(customText('f(x) = a x'), 'a x');
  assert.equal(customText('y ~ a x'), 'a x');
  assert.equal(modelSource(newFit(1, '#000', 'custom', { custom: 'y = a x' }), A0).formula, 'y = a x');
});

test('equationText prints fitted values cleanly', () => {
  const eq = (model, vals, extra = {}) => {
    const m = buildModel(A0, newFit(1, '#000', model, extra));
    const text = equationText(m, vals);
    // The printed row means the same thing when typed into the Graph tab.
    const row = analyse([{ text }]).rows[0];
    for (const x of [0.3, 1.7, 2.2]) {
      const want = m.f([x, ...vals]);
      assert.ok(Math.abs(row.f(x) - want) <= 1e-12 * Math.max(1, Math.abs(want)), `${text} at ${x}`);
    }
    return text;
  };
  assert.equal(eq('line', [-0.26, 1.002]), 'y = -0.26 + 1.002x');
  assert.equal(eq('exp', [2.5, -0.31]), 'y = 2.5e^(-0.31x)');
  assert.equal(eq('power', [1.2, 0.5]), 'y = 1.2x^0.5');
  assert.equal(eq('logistic', [2, -0.5, 3]), 'y = 3/(1 + 2e^(0.5x))');
  assert.equal(eq('sin', [-1, 2, -0.3, 0]), 'y = -sin(2x - 0.3)');
  assert.equal(eq('gauss', [1, -2, 0.5]), 'y = e^(-(x + 2)^2/(2·0.5^2))');
  assert.equal(eq('poly', [1, -2, 1e-7], { degree: 2 }), 'y = 1 - 2x + 1e-7x^2');
});

test('runFit: Norris through the line model; Wampler through the polynomial model', () => {
  const r = runFit(A0, setOf(NORRIS.data.map((d) => d[1]), NORRIS.data.map((d) => d[0])), newFit(1, '#000', 'line'));
  assert.ok(near(r.values[0], NORRIS.params[0], 1e-11) && near(r.values[1], NORRIS.params[1], 1e-12));
  assert.ok(near(r.se[0], NORRIS.se[0], 1e-11) && near(r.se[1], NORRIS.se[1], 1e-11));
  assert.ok(near(r.s, NORRIS.sd, 1e-12) && near(r.r2, NORRIS.r2, 1e-13));
  assert.equal(r.n, 36);
  assert.equal(r.dof, 34);
  assert.ok(near(r.q, 2.032244509317718, 1e-12)); // t(0.975, 34)
  assert.ok(near(r.ci[1][0], NORRIS.params[1] - r.q * NORRIS.se[1], 1e-12));
  assert.ok(near(r.f(500), NORRIS.params[0] + 500 * NORRIS.params[1], 1e-13));
  // Variance of the mean at x̄ is s²/n for a straight line.
  const xbar = NORRIS.data.reduce((a, d) => a + d[1], 0) / 36;
  assert.ok(near(r.meanVar(xbar), NORRIS.sd ** 2 / 36, 1e-10));
  assert.equal(r.method, 'Linear least squares (QR)');

  for (const k of [2, 3]) {
    const w = WAMPLER[k];
    const f = runFit(A0, setOf(w.x, w.y), newFit(1, '#000', 'poly', { degree: 5 }));
    f.values.forEach((v, j) => assert.ok(near(v, w.params[j], 1e-8), `Wampler${k + 1} a${j}: ${v}`));
    f.se.forEach((v, j) => assert.ok(near(v, w.se[j], 1e-8), `Wampler${k + 1} se${j}: ${v}`));
    assert.ok(near(f.r2, w.r2, 1e-12));
  }
});

test('runFit: polynomials of years stay accurate (centring)', () => {
  const xs = [2018, 2019, 2020, 2021, 2022, 2023, 2024];
  const truth = (x) => 3 + 0.5 * (x - 2020) - 0.25 * (x - 2020) ** 2 + 0.01 * (x - 2020) ** 3;
  const r = runFit(A0, setOf(xs, xs.map(truth)), newFit(1, '#000', 'poly', { degree: 3 }));
  for (const x of [2017.5, 2020, 2026]) assert.ok(Math.abs(r.f(x) - truth(x)) < 1e-9, `f(${x})`);
  assert.ok(r.rss < 1e-18);
});

test('runFit: custom linear model, weighting, undefined points, errors', () => {
  const xs = [0, 1, 2, 3, 4, 5, 6, 7];
  const ys = xs.map((x) => 2 + 3 * Math.sin(x) - Math.cos(x));
  const r = runFit(A0, setOf(xs, ys), newFit(1, '#000', 'custom', { custom: 'a + b sin(x) + c cos(x)' }));
  [2, 3, -1].forEach((v, k) => assert.ok(Math.abs(r.values[k] - v) < 1e-12));

  // ln x is undefined at x ≤ 0: those points are left out, with a note
  const lg = runFit(A0, setOf([-1, 0, 1, 2, 4], [5, 5, 1, 1 + Math.log(2), 1 + 2 * Math.log(2)]), newFit(1, '#000', 'log'));
  assert.equal(lg.n, 3);
  assert.match(lg.notes[0], /2 points left out: the model isn't defined/);
  assert.ok(Math.abs(lg.values[1] - 1) < 1e-12);

  // Weighted line: χ² and absolute σ (D6)
  const s = [0.1, 0.2, 0.1, 0.3, 0.1];
  const wset = setOf([1, 2, 3, 4, 5], [1.1, 1.9, 3.05, 4.2, 4.95], { s, hasSigma: true });
  const wf = runFit(A0, wset, newFit(1, '#000', 'line'));
  assert.equal(wf.weighted, true);
  // Reference: weighted least squares by hand (normal equations, well conditioned here)
  const w = s.map((v) => 1 / v ** 2);
  const X = [1, 2, 3, 4, 5];
  const Y = [1.1, 1.9, 3.05, 4.2, 4.95];
  const S = w.reduce((a, v) => a + v, 0);
  const Sx = w.reduce((a, v, i) => a + v * X[i], 0);
  const Sy = w.reduce((a, v, i) => a + v * Y[i], 0);
  const Sxx = w.reduce((a, v, i) => a + v * X[i] ** 2, 0);
  const Sxy = w.reduce((a, v, i) => a + v * X[i] * Y[i], 0);
  const D = S * Sxx - Sx * Sx;
  const b = (S * Sxy - Sx * Sy) / D;
  const a = (Sxx * Sy - Sx * Sxy) / D;
  assert.ok(near(wf.values[0], a, 1e-12) && near(wf.values[1], b, 1e-12));
  assert.ok(near(wf.se[0], Math.sqrt(Sxx / D), 1e-12) && near(wf.se[1], Math.sqrt(S / D), 1e-12));
  const chi2 = Y.reduce((acc, yv, i) => acc + ((yv - a - b * X[i]) / s[i]) ** 2, 0);
  assert.ok(near(wf.chi2, chi2, 1e-10) && near(wf.chi2red, chi2 / 3, 1e-10));
  assert.ok(wf.pValue > 0 && wf.pValue < 1);
  assert.ok(near(wf.q, 1.959963984540054, 1e-14));
  // Unweighted fit of the same set when weighting is off
  assert.equal(runFit(A0, wset, newFit(1, '#000', 'line', { weighted: false })).weighted, false);

  assert.match(runFit(A0, setOf([1], [2]), newFit(1, '#000', 'line')).error.message, /at least 2 points/);
  assert.match(runFit(A0, setOf([1, 1, 1], [2, 3, 4]), newFit(1, '#000', 'line')).error.message, /2 different x values/);
  assert.match(runFit(A0, setOf([1, 2, 3], [1, 2, 3]), newFit(1, '#000', 'custom', { custom: 'a x + 2b x' })).error.message, /can't tell/);
  const exact = runFit(A0, setOf([1, 2], [1, 3]), newFit(1, '#000', 'line'));
  assert.match(exact.notes[0], /no error estimates/);
  assert.equal(runFit(A0, setOf([], []), newFit(1, '#000', 'line')).error.message, 'No points to fit yet: each point needs an x and a y value');
});
