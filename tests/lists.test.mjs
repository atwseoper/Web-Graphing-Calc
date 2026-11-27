// Lists, ranges, indexing, list functions and curve families (Phase 9a, D61).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../src/js/expr/tokenizer.js';
import { parse } from '../src/js/expr/parser.js';
import { analyse } from '../src/js/expr/model.js';
import { toText } from '../src/js/expr/print.js';
import { prettyLayout, plainText } from '../src/js/expr/pretty.js';
import {
  shiftPositions, listText, countText, MAX_LIST, MAX_CURVES,
} from '../src/js/expr/lists.js';
import { defaultState, newRow, newFit } from '../src/js/state/defaults.js';
import { newDataSet } from '../src/js/data/table.js';
import { serialize, deserialize, MAX_SAVED_LIST } from '../src/js/state/persist.js';
import { projectJson, openProject, shiftProjectPositions } from '../src/js/state/share.js';
import {
  listMean, listMedian, listStdev, listStdevp,
} from '../src/js/numerics/listfns.js';

const rowsOf = (...texts) => texts.map((text, id) => ({ id, text }));
const run = (texts, settings = {}) => analyse(rowsOf(...texts), settings);
const last = (texts, settings) => {
  const a = run(texts, settings);
  return a.rows[a.rows.length - 1];
};
const list = (texts, settings) => {
  const r = last(texts, settings);
  assert.equal(r.kind, 'list', `${texts.at(-1)} -> ${JSON.stringify(r.error || r.kind)}`);
  return r.values;
};
const value = (texts, settings) => {
  const r = last(texts, settings);
  assert.equal(r.kind, 'value', `${texts.at(-1)} -> ${JSON.stringify(r.error || r.kind)}`);
  return r.value;
};
const error = (texts, settings) => {
  const r = last(texts, settings);
  assert.equal(r.kind, 'error', `${texts.at(-1)} should be an error, got ${r.kind}`);
  return r.error.message;
};

// ---- tokenizer and parser -------------------------------------------------------------------

test('ranges tokenise with three dots or an ellipsis, and numbers stop before them', () => {
  assert.deepEqual(tokenize('[1...10]').map((t) => t.value), ['[', 1, '...', 10, ']', null]);
  assert.deepEqual(tokenize('[0, 0.5…5]').map((t) => t.value), ['[', 0, ',', 0.5, '...', 5, ']', null]);
  assert.throws(() => tokenize('[1..5]'), /three dots/);
  assert.throws(() => tokenize('1.2.3'), /one decimal point/);
});

test('lists, ranges and indexing parse', () => {
  assert.equal(parse('[1, 2, 3]').expr.type, 'list');
  assert.equal(parse('[]').expr.items.length, 0);
  const r = parse('[0, 0.5...5]').expr;
  assert.equal(r.type, 'range');
  assert.equal(r.second.value, 0.5);
  const ix = parse('L[2]^2').expr;
  assert.equal(ix.type, 'bin');
  assert.equal(ix.left.type, 'index');
  assert.equal(parse('L[2...4]').expr.index.type, 'range');
  assert.equal(parse('L[[1, 3]]').expr.index.type, 'list');
  // After a number, brackets multiply.
  const m = parse('2[1, 2]').expr;
  assert.equal(m.type, 'bin');
  assert.equal(m.right.type, 'list');
  // Indexing binds tighter than unary minus and powers.
  assert.equal(parse('-L[1]').expr.arg.type, 'index');
  assert.equal(parse('sum(L)').expr.type, 'call');
  assert.equal(parse('sum(k, k, 1, 3)').expr.type, 'series');
});

test('list syntax errors are explained', () => {
  assert.throws(() => parse('[1, 2'), /Missing '\]'/);
  assert.throws(() => parse('[1, 2, 3...10]'), /\[first...last\] or \[first, second...last\]/);
  assert.throws(() => parse('[1...]'), /last value/);
  assert.throws(() => parse('1...3'), /inside a list/);
  assert.throws(() => parse('L[]'), /position inside the brackets/);
  assert.throws(() => parse('1]'), /Unmatched '\]'/);
  assert.throws(() => parse('sum(1, 2)'), /takes a list/);
});

