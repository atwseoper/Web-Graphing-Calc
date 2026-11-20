// Summary statistics, histograms and box plots (Phase 7b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  columnValues, pairs, quartilesOf, describe, correlation, autoBinWidth, histogram, boxPlot, setHistogram,
} from '../src/js/data/summary.js';
import { newDataSet, dataBounds } from '../src/js/data/table.js';
import { discreteSum } from '../src/js/numerics/distributions.js';
import { deserialize, serialize } from '../src/js/state/persist.js';
import { defaultState } from '../src/js/state/defaults.js';

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≈ ${b}`);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

test('quartiles: the TI-84 method (halves) and linear interpolation (Excel, R)', () => {
  // TI-84 1-Var Stats: {1…9} → Q1 2.5, Q3 7.5; {1…8} → 2.5, 6.5.
  assert.deepEqual(quartilesOf(range(1, 9), 'ti'), [2.5, 7.5]);
  assert.deepEqual(quartilesOf(range(1, 8), 'ti'), [2.5, 6.5]);
  // R quantile(1:9) → 3, 7; quantile(1:8) → 2.75, 6.25.
  assert.deepEqual(quartilesOf(range(1, 9), 'linear'), [3, 7]);
  assert.deepEqual(quartilesOf(range(1, 8), 'linear'), [2.75, 6.25]);
  assert.deepEqual(quartilesOf([4], 'ti'), [4, 4]);
  assert.ok(quartilesOf([], 'ti').every(Number.isNaN));
});

test('describe: mean, median, both standard deviations, range, quartiles', () => {
  const d = describe([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(d.n, 8);
  assert.equal(d.mean, 5);
  assert.equal(d.median, 4.5);
  assert.equal(d.sdPop, 2);
  close(d.sd, Math.sqrt(32 / 7));
  assert.equal(d.min, 2);
  assert.equal(d.max, 9);
  assert.deepEqual([d.q1, d.q3, d.iqr], [4, 6, 2]);
  assert.equal(d.sum, 40);
  // No cancellation for a large offset.
  close(describe([1e9 + 1, 1e9 + 2, 1e9 + 3]).sd, 1, 1e-9);
  // Unsorted input; one value.
  assert.equal(describe([9, 1, 5]).median, 5);
  const one = describe([3]);
  assert.equal(one.sdPop, 0);
  assert.ok(Number.isNaN(one.sd));
  assert.equal(describe([]).n, 0);
});

test('correlation r', () => {
  close(correlation([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]), Math.sqrt(0.6));
  close(correlation([1, 2, 3], [6, 4, 2]), -1);
  assert.ok(Number.isNaN(correlation([1, 2, 3], [5, 5, 5])));
  assert.ok(Number.isNaN(correlation([1], [2])));
});

test('columns and pairs skip left-out points and blanks', () => {
  const set = newDataSet(1, '#000000', 'S', [
    { x: 1, y: 2, s: null, off: false }, { x: 3, y: null, s: null, off: false },
    { x: 5, y: 6, s: null, off: true }, { x: null, y: 8, s: null, off: false },
  ]);
  assert.deepEqual(columnValues(set, 'x'), [1, 3]);
  assert.deepEqual(columnValues(set, 'y'), [2, 8]);
  assert.deepEqual(pairs(set), { x: [1], y: [2] });
});

test('histograms: bins on multiples of the width, automatic width', () => {
  const h = histogram(range(0, 9), 2);
  assert.deepEqual(h, { start: 0, width: 2, counts: [2, 2, 2, 2, 2], max: 2 });
  // Values on an edge go in the bin that starts there.
  assert.deepEqual(histogram([0.5, 1, 1.5, 3], 1).counts, [1, 2, 0, 1]);
  assert.equal(histogram([-2.5, -1], 1).start, -3);
  assert.equal(histogram([], 1), null);
  assert.equal(histogram([0, 1e6], 1), null, 'too many bins');
  // Freedman–Diaconis, rounded to 1, 2 or 5 × 10ⁿ: 1000 evenly spread values on [0, 1).
  const even = range(0, 999).map((k) => k / 1000);
  const w = autoBinWidth(even);
  assert.equal(w, 0.1); // 2 · 0.5 / 10 = 0.1
  // Ties: IQR 0 falls back to Sturges' rule.
  assert.ok(autoBinWidth([5, 5, 5, 5, 5, 5, 5, 9]) > 0);
  assert.equal(autoBinWidth([3, 3, 3]), 0.5);
  assert.equal(autoBinWidth([]), null);
});

test('box plots: Tukey fences, whiskers and outliers', () => {
  const b = boxPlot([...range(1, 9), 30], 'ti');
  assert.deepEqual([b.q1, b.median, b.q3], [3, 5.5, 8]);
  assert.equal(b.lo, 1);
  assert.equal(b.hi, 9);
  assert.deepEqual(b.outliers, [30]);
  assert.equal(boxPlot([], 'ti'), null);
  const lin = boxPlot([...range(1, 9), 30], 'linear');
  assert.deepEqual([lin.q1, lin.q3], [3.25, 7.75]);
});

test('a data set shown as a histogram or box plot: bounds and saving', () => {
  const pts = range(1, 20).map((k) => ({ x: k, y: k * k, s: null, off: false }));
  const hist = newDataSet(1, '#000000', 'H', pts, { display: 'histogram', binWidth: 5 });
  const h = setHistogram(hist);
  assert.equal(h.width, 5);
  assert.equal(h.auto, false);
  assert.deepEqual(h.hist.counts, [4, 5, 5, 5, 1]);
  assert.deepEqual(dataBounds([hist]), { xMin: 0, xMax: 25, yMin: 0, yMax: 5 });
  const box = newDataSet(2, '#000000', 'B', pts, { display: 'box', histColumn: 'y' });
  const b = dataBounds([box]);
  assert.deepEqual([b.xMin, b.xMax], [1, 400]);
  assert.ok(!(b.yMin <= b.yMax), 'a box plot says nothing about y');
  // Saved and restored with the project; bad values fall back.
  const s = defaultState();
  s.data = { sets: [hist, box], nextId: 3, active: 1 };
  s.settings.quartiles = 'linear';
  const back = deserialize(serialize(s));
  assert.equal(back.data.sets[0].display, 'histogram');
  assert.equal(back.data.sets[0].binWidth, 5);
  assert.equal(back.data.sets[1].histColumn, 'y');
  assert.equal(back.settings.quartiles, 'linear');
  const bad = JSON.parse(serialize(s));
  bad.data.sets[0].display = 'pie';
  bad.data.sets[0].binWidth = -2;
  bad.settings.quartiles = 'tukey';
  const fixed = deserialize(JSON.stringify(bad));
  assert.equal(fixed.data.sets[0].display, 'scatter');
  assert.equal(fixed.data.sets[0].binWidth, null);
  assert.equal(fixed.settings.quartiles, 'ti');
});

test('discreteSum adds a discrete distribution over whole numbers', () => {
  const pdf = (k) => (Number.isInteger(k) && k >= 0 && k <= 3 ? [1, 3, 3, 1][k] / 8 : 0);
  assert.deepEqual(discreteSum(pdf, 0.5, 2.5), { ok: true, value: 0.75, terms: 2, from: 1, to: 2 });
  assert.equal(discreteSum(pdf, -10, 10).value, 1);
  assert.equal(discreteSum(pdf, 2, 1).value, -0.75);
  assert.equal(discreteSum(pdf, 0.2, 0.8).terms, 0);
  assert.equal(discreteSum(pdf, 0, 1e7).ok, false);
});
