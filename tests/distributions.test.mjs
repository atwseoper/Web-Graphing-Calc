// Probability distributions (Phase 7b), checked against published reference values
// (R's pnorm/qnorm/pt/qt/pchisq/dbinom/dpois, NIST/Abramowitz & Stegun tables) and
// against exact closed forms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  erfc, normalPdf, normalCdf, normalInterval, invNorm, tPdf, tCdfAt, tInterval, invT,
  chi2Pdf, chi2Cdf, chi2Interval, binomPdf, binomCdf, binomInterval, poissonPdf, poissonCdf, poissonInterval,
  DISTRIBUTION_FUNCTIONS,
} from '../src/js/numerics/distributions.js';
import { analyse } from '../src/js/expr/model.js';

// Relative error within tol (absolute near zero).
function near(actual, expected, tol = 1e-12, what = '') {
  const err = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-300);
  assert.ok(err <= tol, `${what} ${actual} vs ${expected} (rel. error ${err.toExponential(2)})`);
}

test('normal distribution: reference values', () => {
  near(normalPdf(0), 0.3989422804014327);
  near(normalPdf(1.5, 1, 2), 0.19333405840142465);
  near(normalCdf(1.96), 0.9750021048517795);
  near(normalCdf(-1), 0.15865525393145707);
  near(normalCdf(-10), 7.619853024160527e-24, 1e-10, 'lower tail');
  near(normalCdf(130, 100, 15), 0.9772498680518208);
  near(normalInterval(-1, 1), 0.6826894921370859);
  near(normalInterval(-1.96, 1.96), 0.9500042097035591);
  // Far upper tail, where Φ(b) − Φ(a) would cancel to 0.
  near(normalInterval(8, Infinity), 6.22096057427178e-16, 1e-10, 'upper tail');
  near(normalInterval(1, -1), -0.6826894921370859);
  near(erfc(0.5), 0.4795001221869535);
  near(erfc(-0.5), 1.5204998778130465);
  assert.ok(Number.isNaN(normalPdf(0, 0, 0)) && Number.isNaN(normalCdf(0, 0, -1)));
});

test('inverse normal: reference values and round trips', () => {
  near(invNorm(0.975), 1.959963984540054, 1e-14);
  near(invNorm(0.05), -1.6448536269514729, 1e-14);
  near(invNorm(0.5, 100, 15), 100);
  near(invNorm(0.9, 100, 15), 119.22327348316901);
  near(invNorm(1e-10), -6.361340902404056, 1e-12);
  for (const p of [1e-6, 0.01, 0.3, 0.77, 0.999]) near(normalCdf(invNorm(p)), p, 1e-12, `p = ${p}`);
  assert.equal(invNorm(0), -Infinity);
  assert.equal(invNorm(1), Infinity);
  assert.ok(Number.isNaN(invNorm(1.5)));
});

test("Student's t: reference values", () => {
  near(tPdf(0, 1), 1 / Math.PI); // Cauchy
  near(tPdf(1, 1), 1 / (2 * Math.PI));
  near(tPdf(0.5, 5), 0.3279185313227464);
  near(tCdfAt(1, 1), 0.75);
  near(tCdfAt(2.2281388519862735, 10), 0.975, 1e-12);
  near(tCdfAt(-1.5, 3), 0.11529193262241144, 1e-11); // closed form for ν = 3
  near(tInterval(-2.2281388519862735, 2.2281388519862735, 10), 0.95, 1e-12);
  near(tInterval(5, 10, 4), 0.003464215129279302, 1e-10, 'upper tail'); // closed form for ν = 4
  near(invT(0.975, 10), 2.2281388519862735, 1e-13); // closed form for even ν, by bisection
  near(invT(0.025, 30), -2.0422724563012373, 1e-11);
  near(invT(0.995, 1), 63.65674116287399, 1e-10);
  assert.ok(Number.isNaN(tPdf(0, 0)) && Number.isNaN(invT(0.5, -1)));
});

test('χ²: reference values and closed forms', () => {
  near(chi2Cdf(3.841458820694124, 1), 0.95, 1e-12);
  near(chi2Cdf(18.307038053275146, 10), 0.95, 1e-12);
  for (const x of [0.1, 1, 4, 20]) {
    near(chi2Cdf(x, 2), -Math.expm1(-x / 2), 1e-13, `k = 2, x = ${x}`); // 1 − e^(−x/2)
    near(chi2Pdf(x, 2), 0.5 * Math.exp(-x / 2), 1e-13);
  }
  near(chi2Pdf(3, 5), 0.15418032980376922, 1e-12);
  assert.equal(chi2Pdf(-1, 3), 0);
  assert.equal(chi2Pdf(0, 2), 0.5);
  assert.equal(chi2Cdf(-2, 3), 0);
  near(chi2Interval(40, 80, 10), 1.6944743428020952e-05, 1e-10, 'upper tail'); // Q(5, x) in closed form
  near(chi2Interval(1, 3, 2), Math.exp(-0.5) - Math.exp(-1.5), 1e-13);
});

