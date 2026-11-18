// Draggable points (Phase 6a): which points can be dragged and how, finding slider
// values from a finger position, slider ranges and steps, and one undo step per drag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../src/js/expr/model.js';
import { dragPlan, nearestOnPath, solvePair, pairCondition, MAX_CONDITION } from '../src/js/expr/drag.js';
import { sliderRange, snapToStep, valueText } from '../src/js/expr/slider.js';
import { createHistory } from '../src/js/state/history.js';
import { createStore } from '../src/js/state/store.js';
import { defaultState, newRow } from '../src/js/state/defaults.js';

// The plan for the last row, with the rows before it as definitions.
function planOf(texts) {
  const rows = texts.map((text, i) => ({ id: i + 1, text }));
  const analysis = analyse(rows);
  const r = analysis.rows[rows.length - 1];
  assert.equal(r.kind, 'point', `${texts.at(-1)} is a point`);
  const sliders = new Set(analysis.rows.filter((x) => x.kind === 'variable' && x.slider).map((x) => x.name));
  const plan = dragPlan(r.expr, { isSlider: (n) => sliders.has(n), dependencies: analysis.dependencies });
  return { plan, analysis, r };
}

const SLIDERS = ['a = 1', 'b = 2', 'h = 0', 'k = 0'];

test('points tied to their own sliders move along an axis or freely', () => {
  assert.deepEqual(planOf([...SLIDERS, '(a, 3)']).plan, { kind: 'axis', axis: 0, names: ['a'] });
  assert.deepEqual(planOf([...SLIDERS, '(-1, b)']).plan, { kind: 'axis', axis: 1, names: ['b'] });
  assert.deepEqual(planOf([...SLIDERS, '(h, k)']).plan, { kind: 'solve', names: ['h', 'k'] });
  assert.deepEqual(planOf([...SLIDERS, '(k, h)']).plan, { kind: 'solve', names: ['k', 'h'] });
});

test('points that follow one slider move along their path', () => {
  for (const t of ['(a, 2a)', '(a, a^2)', '(cos(a), sin(a))', '(2a, 3)', '(a, a)']) {
    assert.deepEqual(planOf([...SLIDERS, 'f(x) = x^3', t]).plan, { kind: 'path', names: ['a'] }, t);
  }
  assert.deepEqual(planOf([...SLIDERS, 'f(x) = x^3', '(a, f(a))']).plan, { kind: 'path', names: ['a'] });
});

test('two sliders mixed together are solved for', () => {
  assert.deepEqual(planOf([...SLIDERS, '(a + b, a - b)']).plan, { kind: 'solve', names: ['a', 'b'] });
  assert.deepEqual(planOf([...SLIDERS, '(a b, a/b)']).plan, { kind: 'solve', names: ['a', 'b'] });
});

test('points that can\'t be dragged', () => {
  const none = (texts) => assert.equal(planOf(texts).plan, null, texts.at(-1));
  none(['(1, 2)']);
  none(['c = 2π', '(c, 1)']); // not a slider
  none([...SLIDERS, 'c = 3', '(a + b + c, h + k)']); // c is a slider too: three sliders
  none([...SLIDERS, '(a + b, 3)']); // y fixed: a and b can't both be pinned down
  none([...SLIDERS, 'c = 2a', '(c, a)']); // c moves with a, but wouldn't be re-evaluated
  none([...SLIDERS, 'g(x) = a x', '(a, g(a))']); // g uses a itself
  none([...SLIDERS, 'g(x) = x + a', 'q(x) = g(x)', '(a, q(1))']); // …through another function
  // A function whose parameter has a slider's name is fine.
  assert.deepEqual(planOf([...SLIDERS, 'g(a) = a^2', '(a, g(a))']).plan, { kind: 'path', names: ['a'] });
});

test('dependencies follow definitions and leave out parameters', () => {
  const a = analyse(['a = 1', 'c = 2a', 'd = c + 1', 'g(x) = x d', 'h(a) = a + 1'].map((text, i) => ({ id: i, text })));
  assert.deepEqual([...a.dependencies('d')].sort(), ['a', 'c']);
  assert.deepEqual([...a.dependencies('g')].sort(), ['a', 'c', 'd']);
  assert.deepEqual([...a.dependencies('h')], []);
  assert.equal(a.dependencies('nope'), null);
});

const SCALE = [40, 40];

test('nearestOnPath finds the closest place along the path', () => {
  const parabola = (v) => [v, v * v];
  const v = nearestOnPath(parabola, -10, 10, [2, 4.2], SCALE);
  // Foot of the normal from (2, 4.2): 2(v − 2) + 4v(v² − 4.2) = 0 at v ≈ 2.04661.
  assert.ok(Math.abs(v - 2.04661) < 1e-4, `got ${v}`);
  // Off the end of the range: the end.
  assert.equal(nearestOnPath(parabola, -1, 1, [5, 25], SCALE), 1);
  // Undefined parts are skipped.
  const half = (v) => (v < 0 ? null : [v, Math.sqrt(v)]);
  assert.ok(Math.abs(nearestOnPath(half, -4, 4, [-3, 0], SCALE)) < 1e-6);
  assert.equal(nearestOnPath(() => null, 0, 1, [0, 0], SCALE), null);
});

