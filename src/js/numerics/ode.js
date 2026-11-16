// Solution curves of dy/dx = f(x, y) by the classical 4th-order Runge–Kutta method.
// Pure module – no DOM access.

// Integrate from (x0, y0) to x1 in `steps` equal steps (x1 may be less than x0).
// Stops early when y leaves [yMin, yMax] (that point is kept, so the curve reaches the
// edge of the view), when f stops being finite, or when one step would move y by more
// than maxJump (a vertical tangent or a singularity, where y(x) stops existing).
// Returns { x: [], y: [] }.
export function rk4Path(f, x0, y0, x1, { steps = 400, yMin = -Infinity, yMax = Infinity, maxJump = Infinity } = {}) {
  const xs = [x0];
  const ys = [y0];
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || steps < 1) return { x: xs, y: ys };
  const h = (x1 - x0) / steps;
  let x = x0;
  let y = y0;
  for (let i = 0; i < steps; i++) {
    const k1 = f(x, y);
    const k2 = f(x + h / 2, y + (h / 2) * k1);
    const k3 = f(x + h / 2, y + (h / 2) * k2);
    const k4 = f(x + h, y + h * k3);
    const yn = y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    if (!Number.isFinite(yn) || Math.abs(yn - y) > maxJump) break;
    x = x0 + (i + 1) * h;
    y = yn;
    xs.push(x);
    ys.push(y);
    if (y < yMin || y > yMax) break;
  }
  return { x: xs, y: ys };
}

// The whole solution through (x0, y0) across [xMin, xMax]: backwards then forwards,
// as one path in increasing x.
export function solutionThrough(f, x0, y0, xMin, xMax, options = {}) {
  const span = xMax - xMin;
  const per = (options.steps || 600) / span;
  const back = rk4Path(f, x0, y0, xMin, { ...options, steps: Math.max(1, Math.ceil((x0 - xMin) * per)) });
  const fwd = rk4Path(f, x0, y0, xMax, { ...options, steps: Math.max(1, Math.ceil((xMax - x0) * per)) });
  return {
    x: [...back.x.slice(1).reverse(), ...fwd.x],
    y: [...back.y.slice(1).reverse(), ...fwd.y],
  };
}