test('binomial: exact values, step cdf, large n', () => {
  near(binomPdf(10, 0.5, 5), 252 / 1024);
  near(binomCdf(10, 0.5, 5), 638 / 1024);
  near(binomCdf(10, 0.5, 5.7), 638 / 1024); // P(X ≤ 5.7) = P(X ≤ 5)
  assert.equal(binomPdf(10, 0.5, 2.5), 0); // nothing between whole numbers
  assert.equal(binomPdf(10, 0.5, 11), 0);
  assert.equal(binomCdf(10, 0.3, -1), 0);
  assert.equal(binomCdf(10, 0.3, 10), 1);
  // Against a direct sum of exact terms.
  let s = 0;
  for (let k = 0; k <= 6; k++) s += binomPdf(20, 0.3, k);
  near(binomCdf(20, 0.3, 6), s, 1e-13);
  near(binomCdf(20, 0.3, 6), 0.608009812200924, 1e-12); // exact, with fractions
  near(binomInterval(20, 0.3, 3, 8), binomCdf(20, 0.3, 8) - binomCdf(20, 0.3, 2), 1e-13);
  near(binomInterval(20, 0.3, 18, 20), binomPdf(20, 0.3, 18) + binomPdf(20, 0.3, 19) + binomPdf(20, 0.3, 20), 1e-10, 'upper tail');
  near(binomPdf(10000, 0.5, 5000), 0.007978646139382154, 1e-10);
  assert.equal(binomPdf(5, 0, 0), 1);
  assert.equal(binomPdf(5, 1, 5), 1);
  assert.ok(Number.isNaN(binomPdf(5.5, 0.5, 2)) && Number.isNaN(binomCdf(5, 1.2, 2)));
});

test('Poisson: exact values, step cdf, large μ', () => {
  near(poissonPdf(3, 2), 4.5 * Math.exp(-3));
  near(poissonCdf(3, 2), 8.5 * Math.exp(-3), 1e-13);
  near(poissonCdf(3, 2.9), 8.5 * Math.exp(-3), 1e-13);
  assert.equal(poissonPdf(3, 1.5), 0);
  assert.equal(poissonCdf(3, -0.5), 0);
  near(poissonPdf(1000, 1000), 0.0126146113487215, 1e-10);
  near(poissonInterval(3, 1, 2), 7.5 * Math.exp(-3), 1e-13);
  near(poissonInterval(2, 12, 1e9), 1 - poissonCdf(2, 11), 1e-6, 'upper tail');
  assert.equal(poissonPdf(0, 0), 1);
  assert.ok(Number.isNaN(poissonPdf(-1, 2)));
});

test('the calculator functions: forms and defaults', () => {
  const F = DISTRIBUTION_FUNCTIONS;
  near(F.normalcdf.fn(1.96), normalCdf(1.96));
  near(F.normalcdf.fn(-1, 1), normalInterval(-1, 1));
  near(F.normalcdf.fn(85, 115, 100, 15), normalInterval(-1, 1));
  near(F.normalpdf.fn(0), normalPdf(0));
  near(F.tcdf.fn(1, 1), 0.75);
  near(F.tcdf.fn(-1, 1, 1), 0.5);
  near(F.chi2cdf.fn(2, 2), chi2Cdf(2, 2));
  near(F.binomcdf.fn(10, 0.5, 4, 6), binomInterval(10, 0.5, 4, 6));
  near(F.poissoncdf.fn(3, 1, 2), poissonInterval(3, 1, 2));
});

test('distribution functions in expressions: reserved words, any case, arity errors', () => {
  const texts = ['normalcdf(-1, 1)', 'InvNorm(0.975)', 'binompdf(10, 0.5, 5)', 'χ2cdf(3.841458820694124, 1)', 'normalcdf(1, 2, 3, 4, 5)', 'tpdf(1)'];
  const a = analyse(texts.map((text, i) => ({ id: i + 1, text })), {});
  near(a.rows[0].value, 0.6826894921370859);
  near(a.rows[1].value, 1.959963984540054, 1e-14);
  near(a.rows[2].value, 252 / 1024);
  near(a.rows[3].value, 0.95, 1e-12);
  assert.match(a.rows[4].error.message, /normalcdf takes 1 to 4 arguments, not 5/);
  assert.match(a.rows[5].error.message, /tpdf takes 2 arguments, not 1/);
});

