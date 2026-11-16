// Non-linear least squares by Levenberg–Marquardt (D6). Pure module – no DOM access.
//
// Minimises Σ ((yᵢ − f(xᵢ; p)) / σᵢ)². Each step solves
//     min ‖J·δ − r‖² + λ‖D·δ‖²
// by QR of the augmented matrix [J; √λ·D] (more accurate than the normal equations),
// with Marquardt's scaling D = diag of the largest column norms of J seen so far and
// Nielsen's rule for updating λ. J comes from the symbolic derivatives of the model
// (or finite differences when a derivative isn't available).
//
// Starting values: those the user typed, else guesses from linearised fits for the
// built-in models (log-linear for exponential and power, a logit for logistic, a
// periodogram for sinusoidal, the peak for Gaussian), else 1. Several starts are tried
// (D6) within a time budget, and the fit with the smallest residual sum of squares wins.
import { leastSquares } from '../numerics/qr.js';
import { parseNumber } from '../data/number.js';

const MAX_ITER = 20000;
const TIME_BUDGET_MS = 400;
const fail = (message) => ({ error: { message, start: -1, end: -1 } });

export function fitNonlinear(model, x, y, sig, options = {}) {
  const p = model.params.length;
  const n = x.length;
  const now = options.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const deadline = now() + (options.budget ?? TIME_BUDGET_MS);
  const fit = options.fit || {};

  // ---- residuals and Jacobian ------------------------------------------------------------
  const frame = new Float64Array(p + 1);
  const setParams = (q) => { for (let k = 0; k < p; k++) frame[k + 1] = q[k]; };
  const evalAt = (q, xi) => {
    setParams(q);
    frame[0] = xi;
    return model.f(frame);
  };
  // r = (y − f)/σ; returns rss (Infinity if anything isn't finite)
  function residuals(q, r) {
    setParams(q);
    let s = 0;
    for (let i = 0; i < n; i++) {
      frame[0] = x[i];
      const v = (y[i] - model.f(frame)) / sig[i];
      if (!Number.isFinite(v)) return Infinity;
      r[i] = v;
      s += v * v;
    }
    return s;
  }
  // Columns of J: ∂f/∂pⱼ / σ. False if anything isn't finite.
  function jacobian(q, J, r) {
    if (model.grads) {
      setParams(q);
      for (let i = 0; i < n; i++) {
        frame[0] = x[i];
        for (let k = 0; k < p; k++) {
          const v = model.grads[k](frame) / sig[i];
          if (!Number.isFinite(v)) return false;
          J[k][i] = v;
        }
      }
      return true;
    }
    // Forward differences.
    const q2 = Array.from(q);
    const r2 = new Float64Array(n);
    for (let k = 0; k < p; k++) {
      const hk = 1.5e-8 * Math.max(Math.abs(q[k]), 1e-4);
      q2[k] = q[k] + hk;
      if (!Number.isFinite(residuals(q2, r2))) return false;
      for (let i = 0; i < n; i++) J[k][i] = (r[i] - r2[i]) / hk; // r = (y − f)/σ, so −∂r/∂p
      q2[k] = q[k];
    }
    residuals(q, r); // restore r (residuals() was called with other parameters)
    return true;
  }

  // ---- one Levenberg–Marquardt run ----------------------------------------------------------
  function lm(start, maxIter) {
    let q = Float64Array.from(start);
    const r = new Float64Array(n);
    const J = Array.from({ length: p }, () => new Float64Array(n));
    let rss = residuals(q, r);
    if (!Number.isFinite(rss)) return null;
    const D = new Float64Array(p);
    let lambda = 1e-3;
    let nu = 2;
    let iter = 0;
    let converged = false;
    let needJ = true;
    const qTrial = new Float64Array(p);
    const rTrial = new Float64Array(n);
    while (iter < maxIter) {
      if (now() > deadline && iter > 20) break;
      iter++;
      if (needJ) {
        if (!jacobian(q, J, r)) return { q, rss, iterations: iter, converged: false, broken: true };
        for (let k = 0; k < p; k++) {
          let s = 0;
          for (let i = 0; i < n; i++) s += J[k][i] * J[k][i];
          D[k] = Math.max(D[k], Math.sqrt(s));
        }
        needJ = false;
        // Gradient test: ‖Jᵀr‖ small relative to ‖J‖·‖r‖.
        let g = 0;
        const rn = Math.sqrt(rss);
        for (let k = 0; k < p; k++) {
          let s = 0;
          for (let i = 0; i < n; i++) s += J[k][i] * r[i];
          if (D[k] > 0) g = Math.max(g, Math.abs(s) / (D[k] * (rn || 1)));
        }
        if (g < 1e-12 || rss === 0) {
          converged = true;
          break;
        }
      }
      // Step: [J; √λ·D] δ ≈ [r; 0]
      const sl = Math.sqrt(lambda);
      const cols = J.map((col, k) => {
        const c = new Float64Array(n + p);
        c.set(col);
        c[n + k] = sl * (D[k] || 1);
        return c;
      });
      const b = new Float64Array(n + p);
      b.set(r);
      const step = leastSquares(cols, b, { rcond: 1e-15 });
      if (!step.x) {
        lambda *= nu;
        nu *= 2;
        continue;
      }
      const delta = step.x;
      // Predicted reduction of the sum of squares: ‖r‖² − ‖r − Jδ‖².
      let pred = 0;
      for (let i = 0; i < n; i++) {
        let jd = 0;
        for (let k = 0; k < p; k++) jd += J[k][i] * delta[k];
        pred += 2 * r[i] * jd - jd * jd;
      }
      for (let k = 0; k < p; k++) qTrial[k] = q[k] + delta[k];
      const rssTrial = residuals(qTrial, rTrial);
      const rho = Number.isFinite(rssTrial) && pred > 0 ? (rss - rssTrial) / pred : -1;
      let small = true;
      for (let k = 0; k < p; k++) {
        if (Math.abs(delta[k]) > 1e-12 * (Math.abs(q[k]) + 1e-12)) small = false;
      }
      if (rho > 0) {
        const drop = (rss - rssTrial) / (rss || 1);
        q = Float64Array.from(qTrial);
        r.set(rTrial);
        rss = rssTrial;
        lambda *= Math.max(1 / 3, 1 - (2 * rho - 1) ** 3);
        nu = 2;
        needJ = true;
        if (small || drop < 1e-15 || rss === 0) {
          converged = true;
          break;
        }
      } else {
        if (small) {
          converged = true; // no smaller step makes progress: at a minimum
          break;
        }
        lambda *= nu;
        nu *= 2;
        if (lambda > 1e30) {
          converged = true;
          break;
        }
      }
    }
    return { q, rss, iterations: iter, converged };
  }

  // ---- starting values ------------------------------------------------------------------------
  const typed = typedStarts(model, fit);
  const primary = options.primary || primaryStart(model, fit, x, y, options.angle);
  // Other starts around the first: built-in models have good guesses, so stay close
  // (within a factor of about 3); custom models get a wide spread (factors up to 100 and
  // sign changes), half of them keeping any values the user typed.
  const starts = [primary];
  const rand = lcg(12345);
  const preset = fit.model !== 'custom';
  const extra = preset ? 4 : 24;
  for (let s = 0; s < extra; s++) {
    const keepTyped = !preset && s % 2 === 0 && typed.some((v) => v !== null);
    starts.push(primary.map((v, k) => {
      if (keepTyped && typed[k] !== null) return v;
      const scale = 10 ** ((rand() * 2 - 1) * (preset ? 0.5 : 2));
      const sign = !preset && rand() < 0.25 ? -1 : 1;
      return (v === 0 ? 0.1 : v) * scale * sign;
    }));
  }

  // Run from the primary start, then the others (cheapest first) while time allows.
  const r0 = new Float64Array(n);
  const ranked = starts.map((s, i) => ({ s, i, rss: residuals(s, r0) }))
    .filter((c) => Number.isFinite(c.rss))
    .sort((a, b) => (a.i === 0 ? -1 : b.i === 0 ? 1 : a.rss - b.rss));
  if (!ranked.length) {
    return fail('The model can\'t be evaluated at every point with these starting values. Try other starting values (in Details), or check the model');
  }
  let best = null;
  let tried = 0;
  let agree = 0;
  let totalIter = 0;
  for (const c of ranked) {
    if (tried > 0 && now() > deadline) break;
    const res = lm(c.s, MAX_ITER);
    tried++;
    if (!res) continue;
    totalIter += res.iterations;
    if (best && res.converged && Math.abs(res.rss - best.rss) <= 1e-9 * best.rss) agree++;
    if (!best || res.rss < best.rss * (1 - 1e-12) || (!best.converged && res.converged && res.rss <= best.rss * (1 + 1e-9))) best = res;
    // Enough: three starts of a built-in model, or several starts of a custom model
    // that keep finding the same minimum.
    if (best.converged && ((preset && tried >= 3) || agree >= 3)) break;
  }
  if (!best) return fail('The fit could not get started. Try other starting values (in Details)');

  // ---- covariance at the solution ------------------------------------------------------------
  const q = best.q;
  const r = new Float64Array(n);
  const rss = residuals(q, r);
  const J = Array.from({ length: p }, () => new Float64Array(n));
  if (!jacobian(q, J, r)) return fail('The model can\'t be differentiated at the fitted values');
  const cov = leastSquares(J, r);
  if (!cov.cov) {
    const names = (cov.dependent || []).map((k) => model.params[k]);
    return fail(`The data can't tell all the parameters apart${names.length ? ` (${names.join(', ')})` : ''}. Check the model, or try other starting values`);
  }
  const values = Array.from(q);
  const notes = [];
  if (!best.converged) {
    notes.push(`The fit stopped after ${best.iterations} iterations without fully converging, so it may not be the best fit. Try other starting values (in Details).`);
  }
  const fx = (t) => evalAt(values, t);
  const g = new Float64Array(p);
  const gradVar = (t, factor) => {
    setParams(values);
    frame[0] = t;
    if (model.grads) {
      for (let k = 0; k < p; k++) g[k] = model.grads[k](frame);
    } else {
      const f0 = model.f(frame);
      for (let k = 0; k < p; k++) {
        const hk = 1.5e-8 * Math.max(Math.abs(values[k]), 1e-4);
        frame[k + 1] = values[k] + hk;
        g[k] = (model.f(frame) - f0) / hk;
        frame[k + 1] = values[k];
      }
    }
    let s = 0;
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) s += g[i] * cov.cov[i][j] * g[j];
    return s * factor;
  };
  return {
    method: `Levenberg–Marquardt${model.numericJacobian ? ' (numerical derivatives)' : ''}${tried > 1 ? `, best of ${tried} starts` : ''}`,
    values, covUnscaled: cov.cov, rss, converged: best.converged, iterations: totalIter,
    yhat: x.map(fx), f: fx, gradVar, notes,
  };
}

