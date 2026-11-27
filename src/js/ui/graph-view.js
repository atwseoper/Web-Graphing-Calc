// The graph canvas: sizing, drawing, and pan / pinch / wheel / double-tap / trace.
// Also draws the analysis overlays (derivative, tangent, shaded integrals), the
// points of interest (roots, extrema, intercepts, intersections) of selected curves,
// and the data sets from the Data tab (points and error bars). Points tied to sliders
// get handles that can be dragged (Phase 6a, through the pointDrag controller).
// Either axis can be logarithmic (Phase 7a): the viewport maps through log10 there, and
// everything drawn goes through toScreen, so values ≤ 0 on a log axis aren't drawn.
// A row with a list draws a family of curves in shades of its colour, or a set of points
// (Phase 9a); each curve can be traced, and is labelled with its list element.
// Sequences, and rows with "Plot as sequence", are points at whole numbers; a first-order
// recurrence can show a cobweb diagram instead (Phase 9b).
import {
  createViewport, toScreen, toWorld, worldBounds, zoomAt, panBy, homeViewport, resizeViewport,
  screenX, screenY, axisX, axisY, fromAxisX, axisRange, pxPerUnitX, pxPerUnitY, slopeInAxes, setAxes, axisFit,
} from '../plot/viewport.js';
import {
  drawCartesianGrid, drawCartesianLabels, drawPolarGrid, drawPolarLabels,
} from '../plot/grid.js';
import {
  sampleCartesian, sampleCartesianX, sampleXRange, sampleParametric, samplePolar, nearestOnLines,
} from '../plot/sample.js';
import {
  drawLines, drawPoint, drawHandle, drawMarker, drawPoi, fillToBaseline, fillFan, drawScatter, drawErrorBars, fillBand,
} from '../plot/render.js';
import { dataBounds } from '../data/table.js';
import { setHistogram, boxPlot, columnValues } from '../data/summary.js';
import { formatCoordinate, formatNumber } from '../expr/format.js';
import { pointsOfInterest } from '../numerics/analysis.js';
import { contour, regionRects, snapToCurve } from '../plot/implicit.js';
import { solutionThrough } from '../numerics/ode.js';
import { riemannOf, taylorOf, secantOf } from '../expr/calculus.js';
import { cobwebPath, cobwebSteps } from '../numerics/cobweb.js';

const PLOTTABLE = new Set(['cartesian', 'cartesian-x', 'polar', 'parametric', 'point', 'function', 'implicit', 'inequality', 'slope', 'family', 'points', 'sequence']);
const REGION_ALPHA = 0.16;
const SLOPE_SPACING = 30; // px between slope-field marks
const FILL_EDGE = 10; // px beyond the canvas edge that fills reach
const STRICT_DASH = [8, 6]; // edges of < and > regions are dashed, like on paper
const TAP_SLOP = 8; // px of movement still counted as a tap
const DOUBLE_TAP_MS = 320;
const POI_NAMES = {
  root: 'Root', max: 'Maximum', min: 'Minimum', 'y-intercept': 'y-intercept', intersection: 'Intersection',
};

