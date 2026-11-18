// Visual calculus (Phase 6b): Riemann sums and Taylor polynomials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riemann, RIEMANN_MAX_N } from '../src/js/numerics/riemann.js';
import { taylor, evalTaylor, taylorText, numberText, TAYLOR_MAX_DEGREE } from '../src/js/expr/taylor.js';
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
  assert.match(taylorOfRow({ ...row, taylorN: '11' }, r, analysis).error, /0 to 10/);
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