// Starting values the user typed (null where left blank or unreadable).
function typedStarts(model, fit) {
  return model.params.map((name) => {
    const t = fit.start && fit.start[name];
    if (!t || !t.trim()) return null;
    const v = parseNumber(t);
    return Number.isFinite(v) ? v : null;
  });
}

// The first starting point: typed values, else guesses for built-in models, else 1.
export function primaryStart(model, fit, x, y, angle) {
  const typed = typedStarts(model, fit);
  const guess = guessStart(fit.model, x, y, angle) || model.params.map(() => 1);
  return model.params.map((_, k) => (typed[k] !== null ? typed[k] : guess[k]));
}

// Small deterministic random numbers, so a fit gives the same answer every time.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---- starting guesses for the built-in models ----------------------------------------------------

// Straight-line least squares of v on u: { a, b } with v ≈ a + b·u.
function line(u, v, w) {
  let sw = 0;
  let su = 0;
  let sv = 0;
  for (let i = 0; i < u.length; i++) {
    const wi = w ? w[i] : 1;
    sw += wi;
    su += wi * u[i];
    sv += wi * v[i];
  }
  const mu = su / sw;
  const mv = sv / sw;
  let suu = 0;
  let suv = 0;
  for (let i = 0; i < u.length; i++) {
    const wi = w ? w[i] : 1;
    suu += wi * (u[i] - mu) ** 2;
    suv += wi * (u[i] - mu) * (v[i] - mv);
  }
  const b = suu > 0 ? suv / suu : 0;
  return { a: mv - b * mu, b };
}

