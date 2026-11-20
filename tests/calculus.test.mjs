// Visual calculus (Phase 6b): Riemann sums and Taylor polynomials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riemann, RIEMANN_MAX_N } from '../src/js/numerics/riemann.js';
import {
  taylor, evalTaylor, taylorText, numberText, TAYLOR_MAX_DEGREE, taylorSummary, taylorCoefficients,
} from '../src/js/expr/taylor.js';
import { exactConstant } from '../src/js/expr/taylor-exact.js';
import { Rational, rationalRoot, factorialOf, factorialBig } from '../src/js/numerics/rational.js';
import { analyse } from '../src/js/expr/model.js';
import { riemannOf, taylorOf as taylorOfRow, secantOf } from '../src/js/expr/calculus.js';
import { newRow, defaultState } from '../src/js/state/defaults.js';
import { serialize, deserialize } from '../src/js/state/persist.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≈ ${b}`);

test('Riemann sums of x² on [0, 1] match the closed forms', () => {
  const f = (x) => x * x;
  const n = 10;
  // Σ k² = n(n+1)(2n+1)/6
  close(riemann(f, 0, 1, n, 'left').value, ((n - 1) * n * (2 * n - 1)) / 6 / n ** 3);
  close(riemann(f, 0, 1, n, 'right').value, (n * (n + 1) * (2 * n + 1)) / 6 / n ** 3);
  close(riemann(f, 0, 1, n, 'mid').value, 1 / 3 - 1 / (12 * n * n));
  close(riemann(f, 0, 1, n, 'trap').value, 1 / 3 + 1 / (6 * n * n));
});

test('Riemann sums are exact where they should be, and converge', () => {
  const line = (x) => 3 * x + 1;
  for (const m of ['mid', 'trap']) close(riemann(line, -2, 5, 7, m).value, (3 / 2) * (25 - 4) + 7);
  const s = riemann(Math.sin, 0, Math.PI, RIEMANN_MAX_N, 'mid').value;
  close(s, 2, 1e-4);
});

test('Riemann sums: shapes for drawing, reversed ranges and bad input', () => {
  const r = riemann((x) => x, 0, 2, 4, 'left');
  assert.deepEqual(r.edges, [0, 0.5, 1, 1.5, 2]);
  assert.deepEqual(r.heights, [0, 0.5, 1, 1.5]);
  assert.equal(riemann((x) => x, 0, 2, 4, 'trap').heights.length, 5);
  close(riemann((x) => x * x, 1, 0, 10, 'mid').value, -riemann((x) => x * x, 0, 1, 10, 'mid').value);
  const bad = riemann((x) => 1 / x, 0, 1, 4, 'left');
  assert.equal(bad.ok, false);
  assert.match(bad.message, /undefined at x = 0/);
  assert.equal(riemann((x) => 1 / x, 0, 1, 4, 'mid').ok, true);
  assert.throws(() => riemann(Math.sin, 0, 1, 0, 'left'), RangeError);
  assert.throws(() => riemann(Math.sin, 0, 1, 201, 'left'), RangeError);
  assert.throws(() => riemann(Math.sin, 0, 1, 2.5, 'left'), RangeError);
  assert.throws(() => riemann(Math.sin, 0, 1, 4, 'simpson'), RangeError);
});

// The Taylor polynomial of the last row that is a function of x.
function taylorOf(texts, x0, n) {
  const a = analyse(texts.map((text, i) => ({ id: i, text })));
  const r = a.rows.findLast((x) => x.body);
  return taylor(r.body, a, x0, n);
}

