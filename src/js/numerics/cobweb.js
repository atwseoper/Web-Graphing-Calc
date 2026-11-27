// Cobweb diagrams for first-order recurrences u(n) = g(u(n − 1)) (Phase 9b). Pure module.

export const DEFAULT_COBWEB_STEPS = 20;
export const MAX_COBWEB_STEPS = 500;

// The staircase of a cobweb diagram, as world points: from (u0, 0) up (or down) to the
// curve at (u0, u1), across to the line y = x at (u1, u1), to the curve at (u1, u2) …
// for `steps` steps. Stops early where a term is undefined or runs off to infinity.
export function cobwebPath(g, u0, steps) {
  const xs = [u0];
  const ys = [0];
  let x = u0;
  for (let k = 0; k < steps; k++) {
    const y = g(x);
    if (!Number.isFinite(y) || Math.abs(y) > 1e15) break;
    xs.push(x, y);
    ys.push(y, y);
    x = y;
  }
  return { xs, ys };
}

// The number of steps from the row's box ('' = the default), or an error message.
export function cobwebSteps(value) {
  if (value === null) return { steps: DEFAULT_COBWEB_STEPS };
  if (!Number.isInteger(value) || value < 1 || value > MAX_COBWEB_STEPS) {
    return { error: `Steps must be a whole number from 1 to ${MAX_COBWEB_STEPS}` };
  }
  return { steps: value };
}
