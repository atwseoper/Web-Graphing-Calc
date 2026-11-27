// Summary statistics, histograms and box plots for data sets (Phase 7b). Pure module –
// no DOM access.
//
// Quartiles (Q10): 'ti' (default) is the TI-84's method – the medians of the lower and
// upper halves, leaving out the median itself when n is odd. 'linear' interpolates
// between order statistics at (n − 1)·p, as Excel's QUARTILE.INC and R's default
// (type 7) do. The two agree on the median and often differ on Q1 and Q3.

export const QUARTILE_METHODS = ['ti', 'linear'];
export const QUARTILE_NAMES = { ti: 'TI-84 (halves)', linear: 'Interpolated (Excel, R)' };
export const MAX_BINS = 500;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// The values of one column ('x' or 'y') that statistics use: points not left out, with a
// number in that column (the other column may be blank, so a single column of values
// works). σy plays no part.
export function columnValues(set, col) {
  const out = [];
  for (const p of set.points) if (!p.off && finite(p[col])) out.push(p[col]);
  return out;
}

// A column as a list for expressions, D_1.x (Phase 9a-2, D61): the points not left out
// that have a number in every column that has any numbers, so D_1.x and D_1.y stay
// paired (as in fits) and a single pasted column still works.
export function expressionColumn(set, col) {
  const has = { x: false, y: false };
  for (const p of set.points) {
    if (finite(p.x)) has.x = true;
    if (finite(p.y)) has.y = true;
  }
  const out = [];
  for (const p of set.points) {
    if (p.off || (has.x && !finite(p.x)) || (has.y && !finite(p.y))) continue;
    if (finite(p[col])) out.push(p[col]);
  }
  return out;
}

// The x and y of points not left out that have both.
export function pairs(set) {
  const x = [];
  const y = [];
  for (const p of set.points) {
    if (!p.off && finite(p.x) && finite(p.y)) {
      x.push(p.x);
      y.push(p.y);
    }
  }
  return { x, y };
}

function medianOfSorted(s, lo = 0, hi = s.length) {
  const n = hi - lo;
  if (n <= 0) return NaN;
  const m = lo + Math.floor(n / 2);
  return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Linear interpolation between order statistics at (n − 1)·p.
function interpolated(s, p) {
  const h = (s.length - 1) * p;
  const i = Math.floor(h);
  const f = h - i;
  return i + 1 < s.length ? s[i] + f * (s[i + 1] - s[i]) : s[i];
}

// [Q1, Q3] of sorted values.
export function quartilesOf(sorted, method = 'ti') {
  const n = sorted.length;
  if (n === 0) return [NaN, NaN];
  if (n === 1) return [sorted[0], sorted[0]];
  if (method === 'linear') return [interpolated(sorted, 0.25), interpolated(sorted, 0.75)];
  const half = Math.floor(n / 2);
  return [medianOfSorted(sorted, 0, half), medianOfSorted(sorted, n - half, n)];
}

// Mean and sums of squares by Welford's method (no cancellation for large offsets).
function moments(values) {
  let mean = 0;
  let m2 = 0;
  values.forEach((v, k) => {
    const d = v - mean;
    mean += d / (k + 1);
    m2 += d * (v - mean);
  });
  return { mean, m2 };
}

// One-variable statistics: { n, mean, median, sd (sample), sdPop, min, max, q1, q3,
// iqr, sum }. Empty input gives n = 0 and NaNs.
export function describe(values, method = 'ti') {
  const n = values.length;
  const s = [...values].sort((a, b) => a - b);
  const { mean, m2 } = moments(values);
  const [q1, q3] = quartilesOf(s, method);
  let sum = 0;
  for (const v of values) sum += v;
  return {
    n,
    mean: n ? mean : NaN,
    median: medianOfSorted(s),
    sd: n > 1 ? Math.sqrt(m2 / (n - 1)) : NaN,
    sdPop: n ? Math.sqrt(m2 / n) : NaN,
    min: n ? s[0] : NaN,
    max: n ? s[n - 1] : NaN,
    q1,
    q3,
    iqr: q3 - q1,
    sum: n ? sum : NaN,
  };
}

// Pearson's correlation coefficient r of paired values (NaN for fewer than 2 pairs, or
// when either column doesn't vary).
export function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  let mx = 0;
  let my = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let k = 0; k < n; k++) {
    const dx = xs[k] - mx;
    const dy = ys[k] - my;
    mx += dx / (k + 1);
    my += dy / (k + 1);
    sxx += dx * (xs[k] - mx);
    syy += dy * (ys[k] - my);
    sxy += dx * (ys[k] - my);
  }
  if (!(sxx > 0) || !(syy > 0)) return NaN;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

