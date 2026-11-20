// Data sets: helpers for the points of a set. Pure module – no DOM access.
//
// A data set is
//   { id, name, color, hidden, decimal: 'point'|'comma', xName, yName, hasSigma,
//     display: 'scatter'|'histogram'|'box', histColumn: 'x'|'y', binWidth: number|null,
//     points: [{ x, y, s, off }], fits: [...] }
// x, y and s are numbers or null (a blank or unreadable cell). off: left out of fits.
// display (Phase 7b): points, a histogram of one column (binWidth null = automatic) or a
// box plot of that column.
import { formatCell } from './number.js';
import { columnValues, setHistogram } from './summary.js';

export const DISPLAY_MODES = ['scatter', 'histogram', 'box'];

export const MAX_SETS = 20;

export function newDataSet(id, color, name, points = [], extra = {}) {
  return {
    id, name: name || `Data ${id}`, color, hidden: false,
    decimal: 'point', xName: 'x', yName: 'y', hasSigma: false,
    display: 'scatter', histColumn: 'x', binWidth: null,
    points, fits: [],
    ...extra,
  };
}

export const blankPoint = () => ({ x: null, y: null, s: null, off: false });

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// Points that can be plotted (finite x and y), with their index in the set.
export function plottablePoints(set) {
  const out = [];
  set.points.forEach((p, i) => {
    if (finite(p.x) && finite(p.y)) out.push({ ...p, i });
  });
  return out;
}

// The points used in a fit: included, with finite x and y. With weights (σy column in
// use) a point also needs σy > 0. Returns { x, y, s, index } as plain arrays.
export function fitPoints(set, { weighted = false } = {}) {
  const x = [];
  const y = [];
  const s = [];
  const index = [];
  set.points.forEach((p, i) => {
    if (p.off || !finite(p.x) || !finite(p.y)) return;
    if (weighted && !(finite(p.s) && p.s > 0)) return;
    x.push(p.x);
    y.push(p.y);
    s.push(weighted ? p.s : 1);
    index.push(i);
  });
  return { x, y, s: weighted ? s : null, index };
}

export function summary(set) {
  let used = 0;
  let off = 0;
  let incomplete = 0;
  let noSigma = 0;
  for (const p of set.points) {
    if (!finite(p.x) || !finite(p.y)) {
      // A row with something in it but no x or no y (an empty new row doesn't count).
      if (p.x !== null || p.y !== null || p.s !== null) incomplete++;
      continue;
    }
    if (p.off) off++;
    else {
      used++;
      if (set.hasSigma && !(finite(p.s) && p.s > 0)) noSigma++;
    }
  }
  return { total: set.points.length, used, off, incomplete, noSigma };
}

// Range of the plottable points of visible sets: { xMin, xMax, yMin, yMax } or null.
// With σy, the error bars are included.
// Range of the visible data: { xMin, xMax, yMin, yMax } or null. Points include their
// σy error bars; a histogram spans its bins and runs from 0 to its tallest count; a box
// plot spans its column's values and says nothing about y (yMin = Infinity, yMax =
// −Infinity when only box plots are showing). On a log axis (positiveX / positiveY) only
// values above 0 count, and an error bar reaching 0 counts its point only.
export function dataBounds(sets, { positiveX = false, positiveY = false } = {}) {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  const takeX = (v) => {
    if (positiveX && !(v > 0)) return;
    if (v < xMin) xMin = v;
    if (v > xMax) xMax = v;
  };
  for (const set of sets) {
    if (set.hidden) continue;
    if (set.display === 'histogram') {
      const h = setHistogram(set);
      if (!h) continue;
      const { start, width, counts, max } = h.hist;
      takeX(start);
      takeX(start + width * counts.length);
      if (positiveX && !(start > 0)) takeX(width); // edges are multiples of the width: the first one above 0
      const lowest = positiveY ? Math.min(...counts.filter((c) => c > 0)) : 0;
      if (lowest < yMin) yMin = lowest;
      if (max > yMax) yMax = max;
      continue;
    }
    if (set.display === 'box') {
      for (const v of columnValues(set, set.histColumn === 'y' ? 'y' : 'x')) takeX(v);
      continue;
    }
    for (const p of set.points) {
      if (!finite(p.x) || !finite(p.y)) continue;
      if ((positiveX && p.x <= 0) || (positiveY && p.y <= 0)) continue;
      const e = set.hasSigma && finite(p.s) ? Math.abs(p.s) : 0;
      const lo = positiveY && p.y - e <= 0 ? p.y : p.y - e;
      takeX(p.x);
      if (lo < yMin) yMin = lo;
      if (p.y + e > yMax) yMax = p.y + e;
    }
  }
  return xMin <= xMax ? { xMin, xMax, yMin, yMax } : null;
}

// CSV text for a data set. Decimal commas use ';' between fields (as European
// spreadsheets expect); otherwise ','. sep: '\t' gives cells to paste into a spreadsheet.
export function toCsv(set, { decimal = set.decimal || 'point', sep = decimal === 'comma' ? ';' : ',' } = {}) {
  const special = sep === '\t' ? /["\t\n\r]/ : /[",;\n\r]/;
  const quote = (t) => (special.test(t) || /^\s|\s$/.test(t) ? `"${t.replaceAll('"', '""')}"` : t);
  const anyOff = set.points.some((p) => p.off);
  const head = [set.xName || 'x', set.yName || 'y'];
  if (set.hasSigma) head.push(`σ${set.yName || 'y'}`);
  if (anyOff) head.push('included');
  const lines = [head.map(quote).join(sep)];
  for (const p of set.points) {
    const cells = [formatCell(p.x, decimal), formatCell(p.y, decimal)];
    if (set.hasSigma) cells.push(formatCell(p.s, decimal));
    if (anyOff) cells.push(p.off ? 'no' : 'yes');
    lines.push(cells.join(sep));
  }
  return `${lines.join('\r\n')}\r\n`;
}

// A short name for a data set from a file name: "pendulum data.csv" -> "pendulum data".
export function nameFromFile(fileName) {
  const base = String(fileName || '').replace(/^.*[\\/]/, '').replace(/\.(csv|tsv|txt|dat|tab)$/i, '').trim();
  return base.slice(0, 40);
}
