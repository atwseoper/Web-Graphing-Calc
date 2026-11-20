import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newRow, newFit } from '../src/js/state/defaults.js';
import { newDataSet } from '../src/js/data/table.js';
import {
  projectJson, openProject, encodeShare, decodeShare, shareLink, shareValueFromHash,
  bytesToBase64url, base64urlToBytes, MAX_LINK_CHARS, projectSummary,
} from '../src/js/state/share.js';

function sample() {
  const s = defaultState();
  const points = Array.from({ length: 40 }, (_, i) => ({ x: i, y: 2 * i + Math.sin(i), s: 0.5, off: i === 3 }));
  return {
    ...s,
    nextId: 20,
    rows: [newRow(1, '#2f6fed', 'y = a sin(x)'), newRow(2, '#e8590c', 'a = 2.5')],
    view: { cx: 1, cy: -2, scaleX: 40, scaleY: 40 },
    settings: { angle: 'deg', grid: 'polar', keypad: 'always' },
    calc: { history: [{ input: '1+1', output: '2', value: 2, error: false }] },
    solve: { ...s.solve, equation: 'x^2 = 2' },
    data: { sets: [newDataSet(10, '#0f9d8a', 'Pendulum', points, { hasSigma: true, fits: [newFit(11, '#c2255c', 'exp')] })], nextId: 12, active: 10 },
  };
}

test('base64url round-trips arbitrary bytes', () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 7919) % 256);
  const text = bytesToBase64url(bytes);
  assert.match(text, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(base64urlToBytes(text), bytes);
  assert.throws(() => base64urlToBytes('not base64!'));
});

test('share values round-trip, compressed and plain', async () => {
  const json = projectJson(sample());
  for (const compress of [true, false]) {
    const v = await encodeShare(json, { compress });
    assert.equal(v[0], compress ? 'z' : 'j');
    assert.equal(await decodeShare(v), json);
  }
  const z = await encodeShare(json, { compress: true });
  const j = await encodeShare(json, { compress: false });
  assert.ok(z.length < j.length / 2, 'compression helps');
});

test('a damaged link is rejected', async () => {
  const v = await encodeShare(projectJson(sample()));
  await assert.rejects(decodeShare(v.slice(0, 40)));
  await assert.rejects(decodeShare('q1234'));
});

test('a project carries rows, view, data and fits but not Calc history or the keypad setting', () => {
  const p = JSON.parse(projectJson(sample()));
  assert.equal(p.app, 'web-graphing-calc');
  assert.equal(p.rows.length, 2);
  assert.equal(p.data.sets[0].points.length, 40);
  assert.equal(p.data.sets[0].fits[0].model, 'exp');
  assert.deepEqual(p.settings, { angle: 'deg', grid: 'polar' });
  assert.equal(p.calc, undefined);
});

test('opening a project keeps the user’s own keypad setting and Calc history', () => {
  const current = { ...defaultState(), nextId: 50, settings: { angle: 'rad', grid: 'cartesian', keypad: 'never' }, calc: { history: [{ input: '9', output: '9', value: 9, error: false }] } };
  const { state, error } = openProject(current, projectJson(sample()));
  assert.equal(error, undefined);
  assert.equal(state.rows[0].text, 'y = a sin(x)');
  assert.deepEqual(state.settings, {
    angle: 'deg', grid: 'polar', keypad: 'never', xAxis: 'linear', yAxis: 'linear', quartiles: 'ti',
  });
  assert.equal(state.calc.history[0].input, '9');
  assert.equal(state.nextId, 50);
  assert.equal(state.data.sets[0].points[3].off, true);
  assert.deepEqual(state.view, { cx: 1, cy: -2, scaleX: 40, scaleY: 40, logX: false, logY: false });
});

test('projects carry the axis types and a log view', () => {
  const s = sample();
  s.settings = { ...s.settings, xAxis: 'log', yAxis: 'log' };
  s.view = { cx: 2, cy: -1, scaleX: 90, scaleY: 120, logX: true, logY: true };
  const { state } = openProject(defaultState(), projectJson(s));
  assert.equal(state.settings.xAxis, 'log');
  assert.equal(state.settings.yAxis, 'log');
  assert.deepEqual(state.view, s.view);
});

test('opening something that is not a project gives a clear error', () => {
  const cur = defaultState();
  assert.match(openProject(cur, 'x,y\n1,2').error, /isn’t a graph project/);
  assert.match(openProject(cur, '{"a":1}').error, /isn’t a graph project/);
  assert.match(openProject(cur, JSON.stringify({ version: 99, rows: [] })).error, /newer version/);
});