// ---- derivatives and Taylor series --------------------------------------------------------
import { taylor } from '../src/js/expr/taylor.js';

function rowsOf(...texts) {
  return analyse(texts.map((text, i) => ({ id: i + 1, text })), {});
}

test('exact derivatives of the continuous distributions', () => {
  const a = rowsOf('y = normalcdf(x)', 'y = normalpdf(x, 1, 2)', 'y = tcdf(x, 5)', 'y = chi2pdf(x, 4)', 'y = invnorm(x)', 'y = normalcdf(-x, x)', 'y = tpdf(x, 3)', 'y = chi2cdf(1, x, 3)');
  a.rows.forEach((r, i) => {
    const d = r.derivative();
    assert.ok(d && !/d\/dx|nderiv/.test(d.text), `row ${i + 1} has a symbolic derivative: ${d && d.text}`);
    for (const x of [0.3, 0.7, 0.9]) {
      const h = 1e-5;
      near(d.f(x), (r.f(x + h) - r.f(x - h)) / (2 * h), 1e-7, `row ${i + 1} at ${x}`);
    }
  });
  assert.equal(a.rows[0].derivative().text, 'normalpdf(x)');
});

test('Taylor polynomials of the continuous distributions', () => {
  const a = rowsOf('y = normalcdf(x)', 'y = normalpdf(x)', 'y = tcdf(x, 1)', 'y = chi2pdf(x, 2)', 'y = normalcdf(-x, x, 0, 1)');
  const phi0 = 1 / Math.sqrt(2 * Math.PI);
  // Φ(x) = ½ + φ(0)(x − x³/6 + x⁵/40 − …)
  const c = taylor(a.rows[0].body, a, 0, 5).coeffs;
  [0.5, phi0, 0, -phi0 / 6, 0, phi0 / 40].forEach((v, k) => near(c[k], v, 1e-12, `Φ coefficient ${k}`));
  // φ(x) = φ(0)(1 − x²/2 + x⁴/8)
  const p = taylor(a.rows[1].body, a, 0, 4).coeffs;
  [phi0, 0, -phi0 / 2, 0, phi0 / 8].forEach((v, k) => near(p[k], v, 1e-12, `φ coefficient ${k}`));
  // Cauchy cdf ½ + atan(x)/π = ½ + (x − x³/3)/π
  const t = taylor(a.rows[2].body, a, 0, 3).coeffs;
  [0.5, 1 / Math.PI, 0, -1 / (3 * Math.PI)].forEach((v, k) => near(t[k], v, 1e-12, `t coefficient ${k}`));
  // chi2pdf(x, 2) = e^(−x/2)/2 about x = 1
  const q = taylor(a.rows[3].body, a, 1, 3).coeffs;
  const e = Math.exp(-0.5) / 2;
  [e, -e / 2, e / 8, -e / 48].forEach((v, k) => near(q[k], v, 1e-12, `χ² coefficient ${k}`));
  // P(−x ≤ Z ≤ x) = 2φ(0)(x − x³/6)
  const w = taylor(a.rows[4].body, a, 0, 3).coeffs;
  [0, 2 * phi0, 0, -phi0 / 3].forEach((v, k) => near(w[k] + 1e-300, v + 1e-300, 1e-12, `interval coefficient ${k}`));
});

test('no Taylor polynomial for discrete distributions or inverse cdfs, with the function named', () => {
  const a = rowsOf('y = binompdf(10, 0.5, x)', 'y = invnorm(x)', 'y = normalpdf(x, x, 1)');
  const r0 = taylor(a.rows[0].body, a, 3, 2);
  assert.equal(r0.reason, 'numeric');
  assert.equal(r0.name, 'binompdf');
  assert.equal(taylor(a.rows[1].body, a, 0.5, 2).name, 'invNorm');
  assert.equal(taylor(a.rows[2].body, a, 0.5, 2).reason, 'numeric');
});

test('graphs of a discrete distribution of x are flagged to be drawn as stems', () => {
  const a = rowsOf('y = binompdf(10, 0.3, x)', 'poissoncdf(4, x)', 'g(k) = poissonpdf(3, k)', 'y = g(x)', 'y = binompdf(10, x, 3)', 'y = normalpdf(x)', 'f(x) = binomcdf(8, 0.5, 0, x)');
  assert.deepEqual(a.rows.map((r) => !!r.discrete), [true, true, false, true, false, false, true]);
});