test('Taylor coefficients of familiar functions', () => {
  const ex = taylorOf(['y = e^x'], 0, 6);
  assert.equal(ex.ok, true);
  ex.coeffs.forEach((c, k) => close(c, 1 / [1, 1, 2, 6, 24, 120, 720][k]));
  const s = taylorOf(['y = sin(x)'], 0, 7).coeffs;
  [0, 1, 0, -1 / 6, 0, 1 / 120, 0, -1 / 5040].forEach((c, k) => close(s[k], c, 1e-12));
  // About x0 = 1: ln x = (x−1) − (x−1)²/2 + (x−1)³/3
  const l = taylorOf(['y = ln(x)'], 1, 3).coeffs;
  [0, 1, -0.5, 1 / 3].forEach((c, k) => close(l[k], c, 1e-12));
  // A polynomial is its own Taylor polynomial.
  const p = taylorOf(['f(x) = 2x^3 - x + 4'], 2, 5).coeffs;
  for (const x of [-3, 0.5, 7]) close(evalTaylor(p, 2, x), 2 * x ** 3 - x + 4, 1e-10);
  close(p[4], 0, 1e-12);
  // User functions inside are inlined; sliders are fixed values.
  const q = taylorOf(['a = 3', 'g(u) = u^2', 'y = a g(x)'], 0, 2).coeffs;
  [0, 0, 3].forEach((c, k) => close(q[k], c));
  // Degree 10 where repeated symbolic derivatives explode (D52).
  const r10 = taylorOf(['y = 1/(1 + x^2)'], 0, 10).coeffs;
  [1, 0, -1, 0, 1, 0, -1, 0, 1, 0, -1].forEach((c, k) => close(r10[k], c, 1e-12));
  const t10 = taylorOf(['y = tan(x)'], 0, 9).coeffs;
  [0, 1, 0, 1 / 3, 0, 2 / 15, 0, 17 / 315, 0, 62 / 2835].forEach((c, k) => close(t10[k], c, 1e-12));
  const s10 = taylorOf(['y = sqrt(1 + x)'], 0, 10).coeffs;
  let binom = 1;
  s10.forEach((c, k) => { close(c, binom, 1e-12); binom *= (0.5 - k) / (k + 1); });
  const a10 = taylorOf(['y = atan(x)'], 0, 9).coeffs;
  [0, 1, 0, -1 / 3, 0, 1 / 5, 0, -1 / 7, 0, 1 / 9].forEach((c, k) => close(a10[k], c, 1e-12));
  // Composite stays accurate at degree 10.
  const c10 = taylorOf(['y = e^(sin(x))'], 0, TAYLOR_MAX_DEGREE);
  assert.equal(c10.ok, true);
  close(evalTaylor(c10.coeffs, 0, 0.1), Math.exp(Math.sin(0.1)), 1e-12);
});

test('no Taylor polynomial without exact derivatives, or where f is undefined', () => {
  assert.deepEqual(taylorOf(['y = gamma(x)'], 1, 3), { ok: false, reason: 'numeric', name: 'gamma' });
  assert.deepEqual(taylorOf(['y = nCr(x, 2)'], 3, 2), { ok: false, reason: 'numeric', name: 'nCr' });
  assert.deepEqual(taylorOf(['y = x!'], 3, 1), { ok: false, reason: 'numeric', name: '!' });
  // Degree 0 needs no derivative at all.
  assert.equal(taylorOf(['y = gamma(x)'], 1, 0).ok, true);
  assert.deepEqual(taylorOf(['y = ln(x)'], 0, 2), { ok: false, reason: 'undefined', order: 0 });
  assert.deepEqual(taylorOf(['y = sqrt(x)'], 0, 2), { ok: false, reason: 'undefined', order: 1 });
  assert.deepEqual(taylorOf(['y = abs(x)'], 0, 2), { ok: false, reason: 'undefined', order: 1 });
  assert.deepEqual(taylorOf(['y = floor(x)'], 2, 2), { ok: false, reason: 'undefined', order: 0 });
  assert.deepEqual(taylorOf(['y = 1/x'], 0, 2), { ok: false, reason: 'undefined', order: 0 });
});

test('Taylor polynomials as rows that read back to the same function', () => {
  assert.equal(taylorText([1, 1, 0.5], 0), 'y = 1 + x + 0.5 x^2');
  assert.equal(taylorText([0, 1, 0, -1 / 6], 0), 'y = x - 0.1666666667 x^3');
  assert.equal(taylorText([0, 1, -0.5], 1), 'y = (x - 1) - 0.5(x - 1)^2');
  assert.equal(taylorText([2, -3], -2.5), 'y = 2 - 3(x + 2.5)');
  assert.equal(taylorText([0, 0], 0), 'y = 0');
  assert.equal(taylorText([-4], 0), 'y = -4');
  // Tiny and huge coefficients avoid "e", which would be the constant e.
  assert.equal(numberText(1 / 3628800), '2.755731922*10^(-7)');
  assert.equal(numberText(1 / 40320), '0.0000248015873');
  assert.equal(numberText(2.5e-12), '2.5*10^(-12)');
  assert.equal(numberText(-1.5e20), '-1.5*10^(20)');
  assert.equal(numberText(123456.789), '123456.789');
  // Round trip: the row text, analysed, gives the polynomial.
  const coeffs = taylorOf(['y = cos(x)'], 0.7, 6).coeffs;
  const text = taylorText(coeffs, 0.7);
  const r = analyse([{ id: 1, text }]).rows[0];
  assert.equal(r.kind, 'cartesian', text);
  for (const x of [-1, 0.7, 2]) close(r.f(x), evalTaylor(coeffs, 0.7, x), 1e-8);
  const tiny = taylorText(taylorOf(['y = e^x'], 0, 10).coeffs, 0);
  const rt = analyse([{ id: 1, text: tiny }]).rows[0];
  close(rt.f(1), [...Array(11)].reduce((s, _, k) => s + 1 / [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800][k], 0), 1e-9);
});