test('nearestOnPath stays on the nearby branch where a path crosses itself', () => {
  // A figure of eight crosses itself at the origin, at v = 0 and v = π.
  const eight = (v) => [Math.sin(v), Math.sin(2 * v)];
  const fromStart = nearestOnPath(eight, 0, 2 * Math.PI, [0.001, 0], [100, 100], { near: 0.05 });
  assert.ok(Math.abs(fromStart) < 0.01, `stays near 0, got ${fromStart}`);
  const fromMid = nearestOnPath(eight, 0, 2 * Math.PI, [-0.001, 0], [100, 100], { near: Math.PI - 0.05 });
  assert.ok(Math.abs(fromMid - Math.PI) < 0.01, `stays near π, got ${fromMid}`);
});

test('solvePair finds two sliders for a target', () => {
  const p = (a, b) => [a + b, a - b];
  const [a, b] = solvePair(p, [1, 2], [5, 1], SCALE);
  assert.ok(Math.abs(a - 3) < 1e-6 && Math.abs(b - 2) < 1e-6, `${a}, ${b}`);
  // Non-linear: (a·b, a/b) = (6, 1.5) → a = 3, b = 2.
  const q = (u, v) => [u * v, u / v];
  const [u, v] = solvePair(q, [2.5, 2.2], [6, 1.5], SCALE);
  assert.ok(Math.abs(u - 3) < 1e-6 && Math.abs(v - 2) < 1e-6, `${u}, ${v}`);
  // Out of reach ((a², b²) can't be negative): as close as it can get, or nothing.
  const sq = (s, t) => [s * s, t * t];
  const r = solvePair(sq, [1, 1], [-1, 4], SCALE);
  assert.ok(r === null || sq(...r)[0] >= 0);
  // Singular everywhere: (a + b, 2a + 2b).
  assert.equal(solvePair((s, t) => [s + t, 2 * s + 2 * t], [0, 0], [1, 3], SCALE), null);
});

test('pairCondition tells free points from stuck ones', () => {
  assert.ok(pairCondition((a, b) => [a, b], 0, 0, SCALE) < 1.0001);
  assert.ok(pairCondition((a, b) => [a + b, a - b], 0, 0, SCALE) < 1.0001);
  assert.ok(pairCondition((a, b) => [a + b, 2 * a + 2 * b], 1, 1, SCALE) > MAX_CONDITION);
  // (a·b, a·b²) is stuck at a = 0, where neither slider moves it sideways.
  assert.ok(pairCondition((a, b) => [a * b, a * b * b], 0, 1, SCALE) > MAX_CONDITION);
});

test('slider ranges match the list (D19, D39)', () => {
  assert.deepEqual(sliderRange(3), { lo: -10, hi: 10, step: 0.1, autoStep: 0.1, userStepOk: false, defLo: -10, defHi: 10 });
  const wide = sliderRange(23.4);
  assert.equal(wide.hi, 24);
  assert.equal(wide.lo, -10);
  assert.equal(sliderRange(0, { min: 0, max: 1 }).step, 0.005);
  assert.equal(sliderRange(0, { min: 0, max: 1, step: 0.25 }).step, 0.25);
  assert.equal(sliderRange(0, { min: 0, max: 1, step: 5 }).step, 0.005); // step bigger than the range
  assert.equal(sliderRange(0, { min: 5, max: 2 }).hi, 6);
});

test('snapToStep rounds to the step without floating-point dust', () => {
  assert.equal(snapToStep(0.3000000004, -10, 0.1), 0.3);
  assert.equal(snapToStep(0.37, 0, 0.25), 0.25);
  assert.equal(snapToStep(0.38, 0, 0.25), 0.5);
  assert.equal(snapToStep(1.2345, 0.5, 0.2), 1.3);
  assert.equal(snapToStep(-7.77, -10, 0.1), -7.8);
  assert.equal(snapToStep(123456, 0, 1000), 123000);
});

test('valueText never uses exponent notation', () => {
  assert.equal(valueText(0.0000001), '0.0000001');
  assert.equal(valueText(-2.5), '-2.5');
  assert.equal(valueText(3), '3');
  assert.equal(valueText(-0), '0');
  assert.equal(valueText(1e20), '1000000000000000');
  assert.equal(valueText(0.1 + 0.2), '0.3');
});

test('a whole drag is one undo step, however many sliders it changes', () => {
  const store = createStore({ ...defaultState(), rows: [newRow(1, '#000', 'a = 1'), newRow(2, '#000', 'b = 1'), newRow(3, '#000', '(a, b)')] });
  const history = createHistory();
  let clock = 0;
  store.subscribe((s, prev) => history.record(prev, s, clock));
  const set = (a, b, extra = {}) => store.update((s) => ({
    ...s,
    rows: s.rows.map((r) => (r.id === 1 ? { ...r, text: `a = ${a}`, ...extra } : r.id === 2 ? { ...r, text: `b = ${b}` } : r)),
  }));
  set(5, 5); // an earlier change of the same kind, just before the drag
  history.beginGroup();
  for (let k = 0; k < 10; k++) {
    clock += 2000; // slower than the coalescing window
    set(k, -k, k === 5 ? { sliderMax: '12' } : {});
  }
  history.endGroup();
  const snap = history.undo(store.get());
  assert.equal(snap.rows[0].text, 'a = 5');
  assert.equal(snap.rows[1].text, 'b = 5');
  assert.equal(snap.rows[0].sliderMax, '');
  assert.equal(history.canUndo(), true); // the change before the drag is its own step
  // After the group, changes merge as usual again.
  history.redo(store.get());
});
