// Definite integrals by adaptive Gauss–Kronrod 7/15 quadrature. Pure module.
//
// integrate(f, a, b) -> { value, error, evaluations, ok, message? }
// The interval with the largest error estimate is bisected until the total estimated
// error is below the tolerance. Each estimate is |K15 − G7|, which is conservative for
// smooth integrands. Integrable endpoint singularities (1/√x at 0) work because the
// nodes never touch the ends; values that are undefined inside the range are reported.

// Kronrod nodes (positive half, 0 last) and weights; Gauss weights for the odd nodes.
const XGK = [
  0.991455371120812639206854697526329, 0.949107912342758524526189684047851,
  0.864864423359769072789712788640926, 0.741531185599394439863864773280788,
  0.586087235467691130294144845693013, 0.405845151377397166906606412076961,
  0.207784955007898467600689403773245, 0,
];
const WGK = [
  0.022935322010529224963732008058970, 0.063092092629978553290700663189204,
  0.104790010322250183839876322541518, 0.140653259715525918745189590510238,
  0.169004726639267902826583426598550, 0.190350578064785409913256402421014,
  0.204432940075298892414161999234649, 0.209482141084727828012999174891714,
];
const WG = [
  0.129484966168869693270611432679082, 0.279705391489276667901467771423780,
  0.381830050505118944950369775488975, 0.417959183673469387755102040816327,
];

function gk15(f, a, b) {
  const c = 0.5 * (a + b);
  const h = 0.5 * (b - a);
  const fc = f(c);
  let k = fc * WGK[7];
  let g = fc * WG[3];
  let bad = !Number.isFinite(fc);
  for (let j = 0; j < 7; j++) {
    const dx = h * XGK[j];
    const f1 = f(c - dx);
    const f2 = f(c + dx);
    if (!Number.isFinite(f1) || !Number.isFinite(f2)) bad = true;
    const s = f1 + f2;
    k += WGK[j] * s;
    if (j % 2 === 1) g += WG[(j - 1) / 2] * s;
  }
  return { a, b, value: k * h, error: Math.abs((k - g) * h), bad };
}

// Describe where f is undefined or infinite in [a, b], from a fine scan.
function undefinedResult(f, a, b, evaluations) {
  const n = 2000;
  const bad = (x) => !Number.isFinite(f(x));
  let first = -1;
  let last = -1;
  for (let i = 0; i <= n; i++) {
    if (bad(a + ((b - a) * i) / n)) {
      if (first < 0) first = i;
      last = i;
    }
  }
  const step = (b - a) / n;
  // Sharpen an edge between a bad sample and a good one by bisection, then round
  // away noise below a millionth of the range.
  const edge = (xBad, xGood) => {
    for (let k = 0; k < 60; k++) {
      const m = 0.5 * (xBad + xGood);
      if (bad(m)) xBad = m;
      else xGood = m;
    }
    const unit = 10 ** Math.floor(Math.log10((b - a) * 1e-6));
    return Math.round(xBad / unit) * unit + 0;
  };
  const fmt = (v) => String(Number(v.toPrecision(6))).replace('-', '−');
  let where;
  if (first < 0) {
    where = ' somewhere in this range';
  } else {
    const lo = first > 0 ? edge(a + first * step, a + (first - 1) * step) : a;
    const hi = last < n ? edge(a + last * step, a + (last + 1) * step) : b;
    where = hi - lo <= (b - a) * 1e-3 ? ` near x = ${fmt((lo + hi) / 2)}` : ` for some x between ${fmt(lo)} and ${fmt(hi)}`;
  }
  return { value: NaN, error: NaN, evaluations: evaluations + n + 1, ok: false, message: `The function is undefined or infinite${where}` };
}

export function integrate(f, a, b, opts = {}) {
  const absTol = opts.absTol ?? 1e-12;
  const relTol = opts.relTol ?? 1e-10;
  const maxIntervals = opts.maxIntervals ?? 1000;
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { value: NaN, error: NaN, evaluations: 0, ok: false, message: 'The limits must be finite numbers' };
  }
  if (a === b) return { value: 0, error: 0, evaluations: 0, ok: true };
  if (a > b) {
    const r = integrate(f, b, a, opts);
    return { ...r, value: -r.value };
  }

  let evaluations = 0;
  const counted = (x) => {
    evaluations++;
    return f(x);
  };
  const parts = [gk15(counted, a, b)];
  let value = parts[0].value;
  let error = parts[0].error;
  const minWidth = (b - a) * 1e-13;

  while (parts.length < maxIntervals) {
    if (parts.some((p) => p.bad)) return undefinedResult(f, a, b, evaluations);
    if (error <= Math.max(absTol, relTol * Math.abs(value))) break;
    let worst = 0;
    for (let i = 1; i < parts.length; i++) if (parts[i].error > parts[worst].error) worst = i;
    const p = parts[worst];
    if (p.b - p.a < minWidth) break;
    const m = 0.5 * (p.a + p.b);
    parts.splice(worst, 1, gk15(counted, p.a, m), gk15(counted, m, p.b));
    value = 0;
    error = 0;
    for (const q of parts) {
      value += q.value;
      error += q.error;
    }
  }
  if (parts.some((p) => p.bad)) return undefinedResult(f, a, b, evaluations);

  const tol = Math.max(absTol, relTol * Math.abs(value));
  const out = { value, error, evaluations, ok: true };
  if (!Number.isFinite(value) || error > 1e-3 * Math.abs(value) + 1e3 * tol) {
    out.ok = false;
    out.message = "The integral doesn't seem to converge – the function may go to infinity in this range";
  } else if (error > 10 * tol) {
    out.message = 'The estimate may be inaccurate: the integrand is hard to integrate here (a spike, a singularity or fast oscillation)';
  }
  return out;
}
