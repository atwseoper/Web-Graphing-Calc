// The visual calculus settings of a y = f(x) row (Phase 6b), worked out once for both
// the analysis panel and the graph. Pure – no DOM access.
//
//   riemannOf  Riemann sum over the row's integral range, with the Gauss–Kronrod value
//   taylorOf   Taylor polynomial of a degree about a point
//   secantOf   secant through x and x + h, with f′(x) for comparison
// Each returns null when the setting is off, or an object with either the result or an
// `error` (a message for the panel) or `need` ('range': set the integral range first).
import { riemann, RIEMANN_MAX_N } from '../numerics/riemann.js';
import { integrate } from '../numerics/integrate.js';
import { taylor, evalTaylor, TAYLOR_MAX_DEGREE } from './taylor.js';

export const DEFAULT_RIEMANN_N = 10;
export const DEFAULT_TAYLOR_DEGREE = 3;
export const DEFAULT_SECANT_H = 1;

// An optional number field: { empty } | { value } | { error }.
function field(analysis, text) {
  if (!text || !text.trim()) return { empty: true };
  const r = analysis.evaluate(text);
  if (r.error) return { error: r.error.message };
  if (!Number.isFinite(r.value)) return { error: 'Must be a finite number' };
  return { value: r.value };
}

function wholeField(analysis, text, def, lo, hi, what) {
  const f = field(analysis, text);
  if (f.empty) return { value: def };
  if (f.error) return f;
  if (!Number.isInteger(f.value) || f.value < lo || f.value > hi) return { error: `${what} must be a whole number from ${lo} to ${hi}` };
  return f;
}

// The panel's x (At x =), or null.
function atX(row, analysis) {
  const f = field(analysis, row.atX);
  return f.value ?? null;
}

export function riemannOf(row, r, analysis) {
  if (!row.riemann) return null;
  const n = wholeField(analysis, row.riemannN, DEFAULT_RIEMANN_N, 1, RIEMANN_MAX_N, 'n');
  if (n.error) return { error: n.error };
  const a = field(analysis, row.intFrom);
  const b = field(analysis, row.intTo);
  if (a.error || b.error) return { error: a.error || b.error };
  if (a.empty || b.empty) return { need: 'range' };
  if (a.value === b.value) return { need: 'range' };
  const res = riemann(r.f, a.value, b.value, n.value, row.riemann);
  return { method: row.riemann, n: n.value, a: a.value, b: b.value, res, exact: integrate(r.f, a.value, b.value) };
}

// Results cached per analysed row, so redraws don't repeat the work.
const taylorCache = new WeakMap(); // r -> Map(key -> result)

export function taylorOf(row, r, analysis) {
  if (!row.taylor) return null;
  const n = wholeField(analysis, row.taylorN, DEFAULT_TAYLOR_DEGREE, 0, TAYLOR_MAX_DEGREE, 'The degree');
  if (n.error) return { error: n.error };
  const at = field(analysis, row.taylorAt);
  if (at.error) return { error: at.error };
  const x0 = at.empty ? (atX(row, analysis) ?? 0) : at.value;
  if (!r.body) return { n: n.value, x0, res: { ok: false, reason: 'complex' }, f: null };
  let byKey = taylorCache.get(r);
  if (!byKey) taylorCache.set(r, byKey = new Map());
  const key = `${x0}|${n.value}`;
  let res = byKey.get(key);
  if (!res) {
    res = taylor(r.body, analysis, x0, n.value);
    byKey.set(key, res);
  }
  const f = res.ok ? (x) => evalTaylor(res.coeffs, x0, x) : null;
  return { n: n.value, x0, res, f, fromAtX: at.empty && atX(row, analysis) !== null };
}

// hOverride: h while the play button shrinks it (not saved).
export function secantOf(row, r, analysis, hOverride = null) {
  if (!row.secant) return null;
  const x0 = atX(row, analysis);
  const hf = field(analysis, row.secantH);
  if (hOverride === null && hf.error) return { error: hf.error };
  const h = hOverride ?? (hf.empty ? DEFAULT_SECANT_H : hf.value);
  if (!(h !== 0 && Number.isFinite(h))) return { error: 'h can\'t be 0' };
  const x = x0 ?? 0;
  const y0 = r.f(x);
  const y1 = r.f(x + h);
  const d = r.derivative ? r.derivative() : null;
  const slope = d ? d.f(x) : NaN;
  return {
    x0: x, h, y0, y1, m: (y1 - y0) / h, slope, fromAtX: x0 !== null,
    ok: Number.isFinite(y0) && Number.isFinite(y1),
  };
}
