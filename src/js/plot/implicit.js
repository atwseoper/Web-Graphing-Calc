// Implicit curves F(x, y) = 0 and shaded regions, sampled over the visible part of the
// graph. Pure module – no DOM access.
//
// contour() is marching squares on a grid of square cells a few pixels wide. Each
// crossing on a cell edge is placed by linear interpolation and then refined by
// bisection on F. Saddle cells are resolved with the value at the cell centre. A
// segment whose midpoint has |F| larger than every corner is dropped: that is a pole
// (tan, 1/x), where F changes sign without being zero. Segments are joined into
// polylines through their shared edge points, so dashed lines dash properly.
import { toWorld } from './viewport.js';

export const MAX_CELLS = 40000;

function gridSize(vp, cell, maxCells) {
  let c = cell;
  if ((vp.width / c) * (vp.height / c) > maxCells) c = Math.sqrt((vp.width * vp.height) / maxCells);
  const cols = Math.max(1, Math.ceil(vp.width / c));
  const rows = Math.max(1, Math.ceil(vp.height / c));
  return { cols, rows, cw: vp.width / cols, ch: vp.height / rows };
}

// Lines of F = 0 in screen coordinates: [{ x: [], y: [], t: [] }].
// keep(wx, wy), if given, is asked about each segment's midpoint (world coordinates);
// segments it rejects are left out (used to clip inequality edges to their region).
export function contour(F, vp, { cell = 4, maxCells = MAX_CELLS, keep = null } = {}) {
  const { cols, rows, cw, ch } = gridSize(vp, cell, maxCells);
  const W = cols + 1;
  const val = new Float64Array(W * (rows + 1));
  const evalAt = (sx, sy) => {
    const [wx, wy] = toWorld(vp, sx, sy);
    const v = F(wx, wy);
    return typeof v === 'number' ? v : NaN;
  };
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) val[j * W + i] = evalAt(i * cw, j * ch);
  }

  // Crossing points, shared between neighbouring cells, keyed by edge id.
  const H = cols * (rows + 1); // horizontal edges first, then vertical
  const points = new Map();
  function edgePoint(id, ax, ay, va, bx, by, vb) {
    let p = points.get(id);
    if (p) return p;
    // Linear guess, then bisection between the end with each sign.
    let lo = 0;
    let hi = 1;
    let flo = va;
    let u = va / (va - vb);
    if (!(u >= 0 && u <= 1)) u = 0.5;
    for (let k = 0; k < 5; k++) {
      const v = evalAt(ax + (bx - ax) * u, ay + (by - ay) * u);
      if (!Number.isFinite(v) || v === 0) break;
      if ((v > 0) === (flo > 0)) {
        lo = u;
        flo = v;
      } else {
        hi = u;
      }
      u = (lo + hi) / 2;
    }
    p = [ax + (bx - ax) * u, ay + (by - ay) * u];
    points.set(id, p);
    return p;
  }

  const adj = new Map(); // edge id -> [edge id…]
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v0 = val[j * W + i]; // top left
      const v1 = val[j * W + i + 1]; // top right
      const v2 = val[(j + 1) * W + i + 1]; // bottom right
      const v3 = val[(j + 1) * W + i]; // bottom left
      if (!(Number.isFinite(v0) && Number.isFinite(v1) && Number.isFinite(v2) && Number.isFinite(v3))) continue;
      const idx = (v0 > 0 ? 8 : 0) | (v1 > 0 ? 4 : 0) | (v2 > 0 ? 2 : 0) | (v3 > 0 ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const x0 = i * cw;
      const y0 = j * ch;
      const x1 = x0 + cw;
      const y1 = y0 + ch;
      // Edge ids and their crossing points (computed on demand).
      const E = [
        () => [j * cols + i, () => edgePoint(j * cols + i, x0, y0, v0, x1, y0, v1)], // top
        () => [H + j * W + i + 1, () => edgePoint(H + j * W + i + 1, x1, y0, v1, x1, y1, v2)], // right
        () => [(j + 1) * cols + i, () => edgePoint((j + 1) * cols + i, x0, y1, v3, x1, y1, v2)], // bottom
        () => [H + j * W + i, () => edgePoint(H + j * W + i, x0, y0, v0, x0, y1, v3)], // left
      ];
      let pairs;
      switch (idx) {
        case 1: case 14: pairs = [[2, 3]]; break;
        case 2: case 13: pairs = [[1, 2]]; break;
        case 3: case 12: pairs = [[1, 3]]; break;
        case 4: case 11: pairs = [[0, 1]]; break;
        case 6: case 9: pairs = [[0, 2]]; break;
        case 7: case 8: pairs = [[0, 3]]; break;
        case 5: case 10: {
          // Saddle. If the centre has the sign of the two high corners, the low corners
          // are cut off; otherwise the high ones are.
          const centreHigh = evalAt(x0 + cw / 2, y0 + ch / 2) > 0;
          const cutTopRight = (idx === 5) !== centreHigh; // TR corner isolated with BL
          pairs = cutTopRight ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
          break;
        }
        default: pairs = [];
      }
      const cornerMax = Math.max(Math.abs(v0), Math.abs(v1), Math.abs(v2), Math.abs(v3));
      for (const [a, b] of pairs) {
        const [ida, pa] = E[a]();
        const [idb, pb] = E[b]();
        const P = pa();
        const Q = pb();
        const mx = (P[0] + Q[0]) / 2;
        const my = (P[1] + Q[1]) / 2;
        const vm = evalAt(mx, my);
        if (!Number.isFinite(vm) || Math.abs(vm) > cornerMax) continue; // a pole, not a root
        if (keep) {
          const [wx, wy] = toWorld(vp, mx, my);
          if (!keep(wx, wy)) continue;
        }
        link(ida, idb);
      }
    }
  }

  // Join segments into polylines.
  const lines = [];
  const used = new Set(); // "a,b" with a < b
  const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  const walk = (start) => {
    const ids = [start];
    let prev = -1;
    let cur = start;
    for (;;) {
      const next = (adj.get(cur) || []).find((n) => n !== prev && !used.has(key(cur, n)));
      if (next === undefined) break;
      used.add(key(cur, next));
      ids.push(next);
      prev = cur;
      cur = next;
      if (cur === start) break;
    }
    return ids;
  };
  const emit = (ids) => {
    if (ids.length < 2) return;
    const x = ids.map((id) => points.get(id)[0]);
    const y = ids.map((id) => points.get(id)[1]);
    lines.push({ x, y, t: new Array(x.length).fill(0) });
  };
  // Open chains first (from ends with one neighbour), then closed loops.
  for (const [id, ns] of adj) if (ns.length === 1 && !used.has(key(id, ns[0]))) emit(walk(id));
  for (const [id, ns] of adj) {
    for (const n of ns) if (!used.has(key(id, n))) emit(walk(id));
  }
  return lines;
}