const finiteAll = (arr) => arr.every(Number.isFinite);

export function guessStart(model, x, y, angle = 'rad') {
  const n = x.length;
  if (!n) return null;
  const sign = y.reduce((s, v) => s + v, 0) >= 0 ? 1 : -1;
  const xMin = Math.min(...x);
  const xMax = Math.max(...x);
  const span = xMax - xMin || 1;
  switch (model) {
    case 'exp': {
      // ln|y| = ln|a| + b·x, weighted by y² (as the direct fit would weight them)
      const idx = y.map((v, i) => i).filter((i) => y[i] * sign > 0);
      if (idx.length < 2) return [sign, 0];
      const l = line(idx.map((i) => x[i]), idx.map((i) => Math.log(sign * y[i])), idx.map((i) => y[i] * y[i]));
      const out = [sign * Math.exp(l.a), l.b];
      return finiteAll(out) ? out : [sign, 0];
    }
    case 'power': {
      const idx = y.map((v, i) => i).filter((i) => x[i] > 0 && y[i] * sign > 0);
      if (idx.length < 2) return [sign, 1];
      const l = line(idx.map((i) => Math.log(x[i])), idx.map((i) => Math.log(sign * y[i])));
      const out = [sign * Math.exp(l.a), l.b];
      return finiteAll(out) ? out : [sign, 1];
    }
    case 'logistic': {
      // c a little beyond the largest |y|; then ln(c/y − 1) = ln a − b·x.
      const yMax = Math.max(...y.map((v) => v * sign));
      const c = sign * yMax * 1.05 || 1;
      const idx = y.map((v, i) => i).filter((i) => y[i] / c > 0 && y[i] / c < 1);
      if (idx.length >= 2) {
        const l = line(idx.map((i) => x[i]), idx.map((i) => Math.log(c / y[i] - 1)));
        const out = [Math.exp(l.a), -l.b, c];
        if (finiteAll(out)) return out;
      }
      return [1, 4 / span, c];
    }
    case 'sin': {
      // Periodogram: for each angular frequency, fit y ≈ d + s·sin(ωx) + k·cos(ωx);
      // the best one gives a, b, c and d.
      const best = periodogram(x, y, span);
      const toUnit = angle === 'deg' ? 180 / Math.PI : 1;
      return [best.amp, best.omega * toUnit, best.phase * toUnit, best.d];
    }
    case 'gauss': {
      const sorted = [...y].sort((a, b) => a - b);
      const median = sorted[Math.floor(n / 2)];
      let iMax = 0;
      let iMin = 0;
      for (let i = 1; i < n; i++) {
        if (y[i] > y[iMax]) iMax = i;
        if (y[i] < y[iMin]) iMin = i;
      }
      const up = y[iMax] - median >= median - y[iMin];
      const i0 = up ? iMax : iMin;
      const a = y[i0];
      // Half width at half maximum from the points above half the peak.
      let lo = x[i0];
      let hi = x[i0];
      for (let i = 0; i < n; i++) {
        if (y[i] / a > 0.5) {
          if (x[i] < lo) lo = x[i];
          if (x[i] > hi) hi = x[i];
        }
      }
      const c = (hi - lo) / 2.3548 || span / 10;
      return [a, x[i0], c];
    }
    default:
      return null;
  }
}

