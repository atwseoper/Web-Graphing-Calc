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
  assert.match(lg.notes[0], /2 points left out: the model/);
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

import { NONLINEAR } from './nist/nonlinear.mjs';
import { guessStart } from '../src/js/fit/nonlinear.js';

// Log relative error: the number of correct significant digits (NIST's measure).
const lre = (v, c) => (v === c ? 15 : c === 0 ? -Math.log10(Math.abs(v)) : -Math.log10(Math.abs(v - c) / Math.abs(c)));

test('Levenberg–Marquardt: NIST StRD non-linear problems from both starting points', () => {
  const report = [];
  for (const prob of NONLINEAR) {
    for (const k of [0, 1]) {
      const params = prob.params.map((_, j) => `b_${j + 1}`);
      const start = Object.fromEntries(params.map((name, j) => [name, String(prob.starts[k][j])]));
      const set = setOf(prob.x, prob.y);
      const r = runFit(A0, set, newFit(1, '#000', 'custom', { custom: prob.model, start }), { budget: 5000 });
      assert.ok(!r.error, `${prob.name} start ${k + 1}: ${r.error && r.error.message}`);
      // Parameters are ordered as they first appear in the model; match by name.
      let order = prob.params.map((_, j) => r.model.params.indexOf(`b_${j + 1}`));
      if (prob.name.startsWith('Lanczos')) {
        // A sum of exponentials b₁e^(−b₂x) + b₃e^(−b₄x) + …: the same minimum with the
        // terms in another order is equally right, so compare the terms sorted by rate.
        const terms = (vals) => [0, 2, 4].map((t) => [t, vals[t + 1]]).sort((u, v) => u[1] - v[1]).map(([t]) => t);
        const mine = terms(order.map((k) => r.values[k]));
        const cert = terms(prob.params);
        const mapped = [...order];
        cert.forEach((t, i) => { mapped[t] = order[mine[i]]; mapped[t + 1] = order[mine[i] + 1]; });
        order = mapped;
      }
      const val = (j) => r.values[order[j]];
      const se = (j) => r.se[order[j]];
      const pLre = Math.min(...prob.params.map((c, j) => lre(val(j), c)));
      const sLre = Math.min(...prob.se.map((c, j) => lre(se(j), c)));
      const rLre = lre(r.rss, prob.rss);
      report.push(`${prob.name} s${k + 1}: params ${pLre.toFixed(1)}, se ${sLre.toFixed(1)}, rss ${rLre.toFixed(1)}`);
      assert.ok(rLre >= 6, `${prob.name} start ${k + 1}: RSS ${r.rss} vs ${prob.rss}`);
      assert.ok(pLre >= 4, `${prob.name} start ${k + 1}: parameters only ${pLre.toFixed(1)} digits`);
      assert.ok(sLre >= 3, `${prob.name} start ${k + 1}: standard errors only ${sLre.toFixed(1)} digits`);
    }
  }
  if (process.env.NIST_REPORT) console.log(report.join('\n'));
});

import { PRESET_CASES } from './nist/presets.mjs';

test('built-in non-linear models find the fit from their own starting guesses', () => {
  const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-300);
  const models = { exp: 'exp', power: 'power', logistic: 'logistic', sin: 'sin', gauss: 'gauss', decay: 'exp' };
  for (const [name, model] of Object.entries(models)) {
    const c = PRESET_CASES[name];
    const r = runFit(A0, setOf(c.x, c.y), newFit(1, '#000', model));
    assert.ok(!r.error, `${name}: ${r.error && r.error.message}`);
    let vals = r.values;
    if (model === 'sin' && vals[0] < 0) vals = [-vals[0], vals[1], vals[2] + Math.PI, vals[3]];
    if (model === 'sin') vals = [vals[0], vals[1], ((vals[2] % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), vals[3]];
    if (model === 'gauss') vals = [vals[0], vals[1], Math.abs(vals[2])];
    vals.forEach((v, k) => assert.ok(close(v, c.params[k], 1e-6), `${name} ${r.model.params[k]}: ${v} vs ${c.params[k]}`));
    r.se.forEach((v, k) => assert.ok(close(v, c.se[k], 1e-4), `${name} se ${r.model.params[k]}: ${v} vs ${c.se[k]}`));
    assert.ok(close(r.rss, c.rss, 1e-9), `${name} rss`);
    assert.match(r.method, /Levenberg–Marquardt/);
  }

  // Weighted, with absolute σ (scipy absolute_sigma=True)
  const w = PRESET_CASES.exp_weighted;
  const wr = runFit(A0, setOf(w.x, w.y, { s: w.s, hasSigma: true }), newFit(1, '#000', 'exp'));
  wr.values.forEach((v, k) => assert.ok(close(v, w.params[k], 1e-6)));
  wr.se.forEach((v, k) => assert.ok(close(v, w.se[k], 1e-4)));
  assert.ok(close(wr.chi2, w.chi2, 1e-9));

  // Sinusoidal in degrees: the same curve, with b and c in degrees
  const s = PRESET_CASES.sin;
  const deg = runFit(analyse([], { angle: 'deg' }), setOf(s.x, s.y), newFit(1, '#000', 'sin'));
  assert.ok(close(Math.abs(deg.values[1]), s.params[1] * 180 / Math.PI, 1e-6));
  assert.ok(close(deg.rss, s.rss, 1e-9));

  // The guesses themselves
  assert.deepEqual(guessStart('custom', [1], [1]), null);
  const g = guessStart('gauss', [0, 1, 2, 3, 4], [0, 1, 4, 1, 0]);
  assert.equal(g[0], 4);
  assert.equal(g[1], 2);
});

