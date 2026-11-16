// Polynomial roots, including complex ones. Pure module – no DOM access.
//
// polyRoots(coeffs) with coeffs in ascending order (c0 + c1·x + … + cn·xⁿ) returns
// { roots: [{ re, im, multiplicity, residual }], degree, iterations, converged }.
// Degrees 1 and 2 use closed forms (the quadratic in its cancellation-free form);
// higher degrees use the Aberth–Ehrlich method, polished with Newton steps.
// Repeated roots are reported once with their multiplicity (the mean of the
// cluster, which is more accurate than its members).

const EPS = 2.220446049250313e-16;

// p(z) and p'(z) for complex z = (re, im), coefficients ascending.
export function polyEval(c, re, im) {
  let pr = 0;
  let pi = 0;
  let dr = 0;
  let di = 0;
  for (let k = c.length - 1; k >= 0; k--) {
    // d = d·z + p ; p = p·z + c[k]
    const ndr = dr * re - di * im + pr;
    const ndi = dr * im + di * re + pi;
    dr = ndr;
    di = ndi;
    const npr = pr * re - pi * im + c[k];
    const npi = pr * im + pi * re;
    pr = npr;
    pi = npi;
  }
  return { pr, pi, dr, di };
}

function cdiv(ar, ai, br, bi) {
  const d = br * br + bi * bi;
  return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
}

function aberth(c) {
  const n = c.length - 1;
  // Starting points on a circle whose radius bounds the roots (Fujiwara bound).
  let radius = 0;
  for (let k = 0; k < n; k++) {
    const r = Math.abs(c[k] / c[n]) ** (1 / (n - k));
    radius = Math.max(radius, k === 0 ? r / 2 ** (1 / n) : r);
  }
  radius = Math.max(2 * radius, 1e-300);
  const zr = new Float64Array(n);
  const zi = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n + 0.4;
    zr[k] = 0.5 * radius * Math.cos(t);
    zi[k] = 0.5 * radius * Math.sin(t);
  }
  const done = new Uint8Array(n);
  let iterations = 0;
  let converged = false;
  for (let it = 0; it < 500; it++) {
    iterations = it + 1;
    let active = 0;
    for (let k = 0; k < n; k++) {
      if (done[k]) continue;
      active++;
      const { pr, pi, dr, di } = polyEval(c, zr[k], zi[k]);
      if (pr === 0 && pi === 0) {
        done[k] = 1;
        continue;
      }
      const [wr, wi] = cdiv(pr, pi, dr, di); // Newton correction p/p'
      let sr = 0;
      let si = 0;
      for (let j = 0; j < n; j++) {
        if (j === k) continue;
        const [ir, ii] = cdiv(1, 0, zr[k] - zr[j], zi[k] - zi[j]);
        sr += ir;
        si += ii;
      }
      // offset = w / (1 − w·s)
      const denr = 1 - (wr * sr - wi * si);
      const deni = -(wr * si + wi * sr);
      const [or, oi] = cdiv(wr, wi, denr, deni);
      if (!Number.isFinite(or) || !Number.isFinite(oi)) continue;
      zr[k] -= or;
      zi[k] -= oi;
      if (Math.hypot(or, oi) <= 4 * EPS * Math.hypot(zr[k], zi[k])) done[k] = 1;
    }
    if (!active) {
      converged = true;
      break;
    }
  }
  return { zr, zi, iterations, converged };
}

// Newton steps on the full polynomial while they reduce |p|.
function polish(c, re, im) {
  let { pr, pi } = polyEval(c, re, im);
  for (let s = 0; s < 4; s++) {
    const e = polyEval(c, re, im);
    const [wr, wi] = cdiv(e.pr, e.pi, e.dr, e.di);
    if (!Number.isFinite(wr) || !Number.isFinite(wi)) break;
    const nr = re - wr;
    const ni = im - wi;
    const n = polyEval(c, nr, ni);
    if (Math.hypot(n.pr, n.pi) >= Math.hypot(pr, pi)) break;
    re = nr;
    im = ni;
    pr = n.pr;
    pi = n.pi;
  }
  return [re, im];
}