test('Taylor polynomials of everything else the parser accepts', () => {
  const at = (t, x0, n = 4) => taylorOf([t], x0, n);
  const near = (t, x0, f, n = 6) => {
    const r = at(t, x0, n);
    assert.equal(r.ok, true, `${t}: ${JSON.stringify(r)}`);
    for (const dx of [0.01, -0.02]) close(evalTaylor(r.coeffs, x0, x0 + dx), f(x0 + dx), 1e-9);
  };
  near('y = x^x', 1.5, (x) => x ** x);
  near('y = 2^x', 0.3, (x) => 2 ** x);
  near('y = cbrt(x)', -8, Math.cbrt);
  near('y = x^(1/3)', -8, Math.cbrt);
  near('y = (x - 1)^4', 1, (x) => (x - 1) ** 4);
  near('y = log(x)', 3, Math.log10);
  near('y = log(x, 2)', 3, Math.log2);
  near('y = sec(x) + csc(x) + cot(x)', 0.7, (x) => 1 / Math.cos(x) + 1 / Math.sin(x) + 1 / Math.tan(x));
  near('y = asin(x) + acos(x/2)', 0.3, (x) => Math.asin(x) + Math.acos(x / 2));
  near('y = sinh(x) cosh(x) tanh(x)', 0.4, (x) => Math.sinh(x) * Math.cosh(x) * Math.tanh(x));
  near('y = asinh(x) + acosh(x + 2) + atanh(x/2)', 0.4, (x) => Math.asinh(x) + Math.acosh(x + 2) + Math.atanh(x / 2));
  near('y = abs(x) + floor(x) + ceil(x) + round(x) + sign(x)', -1.3, (x) => Math.abs(x) + Math.floor(x) + Math.ceil(x) + Math.round(x) + Math.sign(x));
  near('y = min(x, 2, x^2) + max(x, 1)', 1.5, (x) => Math.min(x, 2, x * x) + Math.max(x, 1));
  near('y = mod(x, 3)', 4.2, (x) => ((x % 3) + 3) % 3);
  near('y = {x < 0: -x^2, x^3}', 0.5, (x) => x ** 3);
  near('y = {x < 0: -x^2, x^3}', -0.5, (x) => -x * x);
  near('y = sum(x^k/k!, k, 0, 12)', 0.2, (x) => [...Array(13)].reduce((s, _, k) => s + x ** k / [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800, 39916800, 479001600][k], 0));
  near('y = prod(x + k, k, 1, 3)', 0.5, (x) => (x + 1) * (x + 2) * (x + 3));
  near('y = gamma(2) x', 1, (x) => x); // constant argument: fine
  // Corners and boundaries have no polynomial.
  assert.equal(at('y = {x < 0: -x^2, x^3}', 0).ok, false);
  assert.equal(at('y = max(x, -x)', 0).ok, false);
  assert.equal(at('y = {x < 0: x, x}', 0).ok, true); // the same on both sides
  // User functions, their derivatives and sliders.
  const f = taylorOf(['f(x) = x^3', 'y = f\'(x) + f(2x)'], 1, 3);
  assert.equal(f.ok, true);
  for (const x of [0.9, 1.2]) close(evalTaylor(f.coeffs, 1, x), 3 * x * x + 8 * x ** 3, 1e-9);
});

