// Functions of a whole list (Phase 9a): length, sum, product, mean, median and standard
// deviations. They take the elements as separate arguments, so the compiler can call
// them like any variadic built-in. Pure module.

export function listLength(...a) {
  return a.length;
}

export function listSum(...a) {
  let s = 0;
  for (const v of a) s += v;
  return s;
}

export function listProd(...a) {
  let p = 1;
  for (const v of a) p *= v;
  return p;
}

export function listMean(...a) {
  return a.length ? listSum(...a) / a.length : NaN;
}

export function listMedian(...a) {
  if (!a.length || a.some(Number.isNaN)) return NaN;
  const s = [...a].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Sample standard deviation (n − 1), as on the summary card's "s" and Desmos's stdev;
// population (n) for stdevp.
function spread(a, sample) {
  const n = a.length;
  if (n < (sample ? 2 : 1)) return NaN;
  const mean = listMean(...a);
  let ss = 0;
  for (const v of a) ss += (v - mean) * (v - mean);
  return Math.sqrt(ss / (sample ? n - 1 : n));
}

export function listStdev(...a) {
  return spread(a, true);
}

export function listStdevp(...a) {
  return spread(a, false);
}