test('share links: building, length limit and reading the hash', async () => {
  const { url, tooLong } = await shareLink(sample(), 'https://example.org/app/#old');
  assert.ok(url.startsWith('https://example.org/app/#g=z'));
  assert.equal(tooLong, false);
  const value = shareValueFromHash(new URL(url).hash);
  const { state } = openProject(defaultState(), await decodeShare(value));
  assert.equal(state.rows[1].text, 'a = 2.5');

  // Random data doesn't compress: a big data set makes the link too long.
  const big = sample();
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  big.data.sets[0].points = Array.from({ length: 2000 }, () => ({ x: rnd(), y: rnd(), s: null, off: false }));
  const r = await shareLink(big, 'https://example.org/');
  assert.ok(r.length > MAX_LINK_CHARS);
  assert.equal(r.tooLong, true);

  assert.equal(shareValueFromHash('#g=zAbc_-1'), 'zAbc_-1');
  assert.equal(shareValueFromHash('#x=1&g=jQQ'), 'jQQ');
  assert.equal(shareValueFromHash('#nothing'), null);
  assert.equal(shareValueFromHash(''), null);
});

// ---- summary for the shared-project dialog (D47) ----------------------------------------------
function withRows(texts, extra = {}) {
  const s = defaultState();
  return { ...s, rows: texts.map((t, i) => newRow(i + 1, '#2f6fed', t)), ...extra };
}

test('summary counts graphs, points and other rows by kind', () => {
  const rows = [
    'y = x^2', 'x^2', 'x = y^2', 'r = 1 + cos(θ)', '(cos(t), sin(t))', 'x^2 + y^2 = 9', 'y < x', '0 < y < x',
    "y' = x - y", 'dy/dx = y', 'f(x) = x^3', 'sin(θ)', // 12 graphs
    '(2, 3)', '(a, 2a)', // 2 points
    'a = 2', 'g(u, v) = u v', '3 + 4', 'f(2)', 'y = = 2', // 5 other rows (incl. an error)
    '', '   ', // empty rows don't count
  ];
  assert.equal(projectSummary(withRows(rows)), '12 graphs, 2 points and 5 other rows');
  assert.equal(projectSummary(withRows(['y = x'])), '1 graph');
  assert.equal(projectSummary(withRows(['a = 1', 'b = 2'])), '2 rows');
  assert.equal(projectSummary(withRows(['(1, 2)', 'a = 1'])), '1 point and 1 other row');
});

test('summary lists data sets, fits and Solve inputs', () => {
  const s = sample();
  assert.equal(projectSummary(s), '1 graph, 1 other row, 1 data set with 1 fit and Solve inputs');
  const two = { ...s, rows: [], solve: defaultState().solve, data: { ...s.data, sets: [s.data.sets[0], { ...s.data.sets[0], id: 30, fits: [] }] } };
  assert.equal(projectSummary(two), '2 data sets with 1 fit');
  const noFits = { ...two, data: { ...two.data, sets: [{ ...s.data.sets[0], fits: [] }] } };
  assert.equal(projectSummary(noFits), '1 data set');
  assert.equal(projectSummary(withRows([])), 'nothing (an empty project)');
  const solveOnly = withRows([], { solve: { ...defaultState().solve, system: ['', 'x + y = 2'] } });
  assert.equal(projectSummary(solveOnly), 'Solve inputs only');
  const given = withRows([], { solve: { ...defaultState().solve, given: { a: '  ' } } });
  assert.equal(projectSummary(given), 'nothing (an empty project)');
});

test('summary never contains text from the project', async () => {
  const s = sample();
  const evil = 'Visit evil.example NOW';
  const state = {
    ...s,
    rows: [newRow(1, '#2f6fed', evil), newRow(2, '#e8590c', `y = x {${evil}}`)],
    solve: { ...s.solve, equation: evil },
    data: { ...s.data, sets: [{ ...s.data.sets[0], name: evil }] },
  };
  // Through a real link, as the page sees it.
  const json = await decodeShare((await shareLink(state, 'https://x/#')).url.split('#g=')[1]);
  const text = projectSummary(openProject(defaultState(), json).state);
  assert.doesNotMatch(text, /evil|visit|now/i);
  assert.match(text, /^[\w ,()]+$/);
});
