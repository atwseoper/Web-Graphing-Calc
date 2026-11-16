// The graph canvas: sizing, drawing, and pan / pinch / wheel / double-tap / trace.
// Also draws the analysis overlays (derivative, tangent, shaded integrals), the
// points of interest (roots, extrema, intercepts, intersections) of selected curves,
// and the data sets from the Data tab (points and error bars).
import {
  createViewport, toScreen, toWorld, worldBounds, zoomAt, panBy, anchor, homeViewport,
} from '../plot/viewport.js';
import {
  drawCartesianGrid, drawCartesianLabels, drawPolarGrid, drawPolarLabels,
} from '../plot/grid.js';
import {
  sampleCurve, sampleCartesian, sampleCartesianX, sampleParametric, samplePolar, nearestOnLines,
} from '../plot/sample.js';
import {
  drawLines, drawPoint, drawMarker, drawPoi, fillToBaseline, fillFan, drawScatter, drawErrorBars,
} from '../plot/render.js';
import { dataBounds } from '../data/table.js';
import { formatCoordinate, formatNumber } from '../expr/format.js';
import { pointsOfInterest } from '../numerics/analysis.js';

const PLOTTABLE = new Set(['cartesian', 'cartesian-x', 'polar', 'parametric', 'point', 'function']);
const TAP_SLOP = 8; // px of movement still counted as a tap
const DOUBLE_TAP_MS = 320;
const POI_NAMES = {
  root: 'Root', max: 'Maximum', min: 'Minimum', 'y-intercept': 'y-intercept', intersection: 'Intersection',
};

export function isPlottable(result) {
  return !!result && PLOTTABLE.has(result.kind) && (result.kind !== 'function' || !!result.f) && !result.domainError;
}

// y = f(x) rows (including f(x) = … definitions in x) that analysis works on.
export function isFunctionOfX(result) {
  return !!result && (result.kind === 'cartesian' || (result.kind === 'function' && !!result.f));
}

// Evaluate an optional number field of a row ('' -> null).
export function fieldValue(analysis, text) {
  if (!text || !text.trim()) return null;
  const r = analysis.evaluate(text);
  return !r.error && Number.isFinite(r.value) ? r.value : null;
}