function periodogram(x, y, span) {
  const n = x.length;
  const xs = [...x].sort((a, b) => a - b);
  let minGap = Infinity;
  const gaps = [];
  for (let i = 1; i < n; i++) {
    const g = xs[i] - xs[i - 1];
    if (g > 0) {
      gaps.push(g);
      if (g < minGap) minGap = g;
    }
  }
  gaps.sort((a, b) => a - b);
  const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)] : span;
  const wMin = Math.PI / span; // half a cycle across the data
  const wMax = Math.PI / Math.max(typical, 1e-300); // two points per cycle
  const dw = Math.PI / (4 * span);
  const steps = Math.min(5000, Math.max(50, Math.ceil((wMax - wMin) / dw)));
  let best = null;
  for (let s = 0; s <= steps; s++) {
    const w = wMin + ((wMax - wMin) * s) / steps;
    const fitW = sinFit(x, y, w);
    if (fitW && (!best || fitW.rss < best.rss)) best = { ...fitW, omega: w };
  }
  if (!best) {
    const mean = y.reduce((a, v) => a + v, 0) / n;
    return { amp: 1, omega: 2 * Math.PI / span, phase: 0, d: mean };
  }
  return best;
}

// Least squares y ≈ d + s·sin(wx) + k·cos(wx) (3×3 normal equations, solved by Cramer).
function sinFit(x, y, w) {
  const n = x.length;
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const v = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const row = [1, Math.sin(w * x[i]), Math.cos(w * x[i])];
    for (let a = 0; a < 3; a++) {
      v[a] += row[a] * y[i];
      for (let b = 0; b < 3; b++) M[a][b] += row[a] * row[b];
    }
  }
  const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det3(M);
  if (!(Math.abs(D) > 1e-12 * n ** 3)) return null;
  const sol = [0, 1, 2].map((c) => det3(M.map((row, i) => row.map((val, j) => (j === c ? v[i] : val)))) / D);
  const [d, s, k] = sol;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += (y[i] - d - s * Math.sin(w * x[i]) - k * Math.cos(w * x[i])) ** 2;
  return { rss, amp: Math.hypot(s, k) || 1, phase: Math.atan2(k, s), d };
}
