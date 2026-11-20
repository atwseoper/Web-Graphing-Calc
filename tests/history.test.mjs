import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/js/state/store.js';
import { defaultState, newRow } from '../src/js/state/defaults.js';
import { newDataSet } from '../src/js/data/table.js';
import {
  createHistory, undoable, applySnapshot, changeKey,
} from '../src/js/state/history.js';

// A store with history wired up the way main.js does it.
function setup(opts) {
  const store = createStore(defaultState());
  const history = createHistory(opts);
  let clock = 0;
  let applying = false;
  store.subscribe((s, prev) => {
    if (!applying) history.record(prev, s, clock);
  });
  const restore = (snap) => {
    if (!snap) return false;
    applying = true;
    store.update((s) => applySnapshot(s, snap));
    applying = false;
    return true;
  };
  return {
    store,
    history,
    tick: (ms) => { clock += ms; },
    undo: () => restore(history.undo(store.get())),
    redo: () => restore(history.redo(store.get())),
    setText: (id, text) => store.update((s) => ({ ...s, rows: s.rows.map((r) => (r.id === id ? { ...r, text } : r)) })),
    texts: () => store.get().rows.map((r) => r.text),
  };
}

test('typing in one row is a single undo step; a pause starts a new one', () => {
  const t = setup();
  t.setText(2, 'y');
  t.tick(100);
  t.setText(2, 'y=');
  t.tick(100);
  t.setText(2, 'y=x');
  t.tick(2000);
  t.setText(2, 'y=x^2');
  assert.deepEqual(t.texts(), ['y = sin(x)', 'y=x^2']);
  assert.ok(t.undo());
  assert.deepEqual(t.texts(), ['y = sin(x)', 'y=x']);
  assert.ok(t.undo());
  assert.deepEqual(t.texts(), ['y = sin(x)', '']);
  assert.equal(t.undo(), false);
  assert.ok(t.redo());
  assert.ok(t.redo());
  assert.deepEqual(t.texts(), ['y = sin(x)', 'y=x^2']);
  assert.equal(t.redo(), false);
});

test('edits to different rows or fields are separate steps', () => {
  const t = setup();
  t.setText(1, 'y = x');
  t.tick(10);
  t.setText(2, 'y = 2x');
  t.tick(10);
  t.store.update((s) => ({ ...s, rows: s.rows.map((r) => (r.id === 2 ? { ...r, hidden: true } : r)) }));
  t.undo();
  assert.equal(t.store.get().rows[1].hidden, false);
  t.undo();
  assert.deepEqual(t.texts(), ['y = x', '']);
  t.undo();
  assert.deepEqual(t.texts(), ['y = sin(x)', '']);
});

test('adding and deleting rows are undoable; ids are never reused after undo', () => {
  const t = setup();
  t.store.update((s) => ({ ...s, nextId: s.nextId + 1, rows: [...s.rows, newRow(s.nextId, '#000000', 'a = 1')] }));
  const idAfterAdd = t.store.get().nextId;
  t.undo();
  assert.equal(t.store.get().rows.length, 2);
  assert.equal(t.store.get().nextId, idAfterAdd, 'nextId keeps its highest value');
  t.redo();
  assert.equal(t.store.get().rows[2].text, 'a = 1');
});

test('view, tab, keypad and calc history changes are not recorded', () => {
  const t = setup();
  t.store.update((s) => ({ ...s, view: { cx: 1, cy: 2, scaleX: 3, scaleY: 3 } }));
  t.store.update((s) => ({ ...s, ui: { tab: 'calc' } }));
  t.store.update((s) => ({ ...s, settings: { ...s.settings, keypad: 'never' } }));
  t.store.update((s) => ({ ...s, calc: { history: [{ input: '1+1' }] } }));
  assert.equal(t.history.canUndo(), false);
});

test('angle and grid settings undo without touching the keypad setting', () => {
  const t = setup();
  t.store.update((s) => ({ ...s, settings: { ...s.settings, angle: 'deg' } }));
  t.store.update((s) => ({ ...s, settings: { ...s.settings, keypad: 'never' } }));
  t.undo();
  assert.deepEqual(t.store.get().settings, {
    angle: 'rad', grid: 'cartesian', keypad: 'never', pretty: 'on', xAxis: 'linear', yAxis: 'linear',
  });
});

test('axis types are undoable, one step each', () => {
  const t = setup();
  t.store.update((s) => ({ ...s, settings: { ...s.settings, xAxis: 'log' } }));
  t.store.update((s) => ({ ...s, settings: { ...s.settings, yAxis: 'log' } }));
  t.undo();
  assert.equal(t.store.get().settings.xAxis, 'log');
  assert.equal(t.store.get().settings.yAxis, 'linear');
  t.undo();
  assert.equal(t.store.get().settings.xAxis, 'linear');
  t.redo();
  assert.equal(t.store.get().settings.xAxis, 'log');
});

test('a new change clears redo', () => {
  const t = setup();
  t.setText(2, 'a');
  t.undo();
  assert.ok(t.history.canRedo());
  t.setText(1, 'b');
  assert.equal(t.history.canRedo(), false);
});

test('seal() ends merging even within the time window', () => {
  const t = setup();
  t.setText(2, 'a');
  t.history.seal();
  t.setText(2, 'ab');
  t.undo();
  assert.deepEqual(t.texts(), ['y = sin(x)', 'a']);
});

test('the history is capped', () => {
  const t = setup({ limit: 5 });
  for (let i = 0; i < 10; i++) {
    t.setText(2, `y = ${i}`);
    t.tick(5000);
  }
  let n = 0;
  while (t.undo()) n++;
  assert.equal(n, 5);
  assert.deepEqual(t.texts(), ['y = sin(x)', 'y = 4']);
});

test('changeKey groups edits of one data set', () => {
  const s = defaultState();
  const a = { ...s, data: { ...s.data, sets: [newDataSet(1, '#000000', 'A'), newDataSet(2, '#111111', 'B')] } };
  const b = { ...a, data: { ...a.data, sets: [a.data.sets[0], { ...a.data.sets[1], name: 'B2' }] } };
  const c = { ...a, data: { ...a.data, sets: [{ ...a.data.sets[0], name: 'A2' }, { ...a.data.sets[1], name: 'B2' }] } };
  assert.equal(changeKey(undoable(a), undoable(b)), 'set:2');
  assert.equal(changeKey(undoable(a), undoable(c)), null);
  assert.equal(changeKey(undoable(a), undoable({ ...a, data: { ...a.data, active: 2 } })), 'data');
});