test('list nodes print and lay out', () => {
  for (const t of ['[1, 2, 3]', '[1...10]', '[0, 0.5...5]', 'L[2]', 'L[2...4]']) {
    assert.equal(toText(parse(t).expr), t);
  }
  assert.equal(plainText(prettyLayout(parse('[1...10]^2'))), '[1, …, 10]²');
  assert.equal(plainText(prettyLayout(parse('L_1[2]'))), 'L₁[2]');
});

// ---- values -----------------------------------------------------------------------------------

test('list variables, ranges and element-wise arithmetic', () => {
  assert.deepEqual(list(['L = [1, 2, 3]']), [1, 2, 3]);
  assert.deepEqual(list(['L = [1, 2, 3]', 'L^2 + 1']), [2, 5, 10]);
  assert.deepEqual(list(['[1...5]']), [1, 2, 3, 4, 5]);
  assert.deepEqual(list(['[5...1]']), [5, 4, 3, 2, 1]);
  assert.deepEqual(list(['[1...3.5]']), [1, 2, 3]);
  assert.deepEqual(list(['[0, 0.1...0.5]']), [0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  assert.deepEqual(list(['[10, 8...1]']), [10, 8, 6, 4, 2]);
  assert.deepEqual(list(['a = 2', '[a, 2a, 3a]']), [2, 4, 6]);
  assert.deepEqual(list(['L = [1, 2, 3]', 'M = 2L', 'M']), [2, 4, 6]);
  assert.deepEqual(list(['L = [0, 90]', 'sin(L)'], { angle: 'deg' }), [0, 1]);
  assert.deepEqual(list(['f(x) = x^2', 'f([1, 2, 3])']), [1, 4, 9]);
  assert.deepEqual(list(['[]']), []);
});

test('two lists pair up; different lengths use the shorter, with a warning', () => {
  assert.deepEqual(list(['[1, 2, 3] + [10, 20, 30]']), [11, 22, 33]);
  const r = last(['[1, 2, 3] + [10, 20]']);
  assert.deepEqual(r.values, [11, 22]);
  assert.match(r.warning, /different lengths \(2 and 3\)/);
});

test('list functions', () => {
  const L = 'L = [3, 1, 4, 1, 5, 9, 2, 6]';
  assert.equal(value([L, 'length(L)']), 8);
  assert.equal(value([L, 'sum(L)']), 31);
  assert.equal(value([L, 'prod(L)']), 6480);
  assert.equal(value([L, 'mean(L)']), 31 / 8);
  assert.equal(value([L, 'median(L)']), 3.5);
  assert.equal(value([L, 'min(L)']), 1);
  assert.equal(value([L, 'max(L)']), 9);
  assert.ok(Math.abs(value([L, 'stdev(L)']) - 2.748376144) < 1e-8);
  assert.ok(Math.abs(value([L, 'stdevp(L)']) - 2.570870475) < 1e-8);
  assert.equal(value(['sum([1...100])']), 5050);
  assert.equal(value(['length([])']), 0);
  assert.equal(value(['sum([])']), 0);
  assert.ok(Number.isNaN(value(['mean([])'])));
  // min and max of several numbers still work as before.
  assert.equal(value(['max(2, 7, 3)']), 7);
  assert.match(error(['mean(1, 2)']), /mean takes one list/);
});

test('list function helpers', () => {
  assert.equal(listMean(), NaN);
  assert.equal(listMedian(5), 5);
  assert.equal(listMedian(1, 2, 3, 4), 2.5);
  assert.ok(Number.isNaN(listStdev(1)));
  assert.equal(listStdevp(1), 0);
});

test('indexing from 1 (and from 0 by the setting)', () => {
  const L = 'L = [10, 20, 30, 40]';
  assert.equal(value([L, 'L[2]']), 20);
  assert.equal(value([L, 'L[2]'], { listIndex: '0' }), 30);
  assert.deepEqual(list([L, 'L[2...3]']), [20, 30]);
  assert.deepEqual(list([L, 'L[[1, 4]]']), [10, 40]);
  assert.equal(value([L, 'k = 3', 'L[k]']), 30);
  assert.equal(value([L, 'L[length(L)]']), 40);
  assert.equal(value(['[1...10][3]']), 3);
  // A varying position: looked up as it runs.
  assert.equal(value([L, 'sum(L[k]^2, k, 1, 4)']), 3000);
  assert.equal(value([L, 'sum(L[k], k, 0, 3)'], { listIndex: '0' }), 100);
  assert.equal(value([L, 'f(n) = L[n]', 'f(3)']), 30);
  assert.ok(Number.isNaN(value([L, 'f(n) = L[n]', 'f(9)'])));
});

test('positions outside the list, or not whole, are undefined with a warning', () => {
  const r = last(['L = [1, 2, 3]', 'L[5]']);
  assert.ok(Number.isNaN(r.value));
  assert.match(r.warning, /Position 5 is outside the list, which has positions 1 to 3/);
  const z = last(['L = [1, 2, 3]', 'L[3]'], { listIndex: '0' });
  assert.match(z.warning, /positions 0 to 2/);
  assert.match(last(['L = [1, 2, 3]', 'L[1.5]']).warning, /whole number/);
  assert.match(error(['a = 2', 'a[1]']), /'a' isn’t a list/);
  assert.match(error(['y = x[1, 2]']), /x isn’t a list.*x·\[…\]/);
});

test('list errors', () => {
  assert.match(error(['[[1, 2], 3]']), /can’t contain lists/);
  assert.match(error(['[1...20000]']), /at most 10,000 elements/);
  assert.match(error(['[1, 1...5]']), /must be different/);
  assert.match(error(['[1, 2...0]']), /never reaches 0/);
  assert.match(error(['y = [1...x]']), /range must be a fixed number/);
  assert.match(error(['L = [1, 2]', 'x^2 + y^2 = L']), /implicit curves/);
  assert.match(error(['L = [1, 2]', 'y < L x']), /inequalities/);
  assert.match(error(['L = [x, 2]']), /can't depend on x/);
  assert.equal(MAX_LIST, 10000);
});

// ---- graphs ------------------------------------------------------------------------------------

test('a row with a list draws a family of curves, labelled by element', () => {
  const r = last(['L = [1, 2, 3]', 'y = L x']);
  assert.equal(r.kind, 'family');
  assert.equal(r.of, 'cartesian');
  assert.deepEqual(r.members.map((m) => m.f(2)), [2, 4, 6]);
  assert.deepEqual(r.labels, ['L = 1', 'L = 2', 'L = 3']);
  // Each member is a full y = f(x) row, with a derivative.
  assert.equal(r.members[1].derivative().f(5), 2);
});

test('two named lists pair up in a family; unnamed lists are numbered', () => {
  const r = last(['a = [1, 2, 3]', 'b = [0, 1, 2]', 'y = a x + b']);
  assert.equal(r.members.length, 3);
  assert.deepEqual(r.members.map((m) => m.f(1)), [1, 3, 5]);
  assert.equal(r.labels[2], 'a = 3, b = 2');
  const u = last(['y = [1, 2] x']);
  assert.deepEqual(u.labels, ['1 of 2', '2 of 2']);
});

test('families of sideways, polar and parametric curves, and of functions', () => {
  const L = 'L = [1, 2]';
  assert.equal(last([L, 'x = L y^2']).of, 'cartesian-x');
  const p = last([L, 'r = L']);
  assert.equal(p.of, 'polar');
  assert.ok(p.members[0].domain);
  const q = last([L, '(L cos(t), sin(t))']);
  assert.equal(q.of, 'parametric');
  assert.equal(q.members[1].fx(0), 2);
  const f = run([L, 'f(x) = L x^2', 'y = f(x)', 'f(3)']);
  assert.equal(f.rows[1].kind, 'family');
  assert.equal(f.rows[2].kind, 'family');
  assert.deepEqual(f.rows[2].members.map((m) => m.f(1)), [1, 2]);
  assert.deepEqual(f.rows[3].values, [9, 18]);
  // A number among curves is a horizontal line.
  const h = last(['y = [x, 2]']);
  assert.equal(h.members[1].f(100), 2);
});

test('more than 50 curves: the first 50, with a warning', () => {
  const r = last(['a = [1...120]', 'y = a x']);
  assert.equal(r.members.length, MAX_CURVES);
  assert.equal(r.total, 120);
  assert.match(r.warning, /first 50 of 120 curves/);
});

test('points from lists', () => {
  const r = last(['L = [1, 2, 3]', '(L, L^2)']);
  assert.equal(r.kind, 'points');
  assert.deepEqual(r.xs, [1, 2, 3]);
  assert.deepEqual(r.ys, [1, 4, 9]);
  const big = last(['L = [1...10000]', '(L, sin(L))']);
  assert.equal(big.xs.length, 10000);
  const s = last(['a = 2', 'L = [1, 2]', '(a L, 1)']);
  assert.deepEqual(s.xs, [2, 4]);
  assert.deepEqual(s.ys, [1, 1]);
});

test('lists used up inside a function still give an ordinary function', () => {
  const a = run(['L = [1, 2, 3]', 'g(x) = sum(L) x', "g'(x)", 'y = g(x)']);
  assert.equal(a.rows[1].kind, 'function');
  assert.equal(a.rows[3].kind, 'cartesian');
  assert.equal(a.rows[3].f(2), 12);
  assert.equal(a.rows[3].derivative().f(0), 6);
  const m = last(['y = mean([x, 2x])']);
  assert.equal(m.kind, 'cartesian');
  assert.equal(m.derivative().text, '3/2');
});

test('rows without lists are untouched', () => {
  const a = run(['y = sin(x)', 'b = 3', 'y = b x^2 + 1', 'max(1, 2)']);
  assert.equal(a.rows[0].kind, 'cartesian');
  assert.equal(a.rows[2].f(2), 13);
  assert.equal(a.rows[3].value, 2);
  for (const r of a.rows) assert.equal(r.warning, undefined);
});

// ---- evaluate (Calc tab) and Solve ---------------------------------------------------------------

test('evaluate gives lists only when asked, with warnings', () => {
  const a = run(['L = [1, 2, 3]']);
  assert.deepEqual(a.evaluate('L^2', undefined, { allowList: true }).list, [1, 4, 9]);
  assert.match(a.evaluate('L').error.message, /gives a list/);
  assert.equal(a.evaluate('sum(L)').value, 6);
  assert.match(a.evaluate('L[7]').warning, /outside the list/);
  const fn = a.compileIn(parse('x + mean(L)').expr, ['x']);
  assert.equal(fn([1]), 3);
  assert.throws(() => a.compileIn(parse('x + L').expr, ['x']), /list can’t be used here/);
});

// ---- display -------------------------------------------------------------------------------------

test('long lists show their first 3 and last 2 elements', () => {
  assert.equal(listText([1, 2, 3]), '[1, 2, 3]');
  assert.equal(listText([1, 4, 9, 16, 25, 36]), '[1, 4, 9, 16, 25, 36]');
  const sq = Array.from({ length: 1000 }, (_, k) => (k + 1) ** 2);
  assert.equal(listText(sq), '[1, 4, 9, …, 998001, 1000000]');
  assert.equal(countText(1000), '1,000 elements');
  assert.equal(countText(1), '1 element');
});

// ---- converting positions between counting from 1 and from 0 --------------------------------

test('positions shift between counting from 1 and from 0, keeping the rest as typed', () => {
  const p = (t) => parse(t, { graph: true });
  const down = (t) => shiftPositions(t, -1, p).text;
  const up = (t) => shiftPositions(t, 1, p).text;
  assert.equal(down('y = L[2] x'), 'y = L[1] x');
  assert.equal(up('L[0]'), 'L[1]');
  assert.equal(down('L[k]'), 'L[k-1]');
  assert.equal(down('L[k + 1]'), 'L[k]');
  assert.equal(up('L[k-1]'), 'L[k]');
  assert.equal(down('L[k + 3]'), 'L[k+2]');
  assert.equal(down('L[2...4]'), 'L[1...3]');
  assert.equal(down('L[[1, 3]]'), 'L[[0, 2]]');
  assert.equal(down('L[M[2]]'), 'L[M[1]-1]');
  assert.equal(down('sum(L[k], k, 1, 3)'), 'sum(L[k-1], k, 1, 3)');
  // Lists themselves aren't positions.
  assert.equal(down('[1, 2, 3]').toString(), '[1, 2, 3]');
  assert.equal(shiftPositions('[1, 2', -1, p).changed, false); // doesn't parse
  assert.equal(shiftPositions('y = x^2', -1, p).changed, false);
});

test('project files record their creator’s setting and are converted when opened', () => {
  const s = defaultState();
  const made = {
    ...s,
    settings: { ...s.settings, listIndex: '0' },
    rows: [newRow(1, '#2f6fed', 'L = [5, 6, 7]'), newRow(2, '#e8590c', 'L[0]'), { ...newRow(3, '#0f9d8a', 'y = x'), atX: 'L[1]' }],
    solve: { ...s.solve, equation: 'x = L[2]' },
    data: { sets: [newDataSet(4, '#c2255c', 'D', [], { fits: [newFit(5, '#7048e8', 'custom', { custom: 'a x + L[0]' })] })], nextId: 6, active: 4 },
  };
  const json = projectJson(made);
  assert.equal(JSON.parse(json).settings.listIndex, '0');
  // Opened on a device counting from 1.
  const r = openProject(defaultState(), json);
  assert.equal(r.shifted, 4);
  assert.equal(r.state.settings.listIndex, '1');
  assert.equal(r.state.rows[1].text, 'L[1]');
  assert.equal(r.state.rows[2].atX, 'L[2]');
  assert.equal(r.state.solve.equation, 'x = L[3]');
  assert.equal(r.state.data.sets[0].fits[0].custom, 'a x + L[1]');
  // The value is the same either way.
  assert.equal(analyse(r.state.rows, r.state.settings).rows[1].value, analyse(made.rows, made.settings).rows[1].value);
  // Opened on a device that also counts from 0: nothing changes.
  const same = openProject({ ...defaultState(), settings: { ...defaultState().settings, listIndex: '0' } }, json);
  assert.equal(same.shifted, 0);
  assert.equal(same.state.rows[1].text, 'L[0]');
  // Old projects (no setting) count from 1.
  const old = JSON.parse(json);
  delete old.settings.listIndex;
  assert.equal(openProject(defaultState(), JSON.stringify(old)).shifted, 0);
  assert.equal(shiftProjectPositions(made, 1).count, 4);
});

test('the setting is saved; long Calc lists keep only their summary', () => {
  const s = defaultState();
  const long = Array.from({ length: MAX_SAVED_LIST + 1 }, (_, k) => k);
  const state = {
    ...s,
    settings: { ...s.settings, listIndex: '0' },
    calc: {
      history: [
        { input: '[1, 2]', output: '[1, 2]', value: null, list: [1, 2], error: false, note: 'a warning' },
        { input: 'L', output: '[0, 1, 2, …]', value: null, list: long, error: false },
      ],
    },
  };
  const back = deserialize(serialize(state));
  assert.equal(back.settings.listIndex, '0');
  assert.deepEqual(back.calc.history[0].list, [1, 2]);
  assert.equal(back.calc.history[0].note, 'a warning');
  assert.equal(back.calc.history[1].list, undefined);
  assert.equal(back.calc.history[1].output, '[0, 1, 2, …]');
  assert.equal(deserialize(serialize(defaultState())).settings.listIndex, '1');
});
