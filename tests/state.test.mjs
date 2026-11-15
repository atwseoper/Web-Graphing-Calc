import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/js/state/store.js';
import { defaultState, nextColor, newRow, PALETTE } from '../src/js/state/defaults.js';
import { serialize, deserialize, load, save, STORAGE_KEY } from '../src/js/state/persist.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

test('store notifies subscribers with new and previous state', () => {
  const store = createStore({ n: 1 });
  const seen = [];
  const off = store.subscribe((s, prev) => seen.push([prev.n, s.n]));
  store.update((s) => ({ n: s.n + 1 }));
  store.update((s) => s); // no change, no notification
  off();
  store.update((s) => ({ n: s.n + 1 }));
  assert.deepEqual(seen, [[1, 2]]);
  assert.equal(store.get().n, 3);
});

test('nextColor picks the least used palette colour', () => {
  assert.equal(nextColor([]), PALETTE[0]);
  assert.equal(nextColor([newRow(1, PALETTE[0]), newRow(2, PALETTE[1])]), PALETTE[2]);
});

test('serialize/deserialize round trip', () => {
  const s = defaultState();
  s.rows[0].hidden = true;
  s.rows[1].text = 'r = θ';
  s.rows[1].domainMax = '4π';
  s.view = { cx: 1, cy: 2, scaleX: 30, scaleY: 60 };
  s.settings.angle = 'deg';
  s.calc.history.push({ input: '1+1', output: '2', value: 2, error: false });
  const back = deserialize(serialize(s));
  assert.deepEqual(back, s);
});

test('deserialize rejects bad data field by field', () => {
  assert.deepEqual(deserialize('not json'), defaultState());
  assert.deepEqual(deserialize(JSON.stringify({ version: 999 })), defaultState());
  const s = deserialize(JSON.stringify({
    version: 1,
    nextId: 2,
    rows: [{ id: 5, text: 'y=x', color: 'red' }, { id: 5, text: 'dup' }, { text: 'no id' }, null],
    view: { cx: 'a', cy: 0, scaleX: 1, scaleY: 1 },
    settings: { angle: 'grad', grid: 'polar' },
    calc: { history: [{ input: '2', output: '2' }, { nope: true }] },
  }));
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].color, PALETTE[0]);
  assert.equal(s.nextId, 6, 'nextId is above every row id');
  assert.equal(s.view, null);
  assert.equal(s.settings.angle, 'rad');
  assert.equal(s.settings.grid, 'polar');
  assert.equal(s.calc.history.length, 1);
});

test('load and save use the storage object and survive failures', () => {
  const storage = memoryStorage();
  assert.deepEqual(load(storage), defaultState());
  const s = defaultState();
  s.rows[0].text = 'y = x^3';
  assert.equal(save(storage, s), true);
  assert.ok(storage.map.has(STORAGE_KEY));
  assert.equal(load(storage).rows[0].text, 'y = x^3');
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  assert.deepEqual(load(broken), defaultState());
  assert.equal(save(broken, s), false);
});