export function createGraphView({ canvas, store, getAnalysis }) {
  const ctx = canvas.getContext('2d');
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
      const view = { cx: vp.cx, cy: vp.cy, scaleX: vp.scaleX, scaleY: vp.scaleY };
      store.update((s) => ({ ...s, view }));
    }, 300);
  }
  function setViewport(next) {
    vp = next;
    persistView();
    requestDraw();
    for (const l of listeners) l();
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
      vp = saved ? createViewport({ width: w, height: hgt, ...saved }) : homeViewport(w, hgt);
      for (const l of listeners) l();
      if (pendingFrame) {
        const [x0, x1] = pendingFrame;
        pendingFrame = null;
        frameX(x0, x1);
        return;
      }
    } else if (vp.width !== w) {
      // Width changed (rotation, sidebar): keep the centre where it is.
      vp = { ...vp, width: w, height: hgt };
    } else {
      // Only the height changed (sheet dragged): keep the top edge fixed.
      const [wx, wy] = toWorld(vp, w / 2, 0);
      vp = anchor({ ...vp, width: w, height: hgt }, wx, wy, w / 2, 0);
    }
    draw();
  }
  new ResizeObserver(resize).observe(canvas);

  // ---- colours ---------------------------------------------------------------------
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    colors = {
      bg: v('--graph-bg'), gridMinor: v('--grid-minor'), gridMajor: v('--grid-major'),
      axis: v('--axis'), label: v('--label'), chipBg: v('--chip-bg'), chipText: v('--chip-text'),
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
      case 'function': return sampleCartesian(r.f, vp);
      case 'cartesian-x': return sampleCartesianX(r.f, vp);
      case 'parametric': return sampleParametric(r.fx, r.fy, r.domain.min, r.domain.max, vp);
      case 'polar': return samplePolar(r.f, r.domain.min, r.domain.max, vp, angleFactor);
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
    const state = store.get();
    const analysis = getAnalysis();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, vp.width, vp.height);

    const polarGrid = state.settings.grid === 'polar';
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

    curves = [];
    for (const { row, r } of visible) {
      const lines = sampleRow(r, angleFactor);
      curves.push({ rowId: row.id, kind: r.kind, color: row.color, lines, result: r });
      if (r.kind === 'point') {
        if (lines.length) drawPoint(ctx, lines[0].x[0], lines[0].y[0], row.color);
      } else {
        drawLines(ctx, lines, row.color);
      }
    }

    drawData(state);

    for (const { row, r } of visible) if (row.showAnalysis && isFunctionOfX(r)) drawOverlays(row, r, analysis);

    if (polarGrid) drawPolarLabels(ctx, vp, colors, analysis.angle);
    else drawCartesianLabels(ctx, vp, colors);

    drawPointsOfInterest(visible);
    drawTrace(analysis);
    drawSelectedPoi();
  }

  // ---- data sets ------------------------------------------------------------------------

  // Points of the visible data sets (left-out points as rings) with σy error bars. Each
  // set becomes a 'scatter' entry in curves so its points can be tapped and traced.
  function drawData(state) {
    const sets = state.data ? state.data.sets : [];
    for (const set of sets) {
      if (set.hidden) continue;
      const on = { x: [], y: [] };
      const off = { x: [], y: [] };
      const bars = { x: [], lo: [], hi: [] };
      const all = { x: [], y: [], i: [] };
      set.points.forEach((p, i) => {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
        const [sx, sy] = toScreen(vp, p.x, p.y);
        const target = p.off ? off : on;
        target.x.push(sx);
        target.y.push(sy);
        all.x.push(sx);
        all.y.push(sy);
        all.i.push(i);
        if (set.hasSigma && p.s > 0) {
          bars.x.push(sx);
          bars.lo.push(toScreen(vp, p.x, p.y - p.s)[1]);
          bars.hi.push(toScreen(vp, p.x, p.y + p.s)[1]);
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

  // ---- analysis overlays ---------------------------------------------------------------

  function drawShading(row, r, analysis, angleFactor) {
    const a = fieldValue(analysis, row.intFrom);
    const b = fieldValue(analysis, row.intTo);
    if (isFunctionOfX(r)) {
      if (a === null || b === null || a === b) return;
      const { xMin, xMax } = worldBounds(vp);
      const pad = 2 / vp.scaleX;
      const lo = Math.max(Math.min(a, b), xMin - pad);
      const hi = Math.min(Math.max(a, b), xMax + pad);
      if (!(hi > lo)) return;
      const lines = sampleCurve((x) => {
        const y = r.f(x);
        return Number.isFinite(y) ? toScreen(vp, x, y) : null;
      }, lo, hi, { initial: Math.max(20, ((hi - lo) * vp.scaleX) / 3), maxDepth: 5 });
      fillToBaseline(ctx, lines, toScreen(vp, 0, 0)[1], row.color, 0.2);
    } else if (r.kind === 'polar') {
      const from = a ?? r.domain.min;
      const to = b ?? r.domain.max;
      if (!(to > from)) return;
      const lines = samplePolar(r.f, from, to, vp, angleFactor);
      const [ox, oy] = toScreen(vp, 0, 0);
      fillFan(ctx, lines, ox, oy, row.color, 0.18);
    }
  }

  function drawOverlays(row, r, analysis) {
    const d = row.showDeriv || row.atX ? r.derivative() : null;
    if (row.showDeriv && d) {
      drawLines(ctx, sampleCartesian(d.f, vp), row.color, 2, { dash: [7, 6], alpha: 0.85 });
    }
    const a = fieldValue(analysis, row.atX);
    if (a === null) return;
    const y0 = r.f(a);
    if (!Number.isFinite(y0)) return;
    const m = d ? d.f(a) : NaN;
    if (Number.isFinite(m)) {
      const { xMin, xMax } = worldBounds(vp);
      const p0 = toScreen(vp, xMin, y0 + m * (xMin - a));
      const p1 = toScreen(vp, xMax, y0 + m * (xMax - a));
      drawLines(ctx, [{ x: [p0[0], p1[0]], y: [p0[1], p1[1]] }], row.color, 1.5, { alpha: 0.75 });
    }
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
    if (!allowCompute) return null;
    const d = r.derivative ? r.derivative() : null;
    const value = pointsOfInterest({ f: r.f, df: d ? d.f : undefined }, xMin, xMax, {
      others, samples: Math.round(Math.min(800, Math.max(200, vp.width))),
    });
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
    drawMarker(ctx, sx, sy, c.color, pos.label, colors, vp.width, vp.height);
  }

  function tracePosition(r, tr, angle) {
    const px = 1 / vp.scaleX;
    const py = 1 / vp.scaleY;
    const fmt = (x, y) => `(${formatCoordinate(x, px)}, ${formatCoordinate(y, py)})`;
    switch (r.kind) {
      case 'cartesian':
      case 'function': {
        const y = r.f(tr.x);
        return Number.isFinite(y) ? { x: tr.x, y, label: fmt(tr.x, y) } : null;
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
        return {
          x: rad * Math.cos(a), y: rad * Math.sin(a),
          label: `r = ${formatCoordinate(rad, Math.min(px, py))}, θ = ${theta}`,
        };
      }
      case 'point':
        return { x: r.x, y: r.y, label: fmt(r.x, r.y) };
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
        trace = { rowId: curve.rowId, kind: curve.kind, x: wx };
        break;
      case 'cartesian-x':
        trace = { rowId: curve.rowId, kind: curve.kind, y: wy };
        break;
      case 'point':
        trace = { rowId: curve.rowId, kind: 'point' };
        break;
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
      startPinch();
      return;
    }
    if (pointers.size > 2) return;
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
    if (!pointers.has(e.pointerId)) return;
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
    if (!gesture.moved && Math.hypot(dx, dy) > TAP_SLOP) gesture.moved = true;
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
    setViewport(zoomAt(vp, vp.width / 2, vp.height / 2, factor));
  }

  function home() {
    trace = null;
    setViewport(homeViewport(vp.width, vp.height));
  }

  // Zoom so the visible graphs fill the view. Cartesian graphs fit vertically over the
  // current x range; parametric, polar and point rows fit in both directions.
  function fit() {
    const state = store.get();
    const analysis = getAnalysis();
    const { xMin, xMax, yMin, yMax } = worldBounds(vp);
    const xs = [];
    const ys = [];
    let only1D = true; // only y = f(x) / x = g(y) curves: fit one direction
    let round = false; // parametric, polar or point rows: keep circles round
    const N = 400;
    state.rows.forEach((row, i) => {
      const r = analysis.rows[i];
      if (row.hidden || !isPlottable(r)) return;
      if (r.kind === 'cartesian' || r.kind === 'function') {
        for (let k = 0; k <= N; k++) {
          const y = r.f(xMin + ((xMax - xMin) * k) / N);
          if (Number.isFinite(y)) ys.push(y);
        }
      } else if (r.kind === 'cartesian-x') {
        for (let k = 0; k <= N; k++) {
          const x = r.f(yMin + ((yMax - yMin) * k) / N);
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
    });
    const data = dataBounds(state.data ? state.data.sets : []);
    if (data) {
      only1D = false;
      xs.push(data.xMin, data.xMax);
      ys.push(data.yMin, data.yMax);
    }
    if (!xs.length && !ys.length) return;

    const range = (arr) => {
      if (!arr.length) return null;
      const s = [...arr].sort((p, q) => p - q);
      const lo = s[Math.floor(s.length * 0.01)];
      const hi = s[Math.ceil(s.length * 0.99) - 1];
      return [lo, hi];
    };
    const pad = 0.08;
    let next = { ...vp };
    const ry = range(ys);
    const rx = range(xs);
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
    if (round) {
      // Keep circles round when fitting parametric and polar curves.
      const s = Math.min(next.scaleX, next.scaleY);
      next.scaleX = s;
      next.scaleY = s;
    }
    trace = null;
    setViewport(next);
  }

  // Show x0 ≤ x ≤ x1 (keeping the y centre), then fit the graphs vertically.
  function frameX(x0, x1) {
    if (!vp) {
      pendingFrame = [x0, x1];
      return;
    }
    const span = x1 - x0;
    if (!(span > 0) || !Number.isFinite(span)) return;
    setViewport({ ...vp, cx: (x0 + x1) / 2, scaleX: vp.width / span });
    fit();
  }

  // Show a rectangle of the plane, with a margin (e.g. a newly imported data set).
  function frameBounds({ xMin, xMax, yMin, yMax }) {
    if (!vp) return;
    let w = xMax - xMin;
    let hgt = yMax - yMin;
    if (!(w > 0)) w = Math.max(Math.abs(xMin), 1);
    if (!(hgt > 0)) hgt = Math.max(Math.abs(yMin), 1);
    const pad = 0.1;
    trace = null;
    setViewport({
      ...vp,
      cx: (xMin + xMax) / 2,
      cy: (yMin + yMax) / 2,
      scaleX: vp.width / (w * (1 + 2 * pad)),
      scaleY: vp.height / (hgt * (1 + 2 * pad)),
    });
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

  return {
    requestDraw, zoomBy, home, fit, frameX, frameBounds, select, pointsFor, showPoint,
    onViewChange: (fn) => listeners.add(fn),
    isCoarse: () => coarse.matches,
  };
}