// The smallest 1, 2 or 5 × 10ⁿ at least v.
function niceUp(v) {
  const e = Math.floor(Math.log10(v));
  const b = 10 ** e;
  for (const m of [1, 2, 5, 10]) if (m * b >= v * (1 - 1e-12)) return m * b;
  return 10 * b;
}

// Automatic bin width: the Freedman–Diaconis rule, 2·IQR·n^(−1/3), or Sturges' rule
// (range / (⌈log₂ n⌉ + 1)) when the IQR is 0 (heavily tied data); rounded up to a nice
// 1, 2 or 5 × 10ⁿ so the bin edges are round numbers. Interpolated quartiles, as the
// rule was designed with. Returns null when the values don't spread at all.
export function autoBinWidth(values) {
  const n = values.length;
  if (n === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const range = s[n - 1] - s[0];
  const [q1, q3] = quartilesOf(s, 'linear');
  let w = 2 * (q3 - q1) / Math.cbrt(n);
  if (!(w > 0)) w = range / (Math.ceil(Math.log2(n)) + 1);
  if (!(w > 0)) return s[0] === 0 ? 1 : niceUp(Math.abs(s[0]) / 10); // all equal: one bin round the value
  w = niceUp(w);
  while (range / w > MAX_BINS) w = niceUp(w * 1.5);
  return w;
}

// Counts in bins [start + k·width, start + (k + 1)·width), edges at whole multiples of
// the width. Returns { start, width, counts, max } or null (no values, a width that
// isn't positive, or more than MAX_BINS bins).
export function histogram(values, width) {
  if (!values.length || !(width > 0) || !Number.isFinite(width)) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const start = Math.floor(min / width + 1e-9) * width;
  const bins = Math.floor((max - start) / width + 1e-9) + 1;
  if (bins > MAX_BINS) return null;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const k = Math.min(bins - 1, Math.max(0, Math.floor((v - start) / width + 1e-9)));
    counts[k]++;
  }
  return { start, width, counts, max: Math.max(...counts) };
}

// A box plot: the quartiles, whiskers to the furthest values within 1.5 × IQR of the
// box (Tukey's fences), and the values beyond them as outliers.
export function boxPlot(values, method = 'ti') {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const [q1, q3] = quartilesOf(s, method);
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr;
  const hiFence = q3 + 1.5 * iqr;
  const inside = s.filter((v) => v >= loFence && v <= hiFence);
  return {
    q1, median: medianOfSorted(s), q3,
    lo: inside.length ? inside[0] : q1,
    hi: inside.length ? inside[inside.length - 1] : q3,
    outliers: s.filter((v) => v < loFence || v > hiFence),
    min: s[0], max: s[s.length - 1], n: s.length,
  };
}

// The histogram a data set shows, from its settings: { column, width, auto, hist } or
// null when it can't be drawn.
export function setHistogram(set) {
  const column = set.histColumn === 'y' ? 'y' : 'x';
  const values = columnValues(set, column);
  const auto = !(set.binWidth > 0);
  const width = auto ? autoBinWidth(values) : set.binWidth;
  const hist = width ? histogram(values, width) : null;
  return hist ? { column, width, auto, hist } : null;
}
