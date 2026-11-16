import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, separatorVote, formatCell } from '../src/js/data/number.js';
import {
  parseCsv, splitRecords, detectDelimiter, detectDecimal, defaultColumns, toPoints, columnLetter,
} from '../src/js/data/csv.js';
import {
  newDataSet, fitPoints, summary, dataBounds, toCsv, nameFromFile,
} from '../src/js/data/table.js';

test('parseNumber: decimal points and commas, thousands separators', () => {
  assert.equal(parseNumber('3.14'), 3.14);
  assert.equal(parseNumber('3,14'), 3.14);
  assert.equal(parseNumber('-0,5'), -0.5);
  assert.equal(parseNumber('−2,5'), -2.5); // Unicode minus
  assert.equal(parseNumber('+7'), 7);
  assert.equal(parseNumber('.5'), 0.5);
  assert.equal(parseNumber(',5'), 0.5);
  assert.equal(parseNumber('1.234,5'), 1234.5);
  assert.equal(parseNumber('1,234.5'), 1234.5);
  assert.equal(parseNumber('1,234,567'), 1234567);
  assert.equal(parseNumber('1.234.567'), 1234567);
  assert.equal(parseNumber('1 234,5'), 1234.5);
  assert.equal(parseNumber('1\u00a0234\u00a0567,25'), 1234567.25);
  assert.equal(parseNumber("1'234.5"), 1234.5);
  assert.equal(parseNumber('1,5E-3'), 0.0015);
  assert.equal(parseNumber('6.02e23'), 6.02e23);
  assert.equal(parseNumber('  42  '), 42);
  // blanks and non-numbers
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('   '), null);
  assert.equal(parseNumber(null), null);
  for (const bad of ['n/a', '-', 'abc', '1.2.3,4,5', '1,23,4', '12%', 'e5', '1e', '2 3', '1..2']) {
    assert.ok(Number.isNaN(parseNumber(bad)), bad);
  }
});

test('parseNumber: a fixed decimal separator', () => {
  assert.equal(parseNumber('1,234', 'point'), 1234);
  assert.equal(parseNumber('1,234', 'comma'), 1.234);
  assert.equal(parseNumber('1.234', 'comma'), 1234);
  assert.equal(parseNumber('1.234', 'point'), 1.234);
  assert.ok(Number.isNaN(parseNumber('3,14', 'point')));
  assert.ok(Number.isNaN(parseNumber('3.14', 'comma')));
  assert.equal(parseNumber('1.234,5', 'comma'), 1234.5);
});

test('separatorVote and formatCell', () => {
  assert.equal(separatorVote('3,14'), 'comma');
  assert.equal(separatorVote('3.14'), 'point');
  assert.equal(separatorVote('1,234'), 'either');
  assert.equal(separatorVote('0,123'), 'comma');
  assert.equal(separatorVote('1.234,5'), 'comma');
  assert.equal(separatorVote('42'), null);
  assert.equal(separatorVote('abc'), null);
  assert.equal(formatCell(3.14, 'comma'), '3,14');
  assert.equal(formatCell(-0.5), '-0.5');
  assert.equal(formatCell(1.5e21, 'comma'), '1,5e21');
  assert.equal(formatCell(null), '');
  for (const v of [Math.PI, -1e-12, 123456789.125, 6.02e23]) {
    assert.equal(parseNumber(formatCell(v, 'comma'), 'comma'), v);
    assert.equal(parseNumber(formatCell(v, 'point'), 'point'), v);
  }
});

test('splitRecords: quotes, line breaks inside quotes, CRLF, spaces', () => {
  const r = splitRecords('a,"b, c","say ""hi"""\r\n1, 2 ,"3\n4"\r\n', ',');
  assert.deepEqual(r.map((x) => x.fields), [['a', 'b, c', 'say "hi"'], ['1', '2', '3\n4']]);
  assert.deepEqual(r.map((x) => x.line), [1, 2]);
  const ws = splitRecords('  1   2.5\t3  \n4 5 6', ' ');
  assert.deepEqual(ws.map((x) => x.fields), [['1', '2.5', '3'], ['4', '5', '6']]);
  const cr = splitRecords('1;2\r3;4', ';');
  assert.deepEqual(cr.map((x) => x.fields), [['1', '2'], ['3', '4']]);
  const spaced = splitRecords(' "a" , "b"\n', ',');
  assert.deepEqual(spaced[0].fields, ['a', 'b']);
});