test('Taylor polynomials in degrees mode', () => {
  const a = analyse([{ id: 1, text: 'y = sin(x)' }], { angle: 'deg' });
  const r = taylor(a.rows[0].body, a, 30, 3);
  close(r.coeffs[0], 0.5, 1e-15);
  close(r.coeffs[1], (Math.PI / 180) * Math.cos(Math.PI / 6), 1e-12);
  const b = analyse([{ id: 1, text: 'y = atan(x)' }], { angle: 'deg' });
  close(taylor(b.rows[0].body, b, 1, 1).coeffs[1], 90 / Math.PI, 1e-12);
});

// ---- the row settings, as the panel and graph use them --------------------------------------
function rowWith(text, fields) {
  const row = { ...newRow(1, '#2f6fed', text), showAnalysis: true, ...fields };
  const analysis = analyse([row]);
  return { row, r: analysis.rows[0], analysis };
}

test('riemannOf uses the integral range and checks n', () => {
  const { row, r, analysis } = rowWith('y = x^2', { riemann: 'right', riemannN: '4', intFrom: '0', intTo: '2' });
  const rs = riemannOf(row, r, analysis);
  close(rs.res.value, 0.5 * (0.25 + 1 + 2.25 + 4));
  close(rs.exact.value, 8 / 3);
  assert.equal(riemannOf({ ...row, riemann: '' }, r, analysis), null);
  assert.equal(riemannOf({ ...row, riemannN: '' }, r, analysis).n, 10);
  assert.match(riemannOf({ ...row, riemannN: '0' }, r, analysis).error, /whole number from 1 to 200/);
  assert.match(riemannOf({ ...row, riemannN: '2.5' }, r, analysis).error, /whole number/);
  assert.deepEqual(riemannOf({ ...row, intTo: '' }, r, analysis), { need: 'range' });
  assert.match(riemannOf({ ...row, intTo: 'q' }, r, analysis).error, /q/);
});

test('taylorOf defaults to degree 3 about the panel\'s x', () => {
  const { row, r, analysis } = rowWith('y = e^x', { taylor: true, atX: '1' });
  const tp = taylorOfRow(row, r, analysis);
  assert.equal(tp.n, 3);
  assert.equal(tp.x0, 1);
  assert.equal(tp.fromAtX, true);
  close(tp.f(1.1), Math.E * (1 + 0.1 + 0.005 + 0.1 ** 3 / 6), 1e-12);
  assert.equal(taylorOfRow({ ...row, atX: '' }, r, analysis).x0, 0);
  assert.equal(taylorOfRow({ ...row, taylorAt: '2' }, r, analysis).x0, 2);
  assert.match(taylorOfRow({ ...row, taylorN: '31' }, r, analysis).error, /0 to 30/);
  assert.equal(taylorOfRow({ ...row, taylorN: '30' }, r, analysis).res.ok, true);
  assert.equal(taylorOfRow({ ...row, taylor: false }, r, analysis), null);
  // Cached: the same result object for the same row, point and degree.
  assert.equal(taylorOfRow(row, r, analysis).res, taylorOfRow(row, r, analysis).res);
  // f(x) = … rows work as well.
  const g = rowWith('g(x) = sin(x)', { taylor: true, taylorN: '5' });
  assert.equal(taylorOfRow(g.row, g.r, g.analysis).res.ok, true);
});

