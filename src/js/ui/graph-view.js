// The graph canvas: sizing, drawing, and pan / pinch / wheel / double-tap / trace.
import {
  createViewport, toScreen, toWorld, worldBounds, zoomAt, panBy, anchor, homeViewport,
} from '../plot/viewport.js';
import { drawCartesianGrid, drawPolarGrid } from '../plot/grid.js';
import {
  sampleCartesian, sampleCartesianX, sampleParametric, samplePolar, nearestOnLines,
} from '../plot/sample.js';
import { drawLines, drawPoint, drawMarker } from '../plot/render.js';
import { formatCoordinate, formatNumber } from '../expr/format.js';

const PLOTTABLE = new Set(['cartesian', 'cartesian-x', 'polar', 'parametric', 'point', 'function']);
const TAP_SLOP = 8; // px of movement still counted as a tap
const DOUBLE_TAP_MS = 320;

export function isPlottable(result) {
  return !!result && PLOTTABLE.has(result.kind) && (result.kind !== 'function' || !!result.f) && !result.domainError;
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

    if (state.settings.grid === 'polar') drawPolarGrid(ctx, vp, colors, analysis.angle);
    else drawCartesianGrid(ctx, vp, colors);

    const angleFactor = analysis.angle === 'deg' ? Math.PI / 180 : 1;
    curves = [];
    state.rows.forEach((row, i) => {
      const r = analysis.rows[i];
      if (row.hidden || !isPlottable(r)) return;
      const lines = sampleRow(r, angleFactor);
      curves.push({ rowId: row.id, kind: r.kind, color: row.color, lines, result: r });
      if (r.kind === 'point') {
        if (lines.length) drawPoint(ctx, lines[0].x[0], lines[0].y[0], row.color);
      } else {
        drawLines(ctx, lines, row.color);
      }
    });

    drawTrace(analysis);
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
      default:
        return null;
    }
  }

  // ---- hit testing -------------------------------------------------------------------
  function hitCurve(sx, sy, pointerType) {
    const radius = pointerType === 'mouse' ? 10 : 24;
    let best = null;
    for (const c of curves) {
      const hit = nearestOnLines(c.lines, sx, sy);
      if (hit && hit.dist <= (c.kind === 'point' ? radius + 6 : radius) && (!best || hit.dist < best.hit.dist)) {
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
    const hit = hitCurve(p.x, p.y, e.pointerType);
    if (hit) {
      gesture = { type: 'trace', curve: hit.curve, start: p, time: e.timeStamp, moved: false };
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
      setViewport(panBy(gesture.vp0, dx, dy));
    } else if (gesture.type === 'trace') {
      setTraceFrom(gesture.curve, p.x, p.y);
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
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

    // A tap.
    if (g.type === 'pan' && trace) {
      trace = null;
      requestDraw();
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
    let only1D = true;
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
    if (!only1D) {
      // Keep circles round when fitting curves in both directions.
      const s = Math.min(next.scaleX, next.scaleY);
      next.scaleX = s;
      next.scaleY = s;
    }
    trace = null;
    setViewport(next);
  }

  return { requestDraw, zoomBy, home, fit, isCoarse: () => coarse.matches };
}