test('detectDelimiter and detectDecimal', () => {
  assert.equal(detectDelimiter('x,y\n1,2\n3,4\n'), ',');
  assert.equal(detectDelimiter('x;y\n1,5;2,25\n3,5;4\n'), ';');
  assert.equal(detectDelimiter('x\ty\n1,5\t2,25\n3,5\t4\n'), '\t');
  assert.equal(detectDelimiter('0.1 0.2\n0.3 0.4\n'), ' ');
  assert.equal(detectDelimiter('a|b\n1|2\n'), '|');
  assert.equal(detectDelimiter('"1,5","2,5"\n"3,5","4"\n'), ',');
  assert.equal(detectDelimiter('5\n6\n7\n'), null);
  assert.equal(detectDecimal(['1,5', '2', '3,25'], ';'), 'comma');
  assert.equal(detectDecimal(['1.5', '2', '3.25'], ','), 'point');
  assert.equal(detectDecimal(['1,234', '2,500'], ';'), 'comma');
  assert.equal(detectDecimal(['1,234', '2,500'], '\t'), 'point');
  assert.equal(detectDecimal(['1.234,5', '2,5'], ';'), 'comma');
});

test('parseCsv: European export with decimal commas and a header', () => {
  const t = parseCsv('\ufeffZeit (s);Weg (m)\r\n0,5;1,25\r\n1,0;4,9\r\n1,5;11,1\r\n');
  assert.equal(t.delimiter, ';');
  assert.equal(t.decimal, 'comma');
  assert.equal(t.header, true);
  assert.deepEqual(t.columns, ['Zeit (s)', 'Weg (m)']);
  assert.deepEqual(t.rows.map((r) => r.values), [[0.5, 1.25], [1, 4.9], [1.5, 11.1]]);
  assert.deepEqual(defaultColumns(t), { x: 0, y: 1, s: -1 });
});

test('parseCsv: comma CSV with quoted decimal commas', () => {
  const t = parseCsv('"x","y"\n"1,5","2,75"\n"3","4,5"\n');
  assert.equal(t.delimiter, ',');
  assert.equal(t.decimal, 'comma');
  assert.deepEqual(t.rows.map((r) => r.values), [[1.5, 2.75], [3, 4.5]]);
});

test('parseCsv: tab-separated paste from a spreadsheet, thousands separators', () => {
  const t = parseCsv('Year\tSales\n2021\t1,234,000\n2022\t1,456,500\n2023\t1,602,250\n');
  assert.equal(t.delimiter, '\t');
  assert.equal(t.decimal, 'point');
  assert.deepEqual(t.rows.map((r) => r.values[1]), [1234000, 1456500, 1602250]);
});

test('parseCsv: comments, preamble, blank lines, no header, overrides', () => {
  const text = 'Exported 2026-11-16 from logger\n# comment\n\n1,2,0.1\n3,4,0.2\n\n5,6,0.3\n';
  const t = parseCsv(text);
  assert.equal(t.header, false);
  assert.equal(t.skipped.preamble, 1);
  assert.equal(t.skipped.comments, 1);
  assert.deepEqual(t.columns, ['Column A', 'Column B', 'Column C']);
  assert.equal(t.rows.length, 3);
  assert.equal(t.rows[2].line, 7);
  assert.match(t.notes[0], /Skipped 1 line/);

  // overriding the decimal separator and header
  const o = parseCsv('a;b\n1,234;2\n', { decimal: 'point', header: false });
  assert.equal(o.header, false);
  assert.deepEqual(o.rows[1].values, [1234, 2]);
  const e = parseCsv('');
  assert.equal(e.rows.length, 0);
  assert.deepEqual(e.notes, ['No data found']);
});

