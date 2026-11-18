// Riemann sums (Phase 6b). Pure module.
//
// riemann(f, a, b, n, method) with method 'left' | 'right' | 'mid' | 'trap' (Simpson's
// rule is left out on purpose, Q9). Returns
//   { ok: true, value, edges, heights }  edges: the n + 1 x values from a to b; heights:
//                                        n rectangle heights, or for 'trap' the n + 1
//                                        values of f at the edges
//   { ok: false, message }               f is undefined at a point the sum needs
// a > b is allowed and gives the negative of the sum from b to a, as the integral does.

export const RIEMANN_METHODS = ['left', 'right', 'mid', 'trap'];
export const RIEMANN_MAX_N = 200;

export function riemann(f, a, b, n, method) {
  if (!RIEMANN_METHODS.includes(method)) throw new RangeError(`Unknown method ${method}`);
  if (!Number.isInteger(n) || n < 1 || n > RIEMANN_MAX_N) throw new RangeError(`n must be a whole number from 1 to ${RIEMANN_MAX_N}`);
  const h = (b - a) / n;
  const edges = new Array(n + 1);
  for (let k = 0; k <= n; k++) edges[k] = k === n ? b : a + k * h;
  const at = (x) => {
    const y = f(x);
    return Number.isFinite(y) ? y : null;
  };
  const undefinedAt = (x) => ({ ok: false, message: `The function is undefined at x = ${x}, which this sum needs` });
  let sum = 0;
  let heights;
  if (method === 'trap') {
    heights = new Array(n + 1);
    for (let k = 0; k <= n; k++) {
      const y = at(edges[k]);
      if (y === null) return undefinedAt(edges[k]);
      heights[k] = y;
    }
    for (let k = 0; k < n; k++) sum += (heights[k] + heights[k + 1]) / 2;
  } else {
    heights = new Array(n);
    for (let k = 0; k < n; k++) {
      const x = method === 'left' ? edges[k] : method === 'right' ? edges[k + 1] : (edges[k] + edges[k + 1]) / 2;
      const y = at(x);
      if (y === null) return undefinedAt(x);
      heights[k] = y;
      sum += y;
    }
  }
  return { ok: true, value: sum * h, edges, heights };
}