test('secantOf: gradient through x and x + h, against f\'(x)', () => {
  const { row, r, analysis } = rowWith('y = x^2', { secant: true, atX: '1', secantH: '0.5' });
  const sc = secantOf(row, r, analysis);
  close(sc.m, 2.5);
  close(sc.slope, 2);
  assert.equal(sc.fromAtX, true);
  close(secantOf(row, r, analysis, 0.001).m, 2.001); // while playing
  close(secantOf({ ...row, secantH: '' }, r, analysis).h, 1);
  assert.equal(secantOf({ ...row, atX: '' }, r, analysis).x0, 0);
  assert.match(secantOf({ ...row, secantH: '0' }, r, analysis).error, /can't be 0/);
  const bad = rowWith('y = ln(x)', { secant: true, atX: '-1' });
  assert.equal(secantOf(bad.row, bad.r, bad.analysis).ok, false);
});

test('the calculus settings are saved and shared with the row', () => {
  const s = defaultState();
  const row = { ...newRow(1, '#2f6fed', 'y = x^2'), riemann: 'trap', riemannN: '7', taylor: true, taylorN: '4', taylorAt: '1', secant: true, secantH: '0.25' };
  const back = deserialize(serialize({ ...s, rows: [row] })).rows[0];
  for (const k of ['riemann', 'riemannN', 'taylor', 'taylorN', 'taylorAt', 'secant', 'secantH']) assert.equal(back[k], row[k], k);
  const junk = deserialize(serialize({ ...s, rows: [{ ...row, riemann: 'simpson', taylor: 'yes' }] })).rows[0];
  assert.equal(junk.riemann, '');
  assert.equal(junk.taylor, false);
  // Older saves without them get the defaults.
  const old = deserialize(JSON.stringify({ version: 1, rows: [{ id: 1, text: 'y = x' }] })).rows[0];
  assert.equal(old.riemann, '');
  assert.equal(old.secant, false);
});

// ---- Phase 6c: degree 30, exact fractions, summary and table ---------------------------------
const R = (p, q = 1) => new Rational(BigInt(p), BigInt(q));
const exactOf = (texts, x0Text, n) => {
  const a = analyse(texts.map((text, i) => ({ id: i, text })));
  const r = a.rows.findLast((x) => x.body);
  const x0Exact = x0Text === null ? null : exactConstant(x0Text, a);
  return taylor(r.body, a, x0Exact ? x0Exact.toNumber() : Number(a.evaluate(x0Text).value), n, { x0Exact });
};
const fracs = (res) => res.exact && res.exact.map(String);

test('Rational arithmetic, roots and factorials', () => {
  assert.equal(String(R(6, -4)), '-3/2');
  assert.equal(String(R(1, 3).add(R(1, 6))), '1/2');
  assert.equal(String(Rational.fromDecimal('0.1')), '1/10');
  assert.equal(String(Rational.fromDecimal('-12.5e-3')), '-1/80');
  assert.equal(String(Rational.fromNumber(0.1 + 0.2)), '7500000000000001/25000000000000000'); // what the double prints as
  assert.equal(String(R(-7, 2).floor()), '-4');
  assert.equal(String(rationalRoot(R(27, 8), 3)), '3/2');
  assert.equal(String(rationalRoot(R(-8), 3)), '-2');
  assert.equal(rationalRoot(R(2), 2), null);
  assert.equal(rationalRoot(R(-4), 2), null);
  assert.equal(factorialOf(factorialBig(30)), 30);
  assert.equal(factorialOf(factorialBig(30) + 1n), null);
  close(R(1n, 1n).div(new Rational(factorialBig(30))).toNumber(), 1 / 2.652528598121910586e32, 1e-15);
});

test('exact coefficients where they are certainly rational', () => {
  // e^x: 1/k! all the way to degree 30.
  const ex = exactOf(['y = e^x'], '0', 30);
  ex.exact.forEach((r, k) => assert.equal(r.q, factorialBig(k), `k = ${k}`));
  assert.deepEqual(fracs(exactOf(['y = sin(x)'], '0', 7)), ['0', '1', '0', '-1/6', '0', '1/120', '0', '-1/5040']);
  assert.deepEqual(fracs(exactOf(['y = 1/(1 + x^2)'], '0', 6)), ['1', '0', '-1', '0', '1', '0', '-1']);
  assert.deepEqual(fracs(exactOf(['y = sqrt(1 + x)'], '0', 4)), ['1', '1/2', '-1/8', '1/16', '-5/128']);
  assert.deepEqual(fracs(exactOf(['y = ln(x)'], '1', 4)), ['0', '1', '-1/2', '1/3', '-1/4']);
  assert.deepEqual(fracs(exactOf(['y = atan(x)'], '0', 5)), ['0', '1', '0', '-1/3', '0', '1/5']);
  assert.deepEqual(fracs(exactOf(['y = tan(x)'], '0', 9)), ['0', '1', '0', '1/3', '0', '2/15', '0', '17/315', '0', '62/2835']);
  // tan to degree 29 exactly, checked against T′ = 1 + T² in BigInt fractions.
  const t = [R(0)];
  for (let k = 0; k < 29; k++) {
    let sq = R(0);
    for (let j = 0; j <= k; j++) sq = sq.add((t[j] || R(0)).mul(t[k - j] || R(0)));
    t[k + 1] = (k === 0 ? R(1) : R(0)).add(sq).div(R(k + 1));
  }
  assert.deepEqual(fracs(exactOf(['y = tan(x)'], '0', 29)), t.map(String));
  // Typed decimals, sliders, user functions and exact x0 fields.
  assert.deepEqual(fracs(exactOf(['a = 0.3', 'y = a x^2 + 0.1'], '0', 2)), ['1/10', '0', '3/10']);
  assert.deepEqual(fracs(exactOf(['g(u) = u^3', 'y = g(x)/6'], '1/2', 3)), ['1/48', '1/8', '1/4', '1/6']);
  assert.deepEqual(fracs(exactOf(['y = x^2'], '1/3', 2)), ['1/9', '2/3', '1']);
  assert.deepEqual(fracs(exactOf(['y = e^(x - 2)'], '2', 3)), ['1', '1', '1/2', '1/6']);
  assert.deepEqual(fracs(exactOf(['y = 2^x'], '0', 0)), ['1']);
  assert.deepEqual(fracs(exactOf(['y = cbrt(x)'], '-8', 2)), ['-2', '1/12', '1/288']);
  assert.equal(exactOf(['y = floor(x) + abs(x) + x!'], '3.5', 1).ok, false); // x! has no polynomial
  assert.deepEqual(fracs(exactOf(['y = floor(x) + abs(x)'], '-3.5', 1)), ['-1/2', '-1']);
  assert.deepEqual(fracs(exactOf(['y = {x < 0: -x^2, x^3}'], '1/2', 3)), ['1/8', '3/4', '3/2', '1']);
  assert.deepEqual(fracs(exactOf(['y = sum(x^k/k!, k, 0, 4)'], '0', 5)), ['1', '1', '1/2', '1/6', '1/24', '0']);
  assert.deepEqual(fracs(exactOf(['y = nCr(5, 2) x + gamma(4)'], '0', 1)), ['6', '10']);
});

test('decimals wherever exactness isn\'t certain', () => {
  const none = (texts, x0, n = 3) => assert.equal(exactOf(texts, x0, n).exact, null, `${texts.at(-1)} about ${x0}`);
  none(['y = sin(x)'], '1'); // sin 1
  none(['y = e^x'], '1'); // e
  none(['y = π x'], '0');
  none(['y = sqrt(x)'], '2'); // √2
  none(['y = ln(x)'], '2');
  none(['y = x^2'], 'π');
  none(['y = log(x)'], '1'); // 1/ln 10
  none(['y = acos(x)'], '0'); // π/2
  none(['y = normalpdf(x)'], '0');
  none(['y = x^2'], '0.1234567890123456'); // more digits than a double keeps
  // Derivative bodies trust only whole numbers: 0.1·3 folds to 0.30000000000000004…
  none(['f(x) = 0.1 x^3', "y = f'(x)"], '1');
  assert.deepEqual(fracs(exactOf(['f(x) = x^3/3', "y = f'(x) + 0.1 x"], '1', 3)), ['11/10', '21/10', '1', '0']);
  assert.deepEqual(fracs(exactOf(['f(x) = x^3', "y = f'(x)"], '1', 2)), ['3', '6', '3']); // …which is enough here
  const deg = analyse([{ id: 1, text: 'y = sin(x)' }], { angle: 'deg' });
  assert.equal(taylor(deg.rows[0].body, deg, 0, 3, { x0Exact: R(0) }).exact, null); // π/180
  // Without an exact x0 there are no exact coefficients.
  const a = analyse([{ id: 1, text: 'y = x^2' }]);
  assert.equal(taylor(a.rows[0].body, a, 0.5, 2).exact, null);
});

test('exactConstant reads fields that are certainly rational', () => {
  const a = analyse([{ id: 1, text: 'a = 0.25' }, { id: 2, text: 'b = 2a' }]);
  assert.equal(String(exactConstant('1/3', a)), '1/3');
  assert.equal(String(exactConstant('a + 1/2', a)), '3/4');
  assert.equal(String(exactConstant('b^2', a)), '1/4');
  assert.equal(String(exactConstant('-0.5', a)), '-1/2');
  assert.equal(exactConstant('π', a), null);
  assert.equal(exactConstant('sqrt(2)', a), null);
  assert.equal(String(exactConstant('sqrt(9/4)', a)), '3/2');
  assert.equal(exactConstant('x + 1', a), null);
  assert.equal(exactConstant('', a), null);
  assert.equal(exactConstant('1 +', a), null);
});

test('row text with exact fractions reads back to the polynomial', () => {
  const opts = (res) => ({ exact: res.exact, x0Exact: res.x0Exact });
  const ex = exactOf(['y = e^x'], '0', 4);
  assert.equal(taylorText(ex.coeffs, 0, opts(ex)), 'y = 1 + x + x^2/2 + x^3/6 + x^4/24');
  const sn = exactOf(['y = sin(x)'], '0', 5);
  assert.equal(taylorText(sn.coeffs, 0, opts(sn)), 'y = x - x^3/6 + x^5/120');
  const sq = exactOf(['y = x^2'], '1/3', 2);
  assert.equal(taylorText(sq.coeffs, 1 / 3, opts(sq)), 'y = 1/9 + 2(x - 1/3)/3 + (x - 1/3)^2');
  const neg = exactOf(['y = x^3'], '-1/2', 3);
  assert.equal(taylorText(neg.coeffs, -0.5, opts(neg)), 'y = -1/8 + 3(x + 1/2)/4 - 3(x + 1/2)^2/2 + (x + 1/2)^3');
  // Big factorial denominators are written m!, exactly.
  const e30 = exactOf(['y = e^x'], '0', 30);
  const text = taylorText(e30.coeffs, 0, opts(e30));
  assert.match(text, /\+ x\^9\/362880 \+ x\^10\/10! .* \+ x\^30\/30!$/);
  for (const [t, x0, res] of [['sin', 0, sn], ['sq', 1 / 3, sq], ['neg', -0.5, neg], ['e30', 0, e30]]) {
    const row = analyse([{ id: 1, text: taylorText(res.coeffs, x0, opts(res)) }]).rows[0];
    assert.equal(row.kind, 'cartesian', t);
    for (const x of [x0 - 0.3, x0 + 0.2]) close(row.f(x), evalTaylor(res.coeffs, x0, x), 1e-12);
  }
  // Inexact coefficients stay decimals.
  const s1 = exactOf(['y = sin(x)'], '1', 2);
  assert.equal(taylorText(s1.coeffs, 1, opts(s1)), 'y = 0.8414709848 + 0.5403023059(x - 1) - 0.4207354924(x - 1)^2');
});

test('the panel summary shows the first and last terms, the table every coefficient', () => {
  const opts = (res) => ({ exact: res.exact, x0Exact: res.x0Exact });
  const ex = exactOf(['y = e^x'], '0', 4);
  assert.deepEqual(taylorSummary(ex.coeffs, 0, opts(ex)), { text: '1 + x + x²/2 + x³/6 + x⁴/24', shown: 5, total: 5 });
  const e30 = exactOf(['y = e^x'], '0', 30);
  assert.deepEqual(taylorSummary(e30.coeffs, 0, opts(e30)), { text: '1 + x + x²/2 + … + x²⁹/29! + x³⁰/30!', shown: 5, total: 31 });
  const s15 = exactOf(['y = sin(x)'], '0', 15);
  assert.equal(taylorSummary(s15.coeffs, 0, opts(s15)).text, 'x − x³/6 + x⁵/120 + … + x¹³/13! − x¹⁵/15!');
  const s1 = exactOf(['y = sin(x)'], '1', 8);
  assert.match(taylorSummary(s1.coeffs, 1, opts(s1)).text, /^0\.8414709848 \+ 0\.5403023059\(x − 1\) − 0\.4207354924\(x − 1\)² \+ … /);
  // The table: fractions when exact (zeros included), decimals otherwise.
  const tbl = taylorCoefficients(s15.coeffs, opts(s15));
  assert.equal(tbl.length, 16);
  assert.deepEqual(tbl.slice(0, 4).map((c) => c.show), ['0', '1', '0', '−1/6']);
  assert.equal(tbl[15].show, '−1/15!');
  assert.equal(tbl.every((c) => c.exact), true);
  const dec = taylorCoefficients(s1.coeffs, opts(s1));
  assert.equal(dec[0].show, '0.8414709848');
  assert.equal(dec[0].exact, false);
  assert.match(taylorCoefficients(exactOf(['y = e^x'], '1', 30).coeffs)[30].show, /^1\.024788886×10⁻³²$/); // e/30!
});
