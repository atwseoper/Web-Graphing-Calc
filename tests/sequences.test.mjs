// Recursive sequences, "Plot as sequence" and cobweb diagrams (Phase 9b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, MAX_SEQUENCE_N } from '../src/js/expr/model.js';
import { cobwebPath, cobwebSteps, DEFAULT_COBWEB_STEPS } from '../src/js/numerics/cobweb.js';
import { defaultState, newRow } from '../src/js/state/defaults.js';
import { serialize, deserialize } from '../src/js/state/persist.js';

const rowsOf = (...texts) => texts.map((t, id) => (typeof t === 'string' ? { id, text: t } : { id, ...t }));
const run = (...texts) => analyse(rowsOf(...texts));

test('a recursive sequence with a starting value', () => {
  const a = run('u(n) = 2u(n - 1) + 1', 'u(0) = 1', 'u(5)', 'u(2.5)', 'u(-1)');
  assert.equal(a.rows[0].kind, 'sequence');
  assert.equal(a.rows[0].lowest, 0);
  assert.equal(a.rows[0].param, 'n');
  assert.equal(a.rows[0].f(3), 15);
  assert.equal(a.rows[1].kind, 'start');
  assert.equal(a.rows[1].value, 1);
  assert.equal(a.rows[2].value, 63);
  assert.ok(Number.isNaN(a.rows[3].value)); // only whole n
  assert.ok(Number.isNaN(a.rows[4].value)); // before the start
});

test('second-order sequences and several starting values', () => {
  const a = run('F(n) = F(n-1) + F(n-2)', 'F(0) = 0', 'F(1) = 1', 'F(30)', 'F([0...10])');
  assert.equal(a.rows[3].value, 832040);
  assert.deepEqual(a.rows[4].values, [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]);
});

test('a sequence starts at the lowest n given a starting value (D61)', () => {
  const a = run('v(1) = 3', 'v(n) = v(n - 1)/2', 'v(0)', 'v(3)');
  assert.equal(a.rows[1].lowest, 1);
  assert.ok(Number.isNaN(a.rows[2].value));
  assert.equal(a.rows[3].value, 0.75);
});

test('sequences use sliders and other definitions, and work up to n = 10^5', () => {
  const a = run('u(n) = k u(n-1)(1 - u(n-1))', 'u(0) = 0.2', 'k = 2', 'u(200)', `u(${MAX_SEQUENCE_N})`, `u(${MAX_SEQUENCE_N + 1})`);
  assert.ok(Math.abs(a.rows[3].value - 0.5) < 1e-12); // k = 2 settles at 1/2
  assert.ok(Number.isFinite(a.rows[4].value));
  assert.ok(Number.isNaN(a.rows[5].value));
  const s = run('s(n) = s(n - 1) + n^2', 's(0) = 0', 's(10)');
  assert.equal(s.rows[2].value, 385);
  const l = run('L = [5, 7, 9]', 'w(n) = w(n - 1) + L[n]', 'w(0) = 0', 'w(3)');
  assert.equal(l.rows[3].value, 21);
});

test('a term that needs a later one is undefined', () => {
  const a = run('w(n) = w(n + 1)', 'w(0) = 1', 'w(0)', 'w(1)');
  assert.equal(a.rows[2].value, 1);
  assert.ok(Number.isNaN(a.rows[3].value));
});

test('sequence errors are explained', () => {
  const msg = (...t) => run(...t).rows[0].error.message;
  assert.match(msg('h(n) = h(n - 1) + 1'), /refers to itself, so it needs a starting value too, such as h\(0\) = 1/);
  assert.match(msg('f(2) = 3'), /starting value: it needs a rule such as f\(n\) = 2f\(n - 1\)/);
  assert.match(msg('g(1) = 5', 'g(x) = x^2'), /only works for a sequence that refers to itself/);
  assert.match(msg('u(0.5) = 1', 'u(n) = u(n-1)'), /whole number n ≥ 0/);
  assert.match(msg('u(0) = 1', 'u(0) = 2', 'u(n) = u(n-1)'), /given more than once/);
  assert.match(msg('u(n) = r u(n-1)', 'u(0) = 1'), /r is kept for polar graphs/);
  assert.match(msg('u(n) = x u(n-1)', 'u(0) = 1'), /'x' isn't the variable of u/);
  assert.match(msg('u(0) = u(1)', 'u(n) = u(n-1)'), /can't use u itself/);
  assert.match(msg('u(1, 2) = 3'), /one variable/);
});

test('"Plot as sequence" on y = f(x) and one-variable functions', () => {
  const a = analyse(rowsOf({ text: 'y = 1/x', sequence: true }, { text: 'v(n) = 1/n', sequence: true }, 'p(n) = n^2'));
  assert.equal(a.rows[0].kind, 'cartesian');
  assert.equal(a.rows[0].asSequence, true);
  assert.equal(a.rows[1].kind, 'function');
  assert.equal(a.rows[1].asSequence, true);
  assert.equal(a.rows[1].f(4), 0.25);
  assert.equal(a.rows[2].f, undefined); // not plotted until switched on
});

test('first-order recurrences offer a cobweb diagram', () => {
  const a = run('u(n) = k u(n-1)(1 - u(n-1))', 'u(0) = 0.2', 'k = 3');
  const cw = a.rows[0].cobweb;
  assert.ok(cw);
  assert.equal(cw.u0, 0.2);
  assert.equal(cw.g(0.5), 0.75);
  // Not first order, depends on n, or several starting values: no cobweb.
  assert.equal(run('F(n) = F(n-1) + F(n-2)', 'F(0) = 0', 'F(1) = 1').rows[0].cobweb, null);
  assert.equal(run('s(n) = s(n-1) + n', 's(0) = 0').rows[0].cobweb, null);
});

test('the cobweb staircase', () => {
  const p = cobwebPath((x) => x / 2, 1, 3);
  assert.deepEqual(p.xs, [1, 1, 0.5, 0.5, 0.25, 0.25, 0.125]);
  assert.deepEqual(p.ys, [0, 0.5, 0.5, 0.25, 0.25, 0.125, 0.125]);
  const stop = cobwebPath((x) => 1 / (x - 2), 2, 5);
  assert.deepEqual(stop.xs, [2]);
  assert.equal(cobwebSteps(null).steps, DEFAULT_COBWEB_STEPS);
  assert.equal(cobwebSteps(40).steps, 40);
  assert.match(cobwebSteps(0).error, /1 to 500/);
  assert.match(cobwebSteps(2.5).error, /whole number/);
});

test('sequence settings are saved with the row', () => {
  const s = defaultState();
  const row = { ...newRow(1, '#2f6fed', 'u(n) = u(n-1)/2'), sequence: true, cobweb: true, cobwebN: '30' };
  const back = deserialize(serialize({ ...s, rows: [row] }));
  assert.equal(back.rows[0].sequence, true);
  assert.equal(back.rows[0].cobweb, true);
  assert.equal(back.rows[0].cobwebN, '30');
  assert.equal(deserialize(serialize(s)).rows[0].cobweb, false);
});