// A root of multiplicity m is a simple root of the (m−1)th derivative, where Newton's
// method converges quickly and accurately. Steps are kept while they stay close.
function refineRepeated(c, re, im, m) {
  let d = [...c];
  for (let k = 1; k < m; k++) d = d.slice(1).map((v, i) => v * (i + 1));
  const start = Math.hypot(re, im);
  let r = re;
  let i = im;
  for (let s = 0; s < 8; s++) {
    const e = polyEval(d, r, i);
    const [wr, wi] = cdiv(e.pr, e.pi, e.dr, e.di);
    if (!Number.isFinite(wr) || !Number.isFinite(wi)) break;
    r -= wr;
    i -= wi;
    if (Math.hypot(wr, wi) <= EPS * Math.max(1, Math.hypot(r, i))) break;
  }
  const moved = Math.hypot(r - re, i - im);
  return moved <= 1e-3 * Math.max(1, start) ? [r, i] : [re, im];
}

export function polyRoots(coeffs) {
  const c = [...coeffs];
  while (c.length && c[c.length - 1] === 0) c.pop();
  if (c.length < 2) return { roots: [], degree: Math.max(0, c.length - 1), iterations: 0, converged: true };
  if (c.some((v) => !Number.isFinite(v))) throw new RangeError('Coefficients must be finite');
  const degree = c.length - 1;
  const raw = [];
  // Exact zero roots.
  let zeros = 0;
  while (c[0] === 0) {
    c.shift();
    zeros++;
  }
  for (let k = 0; k < zeros; k++) raw.push([0, 0]);
  const n = c.length - 1;
  let iterations = 0;
  let converged = true;
  if (n === 1) {
    raw.push([-c[0] / c[1], 0]);
  } else if (n === 2) {
    const [cc, b, a] = c;
    const disc = b * b - 4 * a * cc;
    if (disc >= 0) {
      const q = -0.5 * (b + (b >= 0 ? 1 : -1) * Math.sqrt(disc));
      const r1 = q / a;
      const r2 = q !== 0 ? cc / q : r1;
      raw.push([r1, 0], [r2, 0]);
    } else {
      const re = -b / (2 * a);
      const im = Math.sqrt(-disc) / (2 * Math.abs(a));
      raw.push([re, im], [re, -im]);
    }
  } else if (n > 2) {
    const r = aberth(c);
    iterations = r.iterations;
    converged = r.converged;
    for (let k = 0; k < n; k++) raw.push(polish(c, r.zr[k], r.zi[k]));
  }

  // Group repeated roots. A root of multiplicity m can only be found to about ε^(1/m),
  // so m roots count as one repeated root when they all lie within a few ε^(1/m) of
  // their mean. Distinct roots that are close together stay separate.
  const groups = [];
  const used = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    if (used[i]) continue;
    const order = [];
    for (let j = 0; j < raw.length; j++) if (!used[j]) order.push(j);
    const dist = (j) => Math.hypot(raw[j][0] - raw[i][0], raw[j][1] - raw[i][1]);
    order.sort((p, q) => dist(p) - dist(q));
    let best = [i];
    for (let m = 2; m <= Math.min(order.length, 24); m++) {
      const members = order.slice(0, m);
      const re = members.reduce((acc, j) => acc + raw[j][0], 0) / m;
      const im = members.reduce((acc, j) => acc + raw[j][1], 0) / m;
      const tol = 4 * EPS ** (1 / m) * Math.max(1, Math.hypot(re, im));
      if (members.every((j) => Math.hypot(raw[j][0] - re, raw[j][1] - im) <= tol)) best = members;
    }
    for (const j of best) used[j] = 1;
    let re = best.reduce((acc, j) => acc + raw[j][0], 0) / best.length;
    let im = best.reduce((acc, j) => acc + raw[j][1], 0) / best.length;
    if (best.length > 1) [re, im] = refineRepeated(c, re, im, best.length);
    groups.push({ re, im, multiplicity: best.length });
  }
  const full = coeffs.slice(0, degree + 1);
  const scale = full.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const roots = groups.map((g) => {
    let { re, im } = g;
    // Real coefficients: an imaginary part at rounding level is zero. Repeated roots
    // are only accurate to about √ε, so they get a looser threshold.
    const tiny = (g.multiplicity > 1 ? 1e-6 : 1e-10) * Math.max(1, Math.abs(re));
    if (Math.abs(im) <= tiny) im = 0;
    // Likewise a real part that is rounding noise next to the imaginary part (±i).
    if (im !== 0 && Math.abs(re) <= 1e-13 * Math.abs(im)) re = 0;
    const { pr, pi } = polyEval(full, re, im);
    return { re, im, multiplicity: g.multiplicity, residual: Math.hypot(pr, pi) / (scale || 1) };
  });
  // Real roots first (ascending), then complex ones by real part.
  roots.sort((p, q) => (Math.abs(p.im) > 0) - (Math.abs(q.im) > 0) || p.re - q.re || q.im - p.im);
  return { roots, degree, iterations, converged };
}