// Shading for a region test(x, y): rectangles [sx, sy, w, h] (screen coordinates),
// one per horizontal run of grid cells whose centre passes the test.
export function regionRects(test, vp, { cell = 4, maxCells = MAX_CELLS } = {}) {
  const { cols, rows, cw, ch } = gridSize(vp, cell, maxCells);
  const out = [];
  for (let j = 0; j < rows; j++) {
    let start = -1;
    for (let i = 0; i <= cols; i++) {
      let inside = false;
      if (i < cols) {
        const [wx, wy] = toWorld(vp, (i + 0.5) * cw, (j + 0.5) * ch);
        try {
          inside = !!test(wx, wy);
        } catch {
          inside = false;
        }
      }
      if (inside && start < 0) start = i;
      if (!inside && start >= 0) {
        out.push([start * cw, j * ch, (i - start) * cw, ch]);
        start = -1;
      }
    }
  }
  return out;
}

// Snap a point near the curve F = 0 onto it with a few Newton steps along the
// gradient (numeric). Returns [x, y] or null.
export function snapToCurve(F, x, y, scale = 1e-3) {
  let px = x;
  let py = y;
  for (let k = 0; k < 8; k++) {
    const f = F(px, py);
    if (!Number.isFinite(f)) return null;
    const hx = scale;
    const gx = (F(px + hx, py) - F(px - hx, py)) / (2 * hx);
    const gy = (F(px, py + hx) - F(px, py - hx)) / (2 * hx);
    const g2 = gx * gx + gy * gy;
    if (!(g2 > 0) || !Number.isFinite(g2)) break;
    px -= (f * gx) / g2;
    py -= (f * gy) / g2;
    if (Math.abs(f) < 1e-12) break;
  }
  return Number.isFinite(px) && Number.isFinite(py) ? [px, py] : null;
}