test('defaultColumns: σ columns, single columns, row numbers', () => {
  const t = parseCsv('t,h,err\n0,1,0.1\n1,2,0.1\n');
  assert.deepEqual(defaultColumns(t), { x: 0, y: 1, s: 2 });
  const u = parseCsv('t,h,temp\n0,1,20\n1,2,21\n');
  assert.deepEqual(defaultColumns(u), { x: 0, y: 1, s: -1 });
  const one = parseCsv('3,5\n4,25\n2\n'.replace(/,/g, '.'));
  assert.deepEqual(defaultColumns(one), { x: -1, y: 0, s: -1 });
  assert.equal(columnLetter(0), 'A');
  assert.equal(columnLetter(25), 'Z');
  assert.equal(columnLetter(26), 'AA');
});

test('toPoints: bad cells are reported and kept as blanks (D28)', () => {
  const t = parseCsv('x,y,s\n1,2,0.5\n2,n/a,0.5\n3,4,0\n\n4,5,\n');
  const { points, problems } = toPoints(t, { x: 0, y: 1, s: 2 });
  assert.equal(points.length, 4);
  assert.deepEqual(points[1], { x: 2, y: null, s: 0.5, off: false });
  assert.equal(points[2].s, null);
  assert.equal(problems.length, 2);
  assert.deepEqual(problems[0], { line: 3, point: 2, column: 'y', text: 'n/a' });
  assert.match(problems[1].reason, /greater than 0/);
  // row numbers for x
  const r = toPoints(parseCsv('5\n7\n9\n'), { x: -1, y: 0 });
  assert.deepEqual(r.points.map((p) => [p.x, p.y]), [[1, 5], [2, 7], [3, 9]]);
});

test('data set helpers', () => {
  const set = newDataSet(1, '#2f6fed', 'Test', [
    { x: 1, y: 2, s: 0.1, off: false },
    { x: 2, y: null, s: null, off: false },
    { x: 3, y: 5, s: null, off: false },
    { x: 4, y: 9, s: 0.2, off: true },
    { x: null, y: null, s: null, off: false },
  ], { hasSigma: true, decimal: 'comma', yName: 'h' });
  assert.deepEqual(summary(set), { total: 5, used: 2, off: 1, incomplete: 1, noSigma: 1 });
  assert.deepEqual(fitPoints(set), { x: [1, 3], y: [2, 5], s: null, index: [0, 2] });
  assert.deepEqual(fitPoints(set, { weighted: true }), { x: [1], y: [2], s: [0.1], index: [0] });
  assert.deepEqual(dataBounds([set]), { xMin: 1, xMax: 4, yMin: 1.9, yMax: 9.2 });
  assert.equal(dataBounds([{ ...set, hidden: true }]), null);
  assert.equal(toCsv(set), 'x;h;σh;included\r\n1;2;0,1;yes\r\n2;;;yes\r\n3;5;;yes\r\n4;9;0,2;no\r\n;;;yes\r\n');
  assert.equal(toCsv({ ...set, points: set.points.slice(0, 1) }, { decimal: 'point' }), 'x,h,σh\r\n1,2,0.1\r\n');
  assert.equal(nameFromFile('C:\\data\\pendulum run 2.CSV'), 'pendulum run 2');
});

test('decodeBytes: UTF-8, UTF-16 with BOM, Windows-1252', async () => {
  const { decodeBytes } = await import('../src/js/data/csv.js');
  const utf8 = new TextEncoder().encode('Größe;Wert\n1,5;2\n');
  assert.equal(decodeBytes(utf8), 'Größe;Wert\n1,5;2\n');
  const le = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x3b, 0x00, 0x31, 0x00]);
  assert.equal(decodeBytes(le), 'a;1');
  const be = new Uint8Array([0xfe, 0xff, 0x00, 0x61, 0x00, 0x3b]);
  assert.equal(decodeBytes(be), 'a;');
  const cp1252 = new Uint8Array([0x47, 0x72, 0xf6, 0xdf, 0x65, 0x3b, 0x80]); // "Größe;€"
  assert.equal(decodeBytes(cp1252), 'Größe;€');
});

test('toCsv: tab-separated cells for spreadsheets', () => {
  const set = newDataSet(1, '#000000', 'T', [{ x: 1.5, y: 2, s: null, off: false }], { decimal: 'comma', xName: 'Zeit, s' });
  assert.equal(toCsv(set, { sep: '\t' }), 'Zeit, s\ty\r\n1,5\t2\r\n');
  assert.equal(toCsv(set), '"Zeit, s";y\r\n1,5;2\r\n');
});