test('runFit: power model leaves out x ≤ 0; bands come from meanVar', () => {
  const xs = [-1, 0, 1, 2, 3, 4];
  const ys = [-2, 0, 1.99, 5.65, 10.4, 16.01];
  const r = runFit(A0, setOf(xs, ys), newFit(1, '#000', 'power'));
  assert.equal(r.n, 4);
  assert.match(r.notes.join(' '), /2 points left out/);
  assert.ok(r.meanVar(2.5) > 0 && Number.isFinite(r.meanVar(2.5)));
});

import { createFitCache } from '../src/js/fit/cache.js';

test('fit cache: custom fits re-run only when a definition they use changes', () => {
  let runs = 0;
  const cache = createFitCache((...args) => { runs++; return runFit(...args); });
  const points = Array.from({ length: 30 }, (_, i) => ({ x: i / 3, y: 3 * Math.exp(-0.4 * i / 3) + 1, s: null, off: false }));
  const fit = newFit(2, '#000000', 'custom', { custom: 'y = a e^(-b x) + c + k' });
  const line = newFit(3, '#000000', 'line');
  const set = newDataSet(1, '#000000', 'D', points, { fits: [fit, line] });
  const state = { data: { sets: [set] } };
  const rows = (k, other) => [{ text: `k = ${k}` }, { text: other }, { text: 'm = 1' }];

  cache.all(state, analyse(rows(0, 'y')));
  assert.equal(runs, 2);
  // Typing in an unrelated row (a new analysis each time) doesn't refit.
  for (const t of ['y =', 'y = s', 'y = sin(x)']) cache.all(state, analyse(rows(0, t)));
  assert.equal(runs, 2);
  // Nor does an unused variable.
  cache.all(state, analyse([...rows(0, 'y'), { text: 'n = 2' }]));
  assert.equal(runs, 2);
  // A definition the custom model uses refits it (but not the line).
  const r = cache.result(set, fit, analyse(rows(0.5, 'y')));
  assert.equal(runs, 3);
  assert.ok(Math.abs(r.values[2] - 0.5) < 1e-6); // c absorbs k
  // The angle unit refits both.
  cache.all(state, analyse(rows(0.5, 'y'), { angle: 'deg' }));
  assert.equal(runs, 5);
});

test('runFit: rounding noise in exact fits is set to zero (no 2e-15x terms)', () => {
  const quad = setOf([1, 2, 3, 4], [1, 4, 9, 16]);
  for (const degree of [2, 3]) {
    const r = runFit(A0, quad, newFit(1, '#000', 'poly', { degree }));
    assert.equal(r.equation, 'y = x^2', `degree ${degree}`);
    assert.deepEqual(r.values.map((v, k) => (k === 2 ? 0 : v)), new Array(degree + 1).fill(0));
    assert.ok(!r.notes.some((n) => n.includes('poorly determined')), r.notes.join(' '));
  }
  const line = runFit(A0, setOf([1, 2, 3, 4], [3, 5, 7, 9]), newFit(1, '#000', 'poly', { degree: 2 }));
  assert.equal(line.equation, 'y = 1 + 2x');

  // Non-linear and custom linear models too.
  const xs = Array.from({ length: 12 }, (_, i) => i * 0.5);
  const sin = runFit(A0, setOf(xs, xs.map((x) => 2 * Math.sin(x))), newFit(1, '#000', 'sin'));
  assert.equal(sin.equation, 'y = 2sin(x)');
  const lin = runFit(A0, setOf(xs, xs.map((x) => 3 + 2 * x)), newFit(1, '#000', 'custom', { custom: 'a + b x + c sin(x)' }));
  assert.equal(lin.equation, 'y = 3 + 2x');
});

test('runFit: real coefficients survive the rounding-noise clean-up', () => {
  // Small but exactly determined.
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const small = runFit(A0, setOf(xs, xs.map((x) => 1 + 1e-9 * x * x)), newFit(1, '#000', 'poly', { degree: 2 }));
  assert.ok(near(small.values[2], 1e-9, 1e-6), `a₂ = ${small.values[2]}`);
  // Heavy cancellation: polynomials of years.
  const years = runFit(A0, setOf([2000, 2001, 2002, 2003], [1, 4, 9, 16]), newFit(1, '#000', 'poly', { degree: 2 }));
  assert.equal(years.equation, 'y = 3996001 - 3998x + x^2');
  // Noisy data: nothing is rounding noise.
  const noisy = runFit(A0, setOf([1, 2, 3, 4, 5], [1.1, 3.9, 9.2, 15.8, 25.1]), newFit(1, '#000', 'poly', { degree: 2 }));
  assert.ok(noisy.values.every((v) => v !== 0));
  // A tiny slope on a big offset is still a slope.
  const offset = runFit(A0, setOf(xs, xs.map((x) => 1e6 + 1e-3 * x)), newFit(1, '#000', 'custom', { custom: 'a + b x' }));
  assert.ok(near(offset.values[1], 1e-3, 1e-6));
});