// Shades of a row's colour for the curves of a family (Phase 9a): from a little darker
// than the colour for the first element to a little lighter for the last.
export function familyShade(hex, k, n) {
  if (n <= 1 || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(...c);
  const min = Math.min(...c);
  const l = (max + min) / 2;
  const d = max - min;
  let hue = 0;
  let sat = 0;
  if (d > 0) {
    sat = d / (1 - Math.abs(2 * l - 1));
    if (max === c[0]) hue = ((c[1] - c[2]) / d) % 6;
    else if (max === c[1]) hue = (c[2] - c[0]) / d + 2;
    else hue = (c[0] - c[1]) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const t = k / (n - 1) - 0.5;
  const light = Math.min(0.82, Math.max(0.2, l + t * 0.4));
  return `hsl(${hue.toFixed(1)}, ${(sat * 100).toFixed(1)}%, ${(light * 100).toFixed(1)}%)`;
}

export function isPlottable(result) {
  return !!result && PLOTTABLE.has(result.kind) && (result.kind !== 'function' || !!result.f) && !result.domainError;
}

// y = f(x) rows (including f(x) = … definitions in x) that analysis works on.
// (A function of another letter plotted as a sequence, v(n) = 1/n, isn't: Phase 9b.)
export function isFunctionOfX(result) {
  return !!result && (result.kind === 'cartesian' || (result.kind === 'function' && !!result.f && !!result.body));
}

// Evaluate an optional number field of a row ('' -> null).
export function fieldValue(analysis, text) {
  if (!text || !text.trim()) return null;
  const r = analysis.evaluate(text);
  return !r.error && Number.isFinite(r.value) ? r.value : null;
}

export function createGraphView({
  canvas, store, getAnalysis, getFits = () => [], pointDrag = null, secantPlayer = null, cobwebPlayer = null,
}) {
  let ctx = canvas.getContext('2d'); // swapped for an off-screen canvas by renderImage()
  let renderScale = 0; // pixels per CSS px when rendering an image (0 = the screen's)
  let vp = null;
  let curves = [];
  let trace = null; // { rowId, kind, x?, y?, t? }
  let colors = null;
  let raf = 0;
  const pointers = new Map();
  let gesture = null;
  let lastTap = null;
  let selectedId = null; // curve whose points of interest are shown
  let poiSel = null; // tapped point of interest { rowId, x, y, label }
  let drawnPois = []; // [{ rowId, sx, sy, x, y, label, color }] for hit testing
  let drawnHandles = []; // [{ rowId, sx, sy }] of draggable points (Phase 6a)
  let pendingFrame = null; // [x0, x1] to show once the canvas has a size
  let interacting = false;
  let wheelTimer = 0;
  const poiCache = { analysis: null, map: new Map() };
  const listeners = new Set();

  const coarse = window.matchMedia('(pointer: coarse)');

  // ---- view persistence --------------------------------------------------------
  let saveTimer = 0;
  function persistView() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const view = { cx: vp.cx, cy: vp.cy, scaleX: vp.scaleX, scaleY: vp.scaleY, logX: vp.logX, logY: vp.logY };
      store.update((s) => ({ ...s, view }));
    }, 300);
  }
  function setViewport(next) {
    vp = next;
    persistView();
    requestDraw();
    for (const l of listeners) l();
  }

  // ---- axis types (Phase 7a) ---------------------------------------------------------
  function wantedAxes() {
    const { settings } = store.get();
    return { logX: settings.xAxis === 'log', logY: settings.yAxis === 'log' };
  }
  // Bring the view into line with the axis settings (changed in Settings, by undo, or by
  // opening a project), keeping as much of the visible range as can be shown.
  function syncAxes() {
    if (!vp) return;
    const { logX, logY } = wantedAxes();
    if (vp.logX === logX && vp.logY === logY) return;
    vp = setAxes(vp, logX, logY);
    trace = null;
    poiSel = null;
    persistView();
    for (const l of listeners) l();
  }

  // On a log y axis, values ≤ 0 lie below the graph: fills (integrals, bands, error
  // bars, Riemann rectangles) run to just past the bottom edge.
  function fillY(y) {
    const sy = screenY(vp, y);
    if (Number.isFinite(sy)) return sy;
    return vp.logY && y <= 0 ? vp.height + FILL_EDGE : NaN;
  }
  function baselineY() {
    return vp.logY ? vp.height + FILL_EDGE : screenY(vp, 0);
  }

  // ---- sizing --------------------------------------------------------------------
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return; // hidden (full-page tab): keep the view as it was
    const w = Math.max(1, Math.round(rect.width));
    const hgt = Math.max(1, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    if (!vp) {
      const saved = store.get().view;
      vp = saved ? createViewport({ width: w, height: hgt, ...saved }) : homeViewport(w, hgt, wantedAxes());
      syncAxes();
      for (const l of listeners) l();
      if (pendingFrame) {
        const [x0, x1] = pendingFrame;
        pendingFrame = null;
        frameX(x0, x1);
        return;
      }
    } else {
      vp = resizeViewport(vp, w, hgt);
    }
    // A pan or pinch in progress works from the view at its start; resize that too, or
    // its next move would put back the old size and leave part of the canvas undrawn
    // (e.g. touching the graph closes the keypad, so the graph grows mid-drag).
    if (gesture && gesture.vp0) gesture.vp0 = resizeViewport(gesture.vp0, w, hgt);
    draw();
  }
  new ResizeObserver(resize).observe(canvas);

  // ---- colours ---------------------------------------------------------------------
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    colors = {
      bg: v('--graph-bg'), gridMinor: v('--grid-minor'), gridMajor: v('--grid-major'),
      axis: v('--axis'), label: v('--label'), text: v('--text'), chipBg: v('--chip-bg'), chipText: v('--chip-text'),
    };
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    colors = null;
    requestDraw();
  });

  // ---- drawing ---------------------------------------------------------------------
  function requestDraw() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }

  function sampleRow(r, angleFactor) {
    switch (r.kind) {
      case 'cartesian':
      case 'function': return r.discrete || r.asSequence ? stemPoints(r.f) : sampleCartesian(r.f, vp);
      case 'sequence': return stemPoints(r.f, r.lowest);
      case 'cartesian-x': return sampleCartesianX(r.f, vp);
      case 'parametric': return sampleParametric(r.fx, r.fy, r.domain.min, r.domain.max, vp);
      case 'polar': return samplePolar(r.f, r.domain.min, r.domain.max, vp, angleFactor);
      case 'implicit': return memo(r.F, 'c', () => contour(r.F, vp, { cell: interacting ? 8 : 4 }));
      case 'point': {
        const [sx, sy] = toScreen(vp, r.x, r.y);
        return Number.isFinite(sx) && Number.isFinite(sy) ? [{ x: [sx], y: [sy], t: [0] }] : [];
      }
      default: return [];
    }
  }

  function draw() {
    if (!vp) return;
    if (!colors) readColors();
    syncAxes();
    const state = store.get();
    const analysis = getAnalysis();
    const dpr = renderScale || window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, vp.width, vp.height);

    const polarGrid = state.settings.grid === 'polar' && !vp.logX && !vp.logY;
    if (polarGrid) drawPolarGrid(ctx, vp, colors);
    else drawCartesianGrid(ctx, vp, colors);

    const angleFactor = analysis.angle === 'deg' ? Math.PI / 180 : 1;
    const visible = [];
    state.rows.forEach((row, i) => {
      const r = analysis.rows[i];
      if (!row.hidden && isPlottable(r)) visible.push({ row, r });
    });

    // Shaded integrals and polar areas go underneath the curves.
    for (const { row, r } of visible) if (row.showAnalysis) drawShading(row, r, analysis, angleFactor);

    // Shaded inequalities and slope fields go under the curves too.
    for (const { row, r } of visible) {
      if (r.kind === 'inequality') drawInequality(row, r);
      else if (r.kind === 'slope') drawSlopeField(row, r);
    }

    curves = [];
    drawnHandles = [];
    const handles = [];
    for (const { row, r } of visible) {
      if (r.kind === 'inequality' || r.kind === 'slope') continue;
      if (r.kind === 'family') {
        drawFamily(row, r, angleFactor);
        continue;
      }
      if (r.kind === 'points') {
        drawListPoints(row, r);
        continue;
      }
      const lines = sampleRow(r, angleFactor);
      curves.push({ rowId: row.id, kind: r.kind, color: row.color, lines, result: r });
      if (r.kind === 'point') {
        if (!lines.length) continue;
        const [sx, sy] = [lines[0].x[0], lines[0].y[0]];
        // Handles are drawn last, on top; not in exported images.
        if (pointDrag && renderScale === 0 && pointDrag.isDraggable(row.id, vp)) {
          handles.push({ rowId: row.id, sx, sy, color: row.color });
        } else {
          drawPoint(ctx, sx, sy, row.color);
        }
      } else if (r.kind === 'sequence' && row.cobweb && r.cobweb) {
        curves[curves.length - 1].lines = []; // the terms aren't drawn, so they can't be traced
        drawCobweb(row, r, analysis);
      } else if (r.asSequence) {
        drawSequenceDots(lines, row.color);
      } else if (r.discrete) {
        drawStems(lines, row.color);
      } else if (sweeps.has(row.id) && (r.kind === 'polar' || r.kind === 'parametric')) {
        drawSweep(row, r, lines, sweeps.get(row.id).frac, angleFactor);
      } else {
        drawLines(ctx, lines, row.color);
      }
    }

    drawFits();
    drawData(state);

    for (const { row, r } of visible) if (row.showAnalysis && isFunctionOfX(r)) drawOverlays(row, r, analysis);

    if (polarGrid) drawPolarLabels(ctx, vp, colors, analysis.angle);
    else drawCartesianLabels(ctx, vp, colors);

    drawPointsOfInterest(visible);
    for (const hd of handles) {
      drawHandle(ctx, hd.sx, hd.sy, hd.color, colors, gesture && gesture.type === 'point' && gesture.rowId === hd.rowId);
      drawnHandles.push(hd);
    }
    drawTrace(analysis);
    drawSelectedPoi();
  }

  // ---- lists (Phase 9a) ---------------------------------------------------------------------
  // One curve per element, each traceable on its own (rowId "id#k") and labelled with its
  // element (a = 2).
  function drawFamily(row, r, angleFactor) {
    const n = r.members.length;
    r.members.forEach((m, k) => {
      const color = familyShade(row.color, k, n);
      const lines = sampleRow(m, angleFactor);
      curves.push({ rowId: `${row.id}#${k}`, kind: m.kind, color, lines, result: m, label: r.labels[k] });
      if (m.discrete) drawStems(lines, color);
      else drawLines(ctx, lines, color);
    });
  }

  // (L, M): points from two lists, drawn and traced like a data set's.
  function drawListPoints(row, r) {
    const pts = { x: [], y: [], i: [] };
    for (let k = 0; k < r.xs.length; k++) {
      if (!Number.isFinite(r.xs[k]) || !Number.isFinite(r.ys[k])) continue;
      const [sx, sy] = toScreen(vp, r.xs[k], r.ys[k]);
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
      pts.x.push(sx);
      pts.y.push(sy);
      pts.i.push(k);
    }
    const n = pts.x.length;
    drawScatter(ctx, pts.x, pts.y, row.color, { radius: n > 5000 ? 2.5 : n > 500 ? 3.25 : 4 });
    curves.push({ rowId: row.id, kind: 'scatter', color: row.color, lines: [], points: pts, result: r });
  }

  // ---- discrete distributions (Phase 7b) -----------------------------------------------
  // y = binompdf(10, 0.3, x) and the like are drawn as stems at whole numbers: each stem
  // is a one-point "line" (so it can be tapped and traced), drawn down to the axis.
  const MAX_STEMS = 4000;
  // Also the points of a sequence (Phase 9b), from n = lowest.
  function stemPoints(f, lowest = -Infinity) {
    const { xMin, xMax } = worldBounds(vp);
    const lo = Math.max(lowest, Math.ceil(vp.logX ? Math.max(xMin, 1) : xMin));
    const hi = Math.floor(xMax);
    if (!(hi >= lo)) return [];
    const every = Math.max(1, Math.ceil((hi - lo + 1) / MAX_STEMS));
    const out = [];
    for (let k = lo; k <= hi; k += every) {
      const y = f(k);
      if (!Number.isFinite(y)) continue;
      const [sx, sy] = toScreen(vp, k, y);
      if (Number.isFinite(sx) && Number.isFinite(sy)) out.push({ x: [sx], y: [sy], t: [k] });
    }
    return out;
  }
  function drawStems(all, color) {
    // Zero-height stems (outside the distribution's support) stay traceable but aren't drawn.
    const points = all.filter((p) => Math.abs(p.y[0] - baselineY()) > 0.5);
    if (!points.length) return;
    const base = baselineY();
    const spacing = all.length > 1 ? Math.abs(all[1].x[0] - all[0].x[0]) : Infinity;
    const stems = points.map((p) => ({ x: [p.x[0], p.x[0]], y: [Number.isFinite(base) ? base : vp.height + FILL_EDGE, p.y[0]] }));
    drawLines(ctx, stems, color, spacing < 4 ? 1 : 2);
    if (spacing >= 6) {
      const r = spacing >= 14 ? 4 : 2.5;
      drawScatter(ctx, points.map((p) => p.x[0]), points.map((p) => p.y[0]), color, { radius: r });
    }
  }

  // ---- sequences (Phase 9b) -----------------------------------------------------------------
  // Terms as dots, smaller when they are close together.
  function drawSequenceDots(points, color) {
    if (!points.length) return;
    const spacing = points.length > 1 ? Math.abs(points[1].x[0] - points[0].x[0]) : Infinity;
    const radius = spacing >= 14 ? 4 : spacing >= 6 ? 3 : 1.75;
    drawScatter(ctx, points.map((p) => p.x[0]), points.map((p) => p.y[0]), color, { radius });
  }

  // A cobweb diagram: y = g(x), the line y = x and the staircase of the terms, drawn a
  // step at a time while ▷ plays.
  function drawCobweb(row, r, analysis) {
    const { g, u0 } = r.cobweb;
    const lines = sampleCartesian(g, vp);
    drawLines(ctx, lines, row.color, 2.5);
    curves.push({ rowId: `${row.id}#g`, kind: 'cartesian', color: row.color, lines, result: { kind: 'cartesian', f: g } });
    drawLines(ctx, sampleCartesian((x) => x, vp), colors.label, 1.5, { dash: [6, 5], alpha: 0.75 });
    const wanted = cobwebSteps(fieldValue(analysis, row.cobwebN));
    if (wanted.error) return;
    const playing = cobwebPlayer ? cobwebPlayer.value(row.id) : null;
    const steps = playing ?? wanted.steps;
    const path = cobwebPath(g, u0, steps);
    const xs = [];
    const ys = [];
    for (let k = 0; k < path.xs.length; k++) {
      const [sx, sy] = toScreen(vp, path.xs[k], path.ys[k]);
      xs.push(sx);
      ys.push(vp.logY && path.ys[k] <= 0 ? vp.height + FILL_EDGE : sy);
    }
    drawLines(ctx, [{ x: xs, y: ys }], row.color, 1.75, { alpha: 0.9 });
    const [sx0, sy0] = [xs[0], ys[0]];
    if (Number.isFinite(sx0) && Number.isFinite(sy0)) drawPoi(ctx, sx0, sy0, row.color, colors, true);
    // While playing, the term just reached.
    if (playing !== null && path.xs.length > 1) {
      const n = (path.xs.length - 1) / 2;
      const k = path.xs.length - 1;
      const [sx, sy] = toScreen(vp, path.xs[k], path.ys[k]);
      const sub = String(r.lowest + n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[d]);
      if (Number.isFinite(sx) && Number.isFinite(sy)) drawMarker(ctx, sx, sy, row.color, `${r.name}${sub} = ${formatNumber(path.ys[k], 6)}`, colors, vp.width, vp.height);
    }
  }

  // A draggable point under the finger: within a 44 px target on touch (Phase 6a).
  function hitHandle(sx, sy, pointerType) {
    const radius = pointerType === 'mouse' ? 12 : 22;
    let best = null;
    for (const hd of drawnHandles) {
      const d = Math.hypot(hd.sx - sx, hd.sy - sy);
      if (d <= radius && (!best || d < best.d)) best = { d, hd };
    }
    return best && best.hd;
  }

  function endPointDrag() {
    if (!gesture || gesture.type !== 'point') return;
    pointDrag.end(gesture.session);
    gesture = null;
    if (interacting) {
      interacting = false;
    }
    requestDraw();
  }

  // Grid sampling is the slow part of drawing implicit curves and regions; redraws for
  // the same view (tracing, sweeps, row focus) reuse the last result.
  const memoCache = new WeakMap(); // function -> { vp, cell, kind, value }
  function memo(fn, kind, compute) {
    const cell = interacting ? 8 : 4;
    const c = memoCache.get(fn);
    if (c && c.vp === vp && c.cell === cell && c.kind === kind && renderScale === 0) return c.value;
    const value = compute();
    if (renderScale === 0) memoCache.set(fn, { vp, cell, kind, value });
    return value;
  }

  // ---- inequalities, slope fields (D41–D43) ---------------------------------------------------
  function drawInequality(row, r) {
    const color = row.color;
    const dash = r.strict ? STRICT_DASH : null;
    if (r.form === 'y' || r.form === 'x') {
      // Exact: fill between the boundary curve and the edge of the graph. On a log axis
      // a boundary at or below 0 lies beyond the low edge, so it is drawn there (as the
      // smallest positive number), which keeps the region above it shaded.
      const logged = r.form === 'y' ? vp.logY : vp.logX;
      const f = logged ? (v) => { const w = r.f(v); return w <= 0 ? Number.MIN_VALUE : w; } : r.f;
      const lines = r.form === 'y' ? sampleCartesian(f, vp) : sampleCartesianX(f, vp);
      ctx.save();
      ctx.fillStyle = color;
      ctx.globalAlpha = REGION_ALPHA;
      ctx.beginPath();
      const LIM = 20000;
      const cl = (v) => Math.max(-LIM, Math.min(LIM, v));
      for (const { x, y } of lines) {
        if (x.length < 2) continue;
        if (r.form === 'y') {
          const edge = r.above ? -10 : vp.height + 10;
          ctx.moveTo(cl(x[0]), edge);
          for (let i = 0; i < x.length; i++) ctx.lineTo(cl(x[i]), cl(y[i]));
          ctx.lineTo(cl(x[x.length - 1]), edge);
        } else {
          const edge = r.above ? vp.width + 10 : -10;
          ctx.moveTo(edge, cl(y[0]));
          for (let i = 0; i < x.length; i++) ctx.lineTo(cl(x[i]), cl(y[i]));
          ctx.lineTo(edge, cl(y[y.length - 1]));
        }
        ctx.closePath();
      }
      ctx.fill();
      ctx.restore();
      drawLines(ctx, lines, color, 2.5, { dash });
      return;
    }
    // General: shade grid cells where the test holds, then draw each comparison's edge
    // where the other comparisons hold.
    const cell = interacting ? 8 : 4;
    const rects = memo(r.test, 'r', () => regionRects(r.test, vp, { cell }));
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = REGION_ALPHA;
    ctx.beginPath();
    for (const [x, y, w, hgt] of rects) ctx.rect(x, y, w, hgt);
    ctx.fill();
    ctx.restore();
    r.edges.forEach((edge, k) => {
      const keep = r.edges.length > 1 ? (x, y) => r.testExcept(k, x, y) : null;
      const lines = memo(edge.F, 'c', () => contour(edge.F, vp, { cell, keep }));
      drawLines(ctx, lines, color, 2.5, { dash: edge.strict ? STRICT_DASH : null });
    });
  }

  function drawSlopeField(row, r) {
    // Marks sit on a grid fixed to the plane in axis coordinates (evenly spaced on
    // screen, also on log axes), so they don't swim when panning. Each points along the
    // slope as it appears on the graph: the screen direction of (1, f) at that point.
    const [u0, u1] = axisRange(vp, 'x');
    const [v0, v1] = axisRange(vp, 'y');
    const stepU = SLOPE_SPACING / vp.scaleX;
    const stepV = SLOPE_SPACING / vp.scaleY;
    const half = SLOPE_SPACING * 0.3;
    ctx.save();
    ctx.strokeStyle = row.color;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let gu = Math.ceil(u0 / stepU) * stepU; gu <= u1; gu += stepU) {
      const gx = fromAxisX(vp, gu);
      for (let gv = Math.ceil(v0 / stepV) * stepV; gv <= v1; gv += stepV) {
        const gy = vp.logY ? 10 ** gv : gv;
        const m = r.f(gx, gy);
        if (!Number.isFinite(m)) continue;
        const [sx, sy] = toScreen(vp, gx, gy);
        const vx = pxPerUnitX(vp, gx);
        const vy = -m * pxPerUnitY(vp, gy);
        const len = Math.hypot(vx, vy);
        if (!(len > 0) || !Number.isFinite(len)) continue;
        const ux = (vx / len) * half;
        const uy = (vy / len) * half;
        ctx.moveTo(sx - ux, sy - uy);
        ctx.lineTo(sx + ux, sy + uy);
      }
    }
    ctx.stroke();
    ctx.restore();

    // Solution curves through the row's starting points, integrated in axis
    // coordinates (dv/du; the same as dy/dx on linear axes), so the steps are even on
    // screen whichever axes are log.
    const g = slopeInAxes(vp, r.f);
    const h = v1 - v0;
    for (const [x0, y0] of row.odePoints || []) {
      const a0 = axisX(vp, x0);
      const b0 = axisY(vp, y0);
      if (!Number.isFinite(a0) || !Number.isFinite(b0)) continue;
      const p = solutionThrough(g, a0, b0, u0, u1, {
        steps: interacting ? 300 : 900, yMin: v0 - h, yMax: v1 + h, maxJump: 40 / vp.scaleY,
      });
      const xs = [];
      const ys = [];
      for (let i = 0; i < p.x.length; i++) {
        xs.push(vp.width / 2 + (p.x[i] - vp.cx) * vp.scaleX);
        ys.push(vp.height / 2 - (p.y[i] - vp.cy) * vp.scaleY);
      }
      drawLines(ctx, [{ x: xs, y: ys }], row.color, 2.5);
      const [sx, sy] = toScreen(vp, x0, y0);
      drawPoi(ctx, sx, sy, row.color, colors, true);
    }
  }

  // ---- θ / t sweep (D40) ------------------------------------------------------------------------
  // A polar or parametric curve drawn as its parameter runs from the start of its range
  // to the end: the rest of the curve shows faintly, with a dot (and, for polar curves,
  // the radius from the origin) at the current point.
  const SWEEP_MS = 4000;
  const sweeps = new Map(); // row id -> { start, frac }
  const sweepListeners = new Set();
  let sweepRaf = 0;

  function sweepFrame(now) {
    sweepRaf = 0;
    for (const [id, sw] of sweeps) {
      if (!sw.start) sw.start = now;
      sw.frac = Math.min(1, (now - sw.start) / SWEEP_MS);
      if (sw.frac >= 1) sweeps.delete(id);
    }
    draw();
    if (sweeps.size) sweepRaf = requestAnimationFrame(sweepFrame);
    else for (const l of sweepListeners) l();
  }

  function toggleSweep(rowId) {
    if (sweeps.has(rowId)) sweeps.delete(rowId);
    else sweeps.set(rowId, { start: 0, frac: 0 });
    if (sweeps.size && !sweepRaf) sweepRaf = requestAnimationFrame(sweepFrame);
    if (!sweeps.size) requestDraw();
    for (const l of sweepListeners) l();
  }

  function drawSweep(row, r, lines, frac, angleFactor) {
    const { min, max } = r.domain;
    const p = min + frac * (max - min);
    drawLines(ctx, lines, row.color, 2.5, { alpha: 0.18 });
    if (frac > 0) {
      const part = r.kind === 'polar'
        ? samplePolar(r.f, min, p, vp, angleFactor)
        : sampleParametric(r.fx, r.fy, min, p, vp);
      drawLines(ctx, part, row.color);
    }
    let wx;
    let wy;
    if (r.kind === 'polar') {
      const rad = r.f(p);
      wx = rad * Math.cos(p * angleFactor);
      wy = rad * Math.sin(p * angleFactor);
    } else {
      wx = r.fx(p);
      wy = r.fy(p);
    }
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
    const [sx, sy] = toScreen(vp, wx, wy);
    if (r.kind === 'polar' && !vp.logX && !vp.logY) {
      const [ox, oy] = toScreen(vp, 0, 0);
      drawLines(ctx, [{ x: [ox, sx], y: [oy, sy] }], row.color, 1.5, { dash: [5, 4], alpha: 0.8 });
    }
    const name = r.kind === 'polar' ? 'θ' : 't';
    drawMarker(ctx, sx, sy, row.color, `${name} = ${formatNumber(p, 4)}`, colors, vp.width, vp.height);
  }

  // ---- data sets and fits -----------------------------------------------------------------

  // Fitted curves, traceable like y = f(x) graphs, with 95% confidence bands (shaded)
  // and prediction bands (dashed) when asked for.
  function drawFits() {
    for (const { fit, result } of getFits()) {
      if (fit.bands !== 'none' && result.meanVar && Number.isFinite(result.q)) drawBands(fit, result);
      const lines = sampleCartesian(result.f, vp);
      drawLines(ctx, lines, fit.color, 2.5);
      curves.push({ rowId: `fit:${fit.id}`, kind: 'cartesian', color: fit.color, lines, result: { kind: 'cartesian', f: result.f } });
    }
  }

  // Points of the visible data sets (left-out points as rings) with σy error bars. Each
  // set becomes a 'scatter' entry in curves so its points can be tapped and traced.
  function drawData(state) {
    const sets = state.data ? state.data.sets : [];
    let boxes = 0;
    for (const set of sets) {
      if (set.hidden) continue;
      if (set.display === 'histogram') {
        drawHistogram(set);
        continue;
      }
      if (set.display === 'box') {
        drawBoxPlot(set, boxes++, state.settings.quartiles);
        continue;
      }
      const on = { x: [], y: [] };
      const off = { x: [], y: [] };
      const bars = { x: [], lo: [], hi: [] };
      const all = { x: [], y: [], i: [] };
      set.points.forEach((p, i) => {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
        const [sx, sy] = toScreen(vp, p.x, p.y);
        if (!Number.isFinite(sx) || !Number.isFinite(sy)) return; // ≤ 0 on a log axis
        const target = p.off ? off : on;
        target.x.push(sx);
        target.y.push(sy);
        all.x.push(sx);
        all.y.push(sy);
        all.i.push(i);
        if (set.hasSigma && p.s > 0) {
          bars.x.push(sx);
          bars.lo.push(fillY(p.y - p.s));
          bars.hi.push(fillY(p.y + p.s));
        }
      });
      const n = all.x.length;
      const radius = n > 5000 ? 2.5 : n > 500 ? 3.25 : 4;
      drawErrorBars(ctx, bars.x, bars.lo, bars.hi, set.color);
      drawScatter(ctx, off.x, off.y, set.color, { radius, hollow: true, alpha: 0.7 });
      drawScatter(ctx, on.x, on.y, set.color, { radius });
      curves.push({ rowId: `set:${set.id}`, kind: 'scatter', color: set.color, lines: [], points: all, result: { kind: 'scatter', set } });
    }
  }

  // A histogram of one column of a data set (Phase 7b): bars from the axis (the bottom
  // edge on a log y axis) to each bin's count. Each bar's top is tappable.
  function drawHistogram(set) {
    const h = setHistogram(set);
    if (!h) return;
    const { start, width, counts } = h.hist;
    const base = baselineY();
    const tops = { x: [], y: [], i: [] };
    const bins = [];
    ctx.save();
    ctx.beginPath();
    counts.forEach((c, k) => {
      const lo = start + k * width;
      const hi = lo + width;
      bins.push({ lo, hi, count: c });
      if (c === 0) return;
      const x0 = screenX(vp, lo);
      const x1 = screenX(vp, hi);
      const top = fillY(c);
      if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(top)) return;
      if (Math.max(x0, x1) < -2 || Math.min(x0, x1) > vp.width + 2) return;
      ctx.rect(Math.min(x0, x1), Math.min(top, base), Math.abs(x1 - x0), Math.abs(base - top));
      tops.x.push((x0 + x1) / 2);
      tops.y.push(top);
      tops.i.push(k);
    });
    ctx.fillStyle = set.color;
    ctx.globalAlpha = 0.3;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = set.color;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.restore();
    curves.push({ rowId: `set:${set.id}`, kind: 'scatter', color: set.color, lines: [], points: tops, result: { kind: 'bins', set, bins, column: h.column } });
  }

  // A horizontal box plot of one column (Phase 7b), in a band near the top of the graph:
  // its height and place are fixed on screen, its ends follow the x axis. Whiskers reach
  // the furthest values within 1.5 × IQR; values beyond are drawn as rings.
  const BOX_TOP = 84; // px: clear of the buttons along the top
  const BOX_H = 26;
  const BOX_GAP = 46;
  function boxBand(index) {
    const mid = BOX_TOP + BOX_H / 2 + index * BOX_GAP;
    return { mid, top: mid - BOX_H / 2, bottom: mid + BOX_H / 2 };
  }
  function drawBoxPlot(set, index, method) {
    const column = set.histColumn === 'y' ? 'y' : 'x';
    const b = boxPlot(columnValues(set, column), method);
    if (!b) return;
    const { mid, top, bottom } = boxBand(index);
    const X = (v) => screenX(vp, v);
    const [q1, med, q3, lo, hi] = [b.q1, b.median, b.q3, b.lo, b.hi].map(X);
    ctx.save();
    ctx.strokeStyle = set.color;
    ctx.fillStyle = set.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Whiskers with end caps (parts at x ≤ 0 on a log axis are left out).
    if (Number.isFinite(lo) && Number.isFinite(q1)) { ctx.moveTo(lo, mid); ctx.lineTo(q1, mid); ctx.moveTo(lo, mid - 7); ctx.lineTo(lo, mid + 7); }
    if (Number.isFinite(hi) && Number.isFinite(q3)) { ctx.moveTo(q3, mid); ctx.lineTo(hi, mid); ctx.moveTo(hi, mid - 7); ctx.lineTo(hi, mid + 7); }
    ctx.stroke();
    if (Number.isFinite(q1) && Number.isFinite(q3)) {
      ctx.globalAlpha = 0.2;
      ctx.fillRect(q1, top, q3 - q1, BOX_H);
      ctx.globalAlpha = 1;
      ctx.strokeRect(q1, top, q3 - q1, BOX_H);
    }
    if (Number.isFinite(med)) {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(med, top);
      ctx.lineTo(med, bottom);
      ctx.stroke();
    }
    ctx.restore();
    const outX = b.outliers.map(X).filter(Number.isFinite);
    drawScatter(ctx, outX, outX.map(() => mid), set.color, { radius: 4, hollow: true });
    // The name, small, above the box.
    ctx.save();
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillStyle = set.color;
    const nameX = Math.min(Math.max(Number.isFinite(lo) ? lo : 8, 8), vp.width - 60);
    ctx.lineWidth = 3;
    ctx.strokeStyle = colors.bg;
    const label = `${set.name} (${column})`;
    ctx.strokeText(label, nameX, top - 3);
    ctx.fillText(label, nameX, top - 3);
    ctx.restore();
    // Tappable: the five numbers and each outlier.
    const marks = [['Minimum', b.min], ['Q1', b.q1], ['Median', b.median], ['Q3', b.q3], ['Maximum', b.max]];
    if (b.lo !== b.min) marks.push(['Lower whisker', b.lo]);
    if (b.hi !== b.max) marks.push(['Upper whisker', b.hi]);
    const pts = { x: [], y: [], i: [] };
    marks.forEach(([, v], k) => {
      const sx = X(v);
      if (Number.isFinite(sx)) { pts.x.push(sx); pts.y.push(mid); pts.i.push(k); }
    });
    curves.push({ rowId: `set:${set.id}`, kind: 'scatter', color: set.color, lines: [], points: pts, result: { kind: 'box', set, marks, mid, column } });
  }

  function drawBands(fit, r) {
    const N = Math.max(60, Math.round(vp.width / 3));
    const xs = new Array(N + 1);
    const cLo = new Array(N + 1);
    const cHi = new Array(N + 1);
    const pLo = new Array(N + 1);
    const pHi = new Array(N + 1);
    const pred = fit.bands === 'both' && !r.weighted && Number.isFinite(r.s);
    for (let k = 0; k <= N; k++) {
      // Evenly spaced across the screen (so in log x on a log axis).
      xs[k] = (vp.width * k) / N;
      const x = toWorld(vp, xs[k], 0)[0];
      const y = r.f(x);
      const v = r.meanVar(x);
      const okv = Number.isFinite(y) && Number.isFinite(v) && v >= 0;
      const half = okv ? r.q * Math.sqrt(v) : NaN;
      cLo[k] = okv ? fillY(y - half) : NaN;
      cHi[k] = okv ? fillY(y + half) : NaN;
      if (pred) {
        const ph = okv ? r.q * Math.sqrt(v + r.s * r.s) : NaN;
        pLo[k] = okv ? screenY(vp, y - ph) : NaN;
        pHi[k] = okv ? screenY(vp, y + ph) : NaN;
      }
    }
    fillBand(ctx, xs, cLo, cHi, fit.color, 0.16);
    if (pred) {
      const runs = (ys) => {
        const out = [];
        let cur = null;
        ys.forEach((y, k) => {
          if (Number.isFinite(y)) {
            if (!cur) out.push(cur = { x: [], y: [] });
            cur.x.push(xs[k]);
            cur.y.push(y);
          } else cur = null;
        });
        return out;
      };
      drawLines(ctx, [...runs(pLo), ...runs(pHi)], fit.color, 1.5, { dash: [6, 5], alpha: 0.7 });
    }
  }

  // ---- analysis overlays ---------------------------------------------------------------

  function drawShading(row, r, analysis, angleFactor) {
    const a = fieldValue(analysis, row.intFrom);
    const b = fieldValue(analysis, row.intTo);
    if (isFunctionOfX(r) && r.discrete) {
      // Stems of a discrete distribution: shade bars at the whole numbers in the range,
      // the probability the panel's Σ adds up (Phase 7b).
      if (a === null || b === null) return;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const pts = stemPoints(r.f).filter((p) => p.t[0] >= lo - 1e-9 && p.t[0] <= hi + 1e-9);
      if (!pts.length) return;
      const step = Math.abs(screenX(vp, pts[0].t[0] + 1) - screenX(vp, pts[0].t[0]));
      const w = Math.max(2, Math.min(step * 0.7, 18));
      const base = baselineY();
      ctx.save();
      ctx.fillStyle = row.color;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      for (const p of pts) ctx.rect(p.x[0] - w / 2, Math.min(p.y[0], base), w, Math.abs(base - p.y[0]));
      ctx.fill();
      ctx.restore();
      return;
    }
    if (isFunctionOfX(r)) {
      // A Riemann sum replaces the smooth shading with its rectangles (Phase 6b).
      const rs = row.riemann ? riemannOf(row, r, analysis) : null;
      if (rs && rs.res && rs.res.ok) {
        drawRiemann(rs, row.color);
        return;
      }
      if (a === null || b === null || a === b) return;
      const [u0, u1] = axisRange(vp, 'x');
      const pad = 2 / vp.scaleX;
      const lo = Math.max(Math.min(a, b), fromAxisX(vp, u0 - pad));
      const hi = Math.min(Math.max(a, b), fromAxisX(vp, u1 + pad));
      if (!(hi > lo)) return;
      // On a log y axis the curve is clamped to just below the graph where it is ≤ 0,
      // so the shading runs down to the bottom edge, its baseline.
      const fy = vp.logY ? (x) => { const y = r.f(x); return y <= 0 ? Number.MIN_VALUE : y; } : r.f;
      const width = Math.abs(screenX(vp, hi) - screenX(vp, lo));
      const lines = sampleXRange(fy, lo, hi, vp, { initial: Math.max(20, (Number.isFinite(width) ? width : vp.width) / 3), maxDepth: 5 });
      fillToBaseline(ctx, lines, baselineY(), row.color, 0.2);
    } else if (r.kind === 'polar') {
      if (vp.logX || vp.logY) return; // polar areas are swept from the origin
      const from = a ?? r.domain.min;
      const to = b ?? r.domain.max;
      if (!(to > from)) return;
      const lines = samplePolar(r.f, from, to, vp, angleFactor);
      const [ox, oy] = toScreen(vp, 0, 0);
      fillFan(ctx, lines, ox, oy, row.color, 0.18);
    }
  }

  // Rectangles (or trapezia) between the axis and the curve, with the points each
  // height was taken at.
  function drawRiemann(rs, color) {
    const { edges, heights } = rs.res;
    const LIM = 20000;
    const cl = (v) => Math.max(-LIM, Math.min(LIM, v));
    const base = cl(baselineY());
    const X = (x) => cl(screenX(vp, x));
    const Y = (y) => cl(fillY(y));
    ctx.save();
    ctx.beginPath();
    const dots = [];
    for (let k = 0; k < edges.length - 1; k++) {
      const x0 = X(edges[k]);
      const x1 = X(edges[k + 1]);
      if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue; // x ≤ 0 on a log axis
      if (Math.max(x0, x1) < -2 || Math.min(x0, x1) > vp.width + 2) continue;
      if (rs.method === 'trap') {
        ctx.moveTo(x0, base);
        ctx.lineTo(x0, Y(heights[k]));
        ctx.lineTo(x1, Y(heights[k + 1]));
        ctx.lineTo(x1, base);
        ctx.closePath();
      } else {
        const y = Y(heights[k]);
        ctx.rect(Math.min(x0, x1), Math.min(y, base), Math.abs(x1 - x0), Math.abs(base - y));
        const xs = rs.method === 'left' ? edges[k] : rs.method === 'right' ? edges[k + 1] : (edges[k] + edges[k + 1]) / 2;
        dots.push([X(xs), y]);
      }
    }
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Sample points, when the rectangles are wide enough to show them.
    if (dots.length && Math.abs(X(edges[edges.length - 1]) - X(edges[edges.length - 2])) >= 6) {
      ctx.beginPath();
      for (const [x, y] of dots) {
        ctx.moveTo(x + 2.5, y);
        ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  // A straight line through (x0, y0) with gradient m, across the view. On log axes a
  // straight line is a curve, so it is sampled like one.
  function fullLine(x0, y0, m, color, width, opts) {
    if (vp.logX || vp.logY) {
      drawLines(ctx, sampleCartesian((x) => y0 + m * (x - x0), vp), color, width, opts);
      return;
    }
    const { xMin, xMax } = worldBounds(vp);
    const p0 = toScreen(vp, xMin, y0 + m * (xMin - x0));
    const p1 = toScreen(vp, xMax, y0 + m * (xMax - x0));
    drawLines(ctx, [{ x: [p0[0], p1[0]], y: [p0[1], p1[1]] }], color, width, opts);
  }

  // Taylor polynomial (dashed) and secant → tangent (Phase 6b).
  function drawCalculus(row, r, analysis) {
    const tp = row.taylor ? taylorOf(row, r, analysis) : null;
    if (tp && tp.f) {
      drawLines(ctx, sampleCartesian(tp.f, vp), row.color, 2.25, { dash: [11, 6], alpha: 0.95 });
      const y0 = r.f(tp.x0);
      if (Number.isFinite(y0)) {
        const [sx, sy] = toScreen(vp, tp.x0, y0);
        drawPoi(ctx, sx, sy, row.color, colors);
      }
    }
    const sc = row.secant ? secantOf(row, r, analysis, secantPlayer ? secantPlayer.value(row.id) : null) : null;
    if (sc && sc.ok) {
      // The tangent it approaches (drawn by the At x overlay when x comes from there).
      if (!sc.fromAtX && Number.isFinite(sc.slope)) fullLine(sc.x0, sc.y0, sc.slope, row.color, 1.5, { alpha: 0.45 });
      if (Number.isFinite(sc.m)) fullLine(sc.x0, sc.y0, sc.m, row.color, 2, { dash: [4, 4], alpha: 0.95 });
      for (const [x, y] of [[sc.x0, sc.y0], [sc.x0 + sc.h, sc.y1]]) {
        const [sx, sy] = toScreen(vp, x, y);
        drawPoi(ctx, sx, sy, row.color, colors, true);
      }
    }
  }

  function drawOverlays(row, r, analysis) {
    drawCalculus(row, r, analysis);
    const d = row.showDeriv || row.atX ? r.derivative() : null;
    if (row.showDeriv && d) {
      drawLines(ctx, sampleCartesian(d.f, vp), row.color, 2, { dash: [7, 6], alpha: 0.85 });
    }
    const a = fieldValue(analysis, row.atX);
    if (a === null) return;
    const y0 = r.f(a);
    if (!Number.isFinite(y0)) return;
    const m = d ? d.f(a) : NaN;
    if (Number.isFinite(m)) fullLine(a, y0, m, row.color, 1.5, { alpha: 0.75 });
    const [sx, sy] = toScreen(vp, a, y0);
    drawPoi(ctx, sx, sy, row.color, colors, true);
  }

  // ---- points of interest ----------------------------------------------------------------

  // Points of interest for one y = f(x) curve in the visible x range, cached per view.
  // others: [{ id, f, df }] for intersections. Returns null while the view is moving
  // and nothing is cached (it is computed once the gesture ends).
  function computePois(rowId, r, others, allowCompute = true) {
    const analysis = getAnalysis();
    if (poiCache.analysis !== analysis) {
      poiCache.analysis = analysis;
      poiCache.map.clear();
    }
    const { xMin, xMax } = worldBounds(vp);
    const key = `${xMin}|${xMax}|${others.map((o) => o.id).join(',')}`;
    const hit = poiCache.map.get(rowId);
    if (hit && hit.key === key) return hit.value;
    if (r.discrete || r.asSequence) return []; // stems and sequences: roots and extrema mean nothing
    if (!allowCompute) return null;
    const d = r.derivative ? r.derivative() : null;
    const samples = Math.round(Math.min(800, Math.max(200, vp.width)));
    let value;
    if (vp.logX) {
      // Search evenly in log x: f(10^u) has the same roots, extrema and intersections,
      // and its derivative is f′(x)·x·ln 10. There is no y-intercept on a log x axis.
      const [u0, u1] = axisRange(vp, 'x');
      const wrap = (fn) => (fn ? (u) => fn(10 ** u) : undefined);
      const dwrap = (fn) => (fn ? (u) => { const x = 10 ** u; return fn(x) * x * Math.LN10; } : undefined);
      const found = pointsOfInterest({ f: wrap(r.f), df: dwrap(d && d.f) }, u0, u1, {
        others: others.map((o) => ({ ...o, f: wrap(o.f), df: dwrap(o.df) })), samples,
      });
      value = found.filter((p) => p.kind !== 'y-intercept').map((p) => ({ ...p, x: 10 ** p.x }));
    } else {
      value = pointsOfInterest({ f: r.f, df: d ? d.f : undefined }, xMin, xMax, { others, samples });
    }
    poiCache.map.set(rowId, { key, value });
    return value;
  }

  function othersFor(rowId, visible) {
    const out = [];
    for (const { row, r } of visible) {
      if (row.id === rowId || !isFunctionOfX(r)) continue;
      const d = r.derivative ? r.derivative() : null;
      out.push({ id: row.id, f: r.f, df: d ? d.f : undefined });
    }
    return out;
  }

  function labelFor(kinds, x, y) {
    return `${kinds.map((k) => POI_NAMES[k]).join(' · ')} (${formatNumber(x, 7)}, ${formatNumber(y, 7)})`;
  }

  // Merge points that coincide on screen (a double root is also a minimum, etc.).
  function mergePois(pois) {
    const out = [];
    for (const p of pois) {
      const [sx, sy] = toScreen(vp, p.x, p.y);
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx < -10 || sx > vp.width + 10 || sy < -10 || sy > vp.height + 10) continue;
      const same = out.find((q) => Math.hypot(q.sx - sx, q.sy - sy) < 3);
      if (same) {
        if (!same.kinds.includes(p.kind)) same.kinds.push(p.kind);
      } else {
        out.push({ ...p, sx, sy, kinds: [p.kind] });
      }
    }
    return out;
  }

  function drawPointsOfInterest(visible) {
    drawnPois = [];
    const ids = new Set();
    if (selectedId !== null) ids.add(selectedId);
    for (const { row, r } of visible) if (row.showAnalysis && isFunctionOfX(r)) ids.add(row.id);
    for (const { row, r } of visible) {
      if (!ids.has(row.id) || !isFunctionOfX(r)) continue;
      const others = row.id === selectedId ? othersFor(row.id, visible) : [];
      const pois = computePois(row.id, r, others, !interacting);
      if (!pois) continue;
      for (const p of mergePois(pois)) {
        const label = labelFor(p.kinds, p.x, p.y);
        drawPoi(ctx, p.sx, p.sy, row.color, colors);
        drawnPois.push({ rowId: row.id, sx: p.sx, sy: p.sy, x: p.x, y: p.y, label, color: row.color });
      }
    }
  }

  function drawSelectedPoi() {
    if (!poiSel) return;
    const [sx, sy] = toScreen(vp, poiSel.x, poiSel.y);
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
    drawMarker(ctx, sx, sy, poiSel.color, poiSel.label, colors, vp.width, vp.height);
  }

  function hitPoi(sx, sy, pointerType) {
    const radius = pointerType === 'mouse' ? 9 : 20;
    let best = null;
    for (const p of drawnPois) {
      const d = Math.hypot(p.sx - sx, p.sy - sy);
      if (d <= radius && (!best || d < best.d)) best = { d, p };
    }
    return best && best.p;
  }

  function drawTrace(analysis) {
    if (!trace) return;
    const c = curves.find((k) => k.rowId === trace.rowId);
    if (!c) {
      trace = null;
      return;
    }
    const pos = tracePosition(c.result, trace, analysis.angle);
    if (!pos) return;
    const [sx, sy] = toScreen(vp, pos.x, pos.y);
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
    const label = c.label ? `${c.label}: ${pos.label}` : pos.label;
    drawMarker(ctx, sx, sy, c.color, label, colors, vp.width, vp.height);
  }

  function tracePosition(r, tr, angle) {
    // The size of a pixel in world units, where the point is (it varies on a log axis).
    const pxAt = (x) => 1 / pxPerUnitX(vp, x);
    const pyAt = (y) => 1 / pxPerUnitY(vp, y);
    const fmt = (x, y) => `(${formatCoordinate(x, pxAt(x))}, ${formatCoordinate(y, pyAt(y))})`;
    switch (r.kind) {
      case 'cartesian':
      case 'function': {
        const y = r.f(tr.x);
        return Number.isFinite(y) ? { x: tr.x, y, label: fmt(tr.x, y) } : null;
      }
      case 'sequence': {
        const y = r.f(tr.x);
        return Number.isFinite(y) ? { x: tr.x, y, label: `${r.name}(${formatNumber(tr.x, 8)}) = ${formatNumber(y, 8)}` } : null;
      }
      case 'cartesian-x': {
        const x = r.f(tr.y);
        return Number.isFinite(x) ? { x, y: tr.y, label: fmt(x, tr.y) } : null;
      }
      case 'parametric': {
        const x = r.fx(tr.t);
        const y = r.fy(tr.t);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y, label: fmt(x, y) } : null;
      }
      case 'polar': {
        const rad = r.f(tr.t);
        if (!Number.isFinite(rad)) return null;
        const a = angle === 'deg' ? (tr.t * Math.PI) / 180 : tr.t;
        const theta = angle === 'deg' ? `${formatNumber(tr.t, 4)}°` : formatCoordinate(tr.t, 0.001);
        const x = rad * Math.cos(a);
        const y = rad * Math.sin(a);
        return { x, y, label: `r = ${formatCoordinate(rad, Math.min(pxAt(x), pyAt(y)))}, θ = ${theta}` };
      }
      case 'point':
        return { x: r.x, y: r.y, label: fmt(r.x, r.y) };
      case 'implicit':
        return { x: tr.x, y: tr.y, label: fmt(tr.x, tr.y) };
      case 'bins': {
        const b = r.bins[tr.i];
        if (!b) return null;
        const label = `${formatNumber(b.lo, 6)} ≤ ${r.column} < ${formatNumber(b.hi, 6)}: ${b.count}`;
        return { x: (b.lo + b.hi) / 2, y: b.count, label };
      }
      case 'box': {
        const m = r.marks[tr.i];
        if (!m) return null;
        return { x: m[1], y: toWorld(vp, 0, r.mid)[1], label: `${m[0]}: ${formatNumber(m[1], 8)}` };
      }
      case 'points': {
        const x = r.xs[tr.i];
        const y = r.ys[tr.i];
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y, label: `(${formatNumber(x, 8)}, ${formatNumber(y, 8)})` } : null;
      }
      case 'scatter': {
        const p = r.set.points[tr.i];
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
        const sig = r.set.hasSigma && p.s > 0 ? ` ± ${formatNumber(p.s, 4)}` : '';
        return { x: p.x, y: p.y, label: `(${formatNumber(p.x, 8)}, ${formatNumber(p.y, 8)}${sig})${p.off ? ' · left out' : ''}` };
      }
      default:
        return null;
    }
  }

  // Nearest data point of a scatter entry to (sx, sy): { i, dist }.
  function nearestPoint(curve, sx, sy) {
    const { x, y, i } = curve.points;
    let best = null;
    for (let k = 0; k < x.length; k++) {
      const d = Math.hypot(x[k] - sx, y[k] - sy);
      if (!best || d < best.dist) best = { i: i[k], dist: d };
    }
    return best;
  }

  // ---- hit testing -------------------------------------------------------------------
  function hitCurve(sx, sy, pointerType) {
    const radius = pointerType === 'mouse' ? 10 : 24;
    let best = null;
    for (const c of curves) {
      const hit = c.kind === 'scatter' ? nearestPoint(c, sx, sy) : nearestOnLines(c.lines, sx, sy);
      if (hit && hit.dist <= (c.kind === 'point' || c.kind === 'scatter' ? radius + 6 : radius) && (!best || hit.dist < best.hit.dist)) {
        best = { curve: c, hit };
      }
    }
    return best;
  }

  function setTraceFrom(curve, sx, sy) {
    const [wx, wy] = toWorld(vp, sx, sy);
    switch (curve.kind) {
      case 'cartesian':
      case 'function':
      case 'sequence': {
        // Stems of a discrete distribution, and sequences: the nearest whole number.
        const hit = curve.result.discrete || curve.result.asSequence ? nearestOnLines(curve.lines, sx, sy) : null;
        if (curve.result.asSequence && !hit) break;
        trace = { rowId: curve.rowId, kind: curve.kind, x: hit ? hit.t : wx };
        break;
      }
      case 'cartesian-x':
        trace = { rowId: curve.rowId, kind: curve.kind, y: wy };
        break;
      case 'point':
        trace = { rowId: curve.rowId, kind: 'point' };
        break;
      case 'implicit': {
        const hit = nearestOnLines(curve.lines, sx, sy);
        if (!hit) break;
        const [hx, hy] = toWorld(vp, hit.x, hit.y);
        const kx = pxPerUnitX(vp, hx);
        const ky = pxPerUnitY(vp, hy);
        const snapped = snapToCurve(curve.result.F, hx, hy, 0.5 / Math.max(kx, ky));
        const [tx, ty] = snapped && Math.hypot((snapped[0] - hx) * kx, (snapped[1] - hy) * ky) < 3 ? snapped : [hx, hy];
        trace = { rowId: curve.rowId, kind: 'implicit', x: tx, y: ty };
        break;
      }
      case 'scatter': {
        const hit = nearestPoint(curve, sx, sy);
        if (hit) trace = { rowId: curve.rowId, kind: 'scatter', i: hit.i };
        break;
      }
      default: {
        const hit = nearestOnLines(curve.lines, sx, sy);
        if (hit) trace = { rowId: curve.rowId, kind: curve.kind, t: hit.t };
      }
    }
    requestDraw();
  }

  // ---- gestures ------------------------------------------------------------------------
  function localPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startPinch() {
    const [a, b] = [...pointers.values()];
    gesture = {
      type: 'pinch',
      vp0: vp,
      mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dist0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      endPointDrag();
      startPinch();
      return;
    }
    if (pointers.size > 2) return;
    if (armed) {
      gesture = { type: 'pan', vp0: vp, start: p, time: e.timeStamp, moved: false };
      return;
    }
    // A handle takes priority over everything else under the finger, including panning.
    const hd = pointDrag ? hitHandle(p.x, p.y, e.pointerType) : null;
    const session = hd ? pointDrag.begin(hd.rowId) : null;
    if (session) {
      gesture = {
        type: 'point', rowId: hd.rowId, session, start: p, time: e.timeStamp, moved: false,
        offset: { x: hd.sx - p.x, y: hd.sy - p.y },
      };
      trace = { rowId: hd.rowId, kind: 'point' };
      poiSel = null;
      canvas.style.cursor = 'grabbing';
      requestDraw();
      return;
    }
    const poi = hitPoi(p.x, p.y, e.pointerType);
    if (poi) {
      poiSel = poi;
      trace = null;
      gesture = { type: 'pan', vp0: vp, start: p, time: e.timeStamp, moved: false, onPoi: true };
      requestDraw();
      return;
    }
    const hit = hitCurve(p.x, p.y, e.pointerType);
    if (hit) {
      gesture = { type: 'trace', curve: hit.curve, start: p, time: e.timeStamp, moved: false };
      poiSel = null;
      select(hit.curve.rowId);
      setTraceFrom(hit.curve, p.x, p.y);
    } else {
      gesture = { type: 'pan', vp0: vp, start: p, time: e.timeStamp, moved: false };
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) {
      // Mouse hovering: show that handles can be grabbed.
      if (e.pointerType === 'mouse' && pointDrag) {
        const p = localPoint(e);
        canvas.style.cursor = hitHandle(p.x, p.y, 'mouse') ? 'grab' : '';
      }
      return;
    }
    const p = localPoint(e);
    pointers.set(e.pointerId, p);
    if (!gesture) return;
    if (gesture.type === 'pinch' && pointers.size >= 2) {
      interacting = true;
      const [a, b] = [...pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const factor = Math.hypot(a.x - b.x, a.y - b.y) / gesture.dist0;
      const zoomed = zoomAt(gesture.vp0, gesture.mid0.x, gesture.mid0.y, factor);
      setViewport(panBy(zoomed, mid.x - gesture.mid0.x, mid.y - gesture.mid0.y));
      return;
    }
    const dx = p.x - gesture.start.x;
    const dy = p.y - gesture.start.y;
    if (!gesture.moved && Math.hypot(dx, dy) > (gesture.type === 'point' ? 2 : TAP_SLOP)) gesture.moved = true;
    if (gesture.type === 'point') {
      if (!gesture.moved) return;
      interacting = true;
      const target = toWorld(vp, p.x + gesture.offset.x, p.y + gesture.offset.y);
      pointDrag.move(gesture.session, target, vp);
      return;
    }
    if (gesture.type === 'pan' && gesture.moved) {
      if (trace) trace = null;
      interacting = true;
      setViewport(panBy(gesture.vp0, dx, dy));
    } else if (gesture.type === 'trace') {
      setTraceFrom(gesture.curve, p.x, p.y);
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (gesture && gesture.type === 'point') {
      // A tap on a handle just shows the point's coordinates (the trace stays).
      endPointDrag();
      canvas.style.cursor = '';
      return;
    }
    if (pointers.size === 0 && interacting) {
      interacting = false;
      requestDraw(); // now work out the points of interest for the new view
    }
    if (gesture && gesture.type === 'pinch') {
      if (pointers.size === 1) {
        // Continue as a pan with the remaining finger.
        const [rest] = pointers.values();
        gesture = { type: 'pan', vp0: vp, start: rest, time: e.timeStamp, moved: true };
      } else if (pointers.size === 0) {
        gesture = null;
      }
      return;
    }
    if (pointers.size > 0 || !gesture) return;
    const g = gesture;
    gesture = null;
    if (e.type === 'pointercancel' || g.moved) return;

    // Waiting for a tap to place something (a solution curve's starting point).
    if (armed) {
      const fn = armed;
      armTap(null);
      fn(...toWorld(vp, p.x, p.y));
      return;
    }

    // A tap. On empty space it clears the trace, the tapped point and the selection.
    if (g.type === 'pan' && !g.onPoi && (trace || poiSel || selectedId !== null)) {
      trace = null;
      poiSel = null;
      select(null);
    }
    if (lastTap && e.timeStamp - lastTap.time < DOUBLE_TAP_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
      lastTap = null;
      trace = null;
      setViewport(zoomAt(vp, p.x, p.y, 2));
    } else {
      lastTap = { time: e.timeStamp, x: p.x, y: p.y };
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = localPoint(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const k = e.ctrlKey ? 0.01 : 0.0015; // ctrlKey = trackpad pinch
    interacting = true;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      interacting = false;
      requestDraw();
    }, 160);
    setViewport(zoomAt(vp, p.x, p.y, Math.exp(-e.deltaY * unit * k)));
  }, { passive: false });

  // ---- commands ----------------------------------------------------------------------
  function zoomBy(factor) {
    syncAxes();
    setViewport(zoomAt(vp, vp.width / 2, vp.height / 2, factor));
  }

  function home() {
    trace = null;
    setViewport(homeViewport(vp.width, vp.height, wantedAxes()));
  }

  // Set one axis to show world values lo…hi (axis coordinates handle log axes; a range
  // reaching ≤ 0 on a log axis shows three decades below its top).
  function withRange(next, axis, lo, hi, pad) {
    const x = axis === 'x';
    const f = axisFit(x ? next.logX : next.logY, lo, hi, x ? next.width : next.height, pad);
    if (!f) return next;
    return x
      ? { ...next, cx: f.c, scaleX: f.scale ?? next.scaleX }
      : { ...next, cy: f.c, scaleY: f.scale ?? next.scaleY };
  }

  // Zoom so the visible graphs fill the view. Cartesian graphs fit vertically over the
  // current x range; parametric, polar and point rows fit in both directions. Ranges are
  // worked out in axis coordinates, so values ≤ 0 on a log axis are left out.
  function fit() {
    syncAxes();
    const state = store.get();
    const analysis = getAnalysis();
    const xs = [];
    const ys = [];
    let only1D = true; // only y = f(x) / x = g(y) curves: fit one direction
    let round = false; // parametric, polar or point rows: keep circles round
    const N = 400;
    // Evenly across the screen, which is evenly in log x on a log axis.
    const xAt = (k) => toWorld(vp, (vp.width * k) / N, 0)[0];
    const yAt = (k) => toWorld(vp, 0, (vp.height * k) / N)[1];
    state.rows.forEach((row, i) => {
      const r = analysis.rows[i];
      if (row.hidden || !isPlottable(r)) return;
      if (r.kind === 'family') r.members.forEach((m) => addResult(m, row));
      else addResult(r, row);
    });
    function addResult(r, row) {
      if (r.kind === 'inequality' || r.kind === 'slope') return; // they fill the plane
      if (r.kind === 'points') {
        only1D = false;
        round = true;
        r.xs.forEach((x, k) => {
          if (Number.isFinite(x) && Number.isFinite(r.ys[k])) {
            xs.push(x);
            ys.push(r.ys[k]);
          }
        });
        return;
      }
      if (r.kind === 'implicit') {
        // What can be seen of it now (an implicit curve has no natural range).
        only1D = false;
        round = true;
        for (const l of contour(r.F, vp, { cell: 6 })) {
          for (let k = 0; k < l.x.length; k++) {
            const [wx, wy] = toWorld(vp, l.x[k], l.y[k]);
            xs.push(wx);
            ys.push(wy);
          }
        }
        return;
      }
      if (r.kind === 'sequence' && row.cobweb && r.cobweb) {
        // The cobweb's staircase, with y = x at 45°.
        const wanted = cobwebSteps(fieldValue(analysis, row.cobwebN));
        const path = cobwebPath(r.cobweb.g, r.cobweb.u0, wanted.steps || 20);
        const vals = [...path.xs, ...path.ys];
        xs.push(...vals);
        ys.push(...vals);
        only1D = false;
        round = true;
      } else if (r.kind === 'sequence') {
        // The terms in view, or the first ones from where it starts.
        for (const p of stemPoints(r.f, r.lowest)) ys.push(r.f(p.t[0]));
        if (!ys.length) {
          const { xMax } = worldBounds(vp);
          for (let n = r.lowest; n <= Math.max(r.lowest + 20, xMax); n++) {
            const y = r.f(n);
            if (Number.isFinite(y)) { xs.push(n); ys.push(y); }
          }
          only1D = false;
        }
      } else if ((r.kind === 'cartesian' || r.kind === 'function') && (r.discrete || r.asSequence)) {
        for (const p of stemPoints(r.f)) ys.push(r.f(p.t[0])); // the stems, at whole numbers
      } else if (r.kind === 'cartesian' || r.kind === 'function') {
        for (let k = 0; k <= N; k++) {
          const y = r.f(xAt(k));
          if (Number.isFinite(y)) ys.push(y);
        }
      } else if (r.kind === 'cartesian-x') {
        for (let k = 0; k <= N; k++) {
          const x = r.f(yAt(k));
          if (Number.isFinite(x)) xs.push(x);
        }
      } else {
        only1D = false;
        round = true;
        if (r.kind === 'point') {
          xs.push(r.x);
          ys.push(r.y);
        } else {
          const { min, max } = r.domain;
          const a = analysis.angle === 'deg' ? Math.PI / 180 : 1;
          for (let k = 0; k <= N; k++) {
            const t = min + ((max - min) * k) / N;
            let x;
            let y;
            if (r.kind === 'polar') {
              const rad = r.f(t);
              x = rad * Math.cos(t * a);
              y = rad * Math.sin(t * a);
            } else {
              x = r.fx(t);
              y = r.fy(t);
            }
            if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
          }
        }
      }
    }
    // Data sets count in full (their extremes aren't outliers to trim, unlike the odd
    // spike in a sampled curve).
    const data = dataBounds(state.data ? state.data.sets : [], { positiveX: vp.logX, positiveY: vp.logY });
    if (data) only1D = false;
    const toU = (x) => axisX(vp, x);
    const toV = (y) => axisY(vp, y);
    // In axis coordinates; values a log axis can't show drop out here.
    const us = xs.map(toU).filter(Number.isFinite);
    const vs = ys.map(toV).filter(Number.isFinite);
    const du = data ? [data.xMin, data.xMax].map(toU).filter(Number.isFinite) : [];
    const dv = data ? [data.yMin, data.yMax].map(toV).filter(Number.isFinite) : [];
    if (!us.length && !vs.length && !du.length && !dv.length) return;

    const range = (arr, extra) => {
      if (!arr.length && !extra.length) return null;
      const s = [...arr].sort((p, q) => p - q);
      let lo = s.length ? s[Math.floor(s.length * 0.01)] : Infinity;
      let hi = s.length ? s[Math.ceil(s.length * 0.99) - 1] : -Infinity;
      for (const v of extra) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      return [lo, hi];
    };
    const pad = 0.08;
    const next = { ...vp };
    const ry = range(vs, dv);
    const rx = range(us, du);
    if (ry) {
      const [lo, hi] = ry;
      const span = hi - lo;
      next.cy = (lo + hi) / 2;
      if (span > 1e-12) next.scaleY = (vp.height * (1 - 2 * pad)) / span;
    }
    if (rx && (!only1D || !ry)) {
      const [lo, hi] = rx;
      const span = hi - lo;
      next.cx = (lo + hi) / 2;
      if (span > 1e-12) next.scaleX = (vp.width * (1 - 2 * pad)) / span;
    }
    if (round && !vp.logX && !vp.logY) {
      // Keep circles round when fitting parametric and polar curves.
      const s = Math.min(next.scaleX, next.scaleY);
      next.scaleX = s;
      next.scaleY = s;
    }
    trace = null;
    setViewport(zoomAt(next, next.width / 2, next.height / 2, 1)); // zoomAt(…, 1) applies the scale limits
  }

  // Show x0 ≤ x ≤ x1 (keeping the y centre), then fit the graphs vertically.
  function frameX(x0, x1) {
    if (!vp) {
      pendingFrame = [x0, x1];
      return;
    }
    syncAxes();
    const span = x1 - x0;
    if (!(span > 0) || !Number.isFinite(span)) return;
    setViewport(withRange(vp, 'x', x0, x1, 0));
    fit();
  }

  // Show a rectangle of the plane, with a margin (e.g. a newly imported data set).
  function frameBounds({ xMin, xMax, yMin, yMax }) {
    if (!vp) return;
    syncAxes();
    let w = xMax - xMin;
    let hgt = yMax - yMin;
    if (!(w > 0)) w = Math.max(Math.abs(xMin), 1);
    if (!(hgt > 0)) hgt = Math.max(Math.abs(yMin), 1);
    const pad = 0.1;
    trace = null;
    // A single value gets a margin either side: ±w on a linear axis, a factor of 3 on a log one.
    const span = (log, lo, hi, d) => (hi > lo ? [lo, hi] : log ? [lo / 3, lo * 3] : [lo - d / 2, lo + d / 2]);
    const [x0, x1] = span(vp.logX, xMin, xMax, w);
    const [y0, y1] = span(vp.logY, yMin, yMax, hgt);
    const pf = pad / (1 + 2 * pad); // the same margin as before, as a share of the canvas
    setViewport(withRange(withRange(vp, 'x', x0, x1, pf), 'y', y0, y1, pf));
  }

  function select(rowId) {
    if (selectedId === rowId) return;
    selectedId = rowId;
    if (poiSel && poiSel.rowId !== rowId) poiSel = null;
    requestDraw();
  }

  // Points of interest of a row in the current view, for the analysis panel.
  // Returns { pois, xMin, xMax } or null when the graph isn't showing.
  function pointsFor(rowId) {
    if (!vp) return null;
    const state = store.get();
    const analysis = getAnalysis();
    const visible = [];
    let target = null;
    state.rows.forEach((row, i) => {
      const r = analysis.rows[i];
      if (row.hidden || !isPlottable(r)) return;
      visible.push({ row, r });
      if (row.id === rowId) target = r;
    });
    if (!target || !isFunctionOfX(target)) return null;
    const others = othersFor(rowId, visible);
    const pois = computePois(`panel:${rowId}`, target, others);
    const { xMin, xMax } = worldBounds(vp);
    return { pois, xMin, xMax };
  }

  // Highlight a point (from the analysis panel) as if it had been tapped.
  function showPoint(rowId, x, y, kind) {
    const row = store.get().rows.find((r) => r.id === rowId);
    poiSel = { rowId, x, y, label: labelFor([kind], x, y), color: row ? row.color : colors?.label };
    trace = null;
    select(rowId);
    requestDraw();
  }

  // The next tap on the graph calls fn(x, y) instead of its usual job; null cancels.
  let armed = null;
  const armListeners = new Set();
  function armTap(fn) {
    armed = fn;
    canvas.classList.toggle('is-placing', !!fn);
    for (const l of armListeners) l(!!fn);
  }

  // Show a saved view (an opened project); null = the home view.
  function useView(view) {
    if (!vp) return; // not sized yet: resize() reads the view from the store
    vp = view ? createViewport({ width: vp.width, height: vp.height, ...view }) : homeViewport(vp.width, vp.height, wantedAxes());
    syncAxes();
    trace = null;
    poiSel = null;
    requestDraw();
    for (const l of listeners) l();
  }

  // Draw the current view, exactly as on screen, into a new canvas at `scale` pixels
  // per CSS pixel (for PNG export). Returns { canvas, width, height, colors } or null.
  function renderImage(scale = 2) {
    if (!vp) return null;
    const off = document.createElement('canvas');
    off.width = Math.round(vp.width * scale);
    off.height = Math.round(vp.height * scale);
    const screen = { ctx, curves, drawnPois };
    ctx = off.getContext('2d');
    renderScale = scale;
    try {
      draw();
    } finally {
      ({ ctx, curves, drawnPois } = screen);
      renderScale = 0;
    }
    return { canvas: off, width: vp.width, height: vp.height, colors };
  }

  return {
    requestDraw, renderImage, useView, toggleSweep, armTap, zoomBy,
    isArmed: () => !!armed,
    viewport: () => vp,
    onArmChange: (fn) => armListeners.add(fn),
    isSweeping: (rowId) => sweeps.has(rowId),
    onSweepChange: (fn) => sweepListeners.add(fn), home, fit, frameX, frameBounds, select, pointsFor, showPoint,
    onViewChange: (fn) => listeners.add(fn),
    isCoarse: () => coarse.matches,
  };
}
