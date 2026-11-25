// Photo digitiser (Phase 8b): a full-screen view for reading data points off a photo or
// screenshot of a graph. Calibrate (axes, known length or four points), tap points, and
// "Add points" makes a new data set. The mapping is data/digitise.js.
//
// The image is never stored (Q14): it lives in a canvas while the view is open, and the
// canvas is emptied when it closes. Nothing here enters the project or the undo history
// until "Add points"; the view keeps its own small undo for placing and moving markers.
//
// Touch: tap places, press and hold shows the magnifier to aim and places on release,
// dragging a marker moves it by the finger's movement (so the finger never hides it),
// one finger on the photo pans and two pinch-zoom. Mouse: click places, drag pans or
// moves a marker, the wheel zooms. Keyboard: arrows nudge the selected marker (Shift: ×10),
// Delete removes the selected point, Ctrl+Z / Ctrl+Y undo and redo, Escape closes.
import { h, setText, setHidden } from './dom.js';
import { ICONS } from './icons.js';
import {
  calibrate, toWorld, resolution, roundToResolution, digitisedPoints, gridLines,
  METHODS, METHOD_NAMES, REFS, REF_LABELS, emptyRefs, nameFromImage,
} from '../data/digitise.js';
import { parseNumber } from '../data/number.js';

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_SIDE = 4096; // longest side kept, in image pixels (canvas size limits on phones)
const MAX_POINTS = 2000;
const HOLD_MS = 300;
const TAP_SLOP = 8;
const HIT_MOUSE = 16;
const HIT_TOUCH = 28;
const LOUPE = 128; // css px
const UNDO_LIMIT = 200;

const COLORS = { x: '#2f6fed', y: '#d6336c', ref: '#f08c00', point: '#0ca678', error: '#e03131' };
const refColor = (k) => (k[0] === 'x' ? COLORS.x : k[0] === 'y' ? COLORS.y : COLORS.ref);

const HINTS = {
  x1: 'Tap a labelled tick mark on the x axis itself (the horizontal axis line, not the curve), then type its value.',
  x2: 'Tap a second labelled tick on the x axis, well away from x₁, and type its value.',
  y1: 'Tap a labelled tick mark on the y axis itself (the vertical axis line). The origin is fine.',
  y2: 'Tap a second labelled tick on the y axis, well away from y₁, and type its value.',
  o: 'Tap where the measurement starts. This is the origin, (0, 0) unless you type other values.',
  p: 'Tap a point a known length from the origin, in the +x direction (along a ruler, for example).',
  p1: 'Tap four points whose x and y you know, such as the corners of a rectangle of known size or four grid crossings.',
};
HINTS.p2 = HINTS.p1; HINTS.p3 = HINTS.p1; HINTS.p4 = HINTS.p1;

// The "How to use this" guide for each calibration method: [when to use it, steps].
const LAST_STEP = 'Check the faint grid drawn over the photo lines up with the photo’s own grid, then tap Next and tap the points you want to read off the curve.';
const GUIDES = {
  axes: ['For most graphs and screenshots, where both axes have numbers on them.', [
    'Tap x₁ on the x axis (the horizontal line), on a tick mark you can read, and type its value.',
    'Tap x₂ on the x axis too, on another tick well away from x₁, and type its value.',
    'Do the same for y₁ and y₂ on the y axis (the vertical line). x₁ and y₁ can both be the origin.',
    LAST_STEP,
  ], 'All four markers go on the axes, not on the curve: the curve’s points come after Next. Markers far apart give more accurate values.'],
  length: ['For a photo of a real object with no axes, such as an arch or a jet of water, with something of known size in it.', [
    'Tap the Origin, where measuring starts. It is (0, 0) unless you type other values.',
    'Tap End, a known distance from the origin in the +x direction (along a ruler in the photo, say), and type that length.',
    LAST_STEP,
  ], 'Take the photo straight on, so lengths aren’t distorted. +y is a quarter turn anticlockwise from +x.'],
  four: ['For a graph or object photographed at an angle, so it looks like a trapezium rather than a rectangle.', [
    'Tap four points whose x and y you know, such as four grid crossings or the corners of a rectangle of known size.',
    'Type the x and y of each one. No three of them may be in a line.',
    LAST_STEP,
  ], 'This undoes the perspective. Points spread out near the corners of the area you’ll digitise work best.'],
};

const INPUT_ATTRS = {
  type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'next',
};

const numText = (v) => (Number.isFinite(v) ? String(v).replace('-', '−') : '–');

// Reads an image file into a canvas, at most MAX_SIDE on its longest side. EXIF rotation
// is applied by the browser when decoding.
async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    if (!w0 || !h0) throw new Error('empty');
    const s = Math.min(1, MAX_SIDE / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * s));
    c.height = Math.max(1, Math.round(h0 * s));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    img.src = '';
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function createDigitiser({ getAxes, onDone }) {
  // ---- state ------------------------------------------------------------------------------
  let source = null; // canvas holding the image
  let name = '';
  let step = 'calibrate';
  let method = 'axes';
  let xLog = false;
  let yLog = false;
  let refPos = {}; // method -> key -> { px, py } | null
  let points = []; // [{ px, py }]
  let active = 'x1'; // reference being placed (calibration step)
  let selected = -1; // selected point (points step)
  let showGrid = true;
  let cal = { ok: false, error: '', refs: [] };
  let undoStack = [];
  let redoStack = [];
  let view = { k: 1, tx: 0, ty: 0 };
  let fitK = 1;
  let stageW = 0;
  let stageH = 0;
  let confirmClose = 0;
  let returnFocus = null;
  let drawQueued = false;

  // ---- elements ---------------------------------------------------------------------------
  const iconBtn = (icon, label, onClick, cls = 'tool-btn') => h('button', { type: 'button', class: cls, 'aria-label': label, title: label, html: ICONS[icon], onClick });
  const closeBtn = h('button', { type: 'button', class: 'dg-close', 'aria-label': 'Close the digitiser', onClick: () => askClose() },
    h('span', { html: ICONS.close }), h('span', { class: 'dg-close-text' }));
  const titleEl = h('h2', { class: 'dg-title', id: 'dg-title' });
  const undoBtn = iconBtn('undo', 'Undo', () => undo(), 'dg-icon-btn');
  const redoBtn = iconBtn('redo', 'Redo', () => redo(), 'dg-icon-btn');
  const doneBtn = h('button', { type: 'button', class: 'primary-btn dg-done', onClick: () => (step === 'calibrate' ? setStep('points') : finish()) }, 'Next');
  const bar = h('header', { class: 'dg-bar' }, closeBtn, titleEl, undoBtn, redoBtn, doneBtn);

  const canvas = h('canvas', { class: 'dg-canvas', role: 'img', 'aria-label': 'The photo being digitised' });
  const loupe = h('canvas', { class: 'dg-loupe', 'aria-hidden': 'true' });
  const loupeText = h('div', { class: 'dg-loupe-text', 'aria-hidden': 'true' });
  const loupeBox = h('div', { class: 'dg-loupe-box', hidden: true }, loupe, loupeText);
  const gridBtn = iconBtn('grid', 'Show the calibrated grid', () => { showGrid = !showGrid; renderPanel(); queueDraw(); });
  const tools = h('div', { class: 'dg-tools' },
    iconBtn('plus', 'Zoom in', () => zoomBy(1.6)),
    iconBtn('minus', 'Zoom out', () => zoomBy(1 / 1.6)),
    iconBtn('fit', 'Fit the photo', () => { fitView(); queueDraw(); }),
    gridBtn);
  const stage = h('div', { class: 'dg-stage' }, canvas, tools, loupeBox);

  // Calibration panel.
  const methodBtns = {};
  const methodSeg = h('div', { class: 'segmented dg-methods', role: 'radiogroup', 'aria-label': 'How to calibrate' },
    ...METHODS.map((m) => {
      methodBtns[m] = h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', onClick: () => setMethod(m) }, METHOD_NAMES[m]);
      return methodBtns[m];
    }));
  const logSeg = (axis) => {
    const btns = {};
    const el = h('div', { class: 'segmented dg-log', role: 'radiogroup', 'aria-label': `${axis} axis` },
      ...[['lin', 'Linear'], ['log', 'Log']].map(([v, text]) => {
        btns[v] = h('button', {
          type: 'button', role: 'radio', 'aria-checked': 'false',
          onClick: () => { if (axis === 'x') xLog = v === 'log'; else yLog = v === 'log'; update(); },
        }, text);
        return btns[v];
      }));
    return { el, set: (log) => { btns.lin.setAttribute('aria-checked', String(!log)); btns.log.setAttribute('aria-checked', String(log)); } };
  };
  const xLogSeg = logSeg('x');
  const yLogSeg = logSeg('y');
  const logRow = h('div', { class: 'dg-log-row' },
    h('span', { class: 'dg-log-label' }, 'x axis'), xLogSeg.el,
    h('span', { class: 'dg-log-label' }, 'y axis'), yLogSeg.el);

  // One row per reference point: a button to place it, and its values.
  const inputs = {}; // `${method}:${key}:${field}` -> input
  const refRows = {}; // `${method}:${key}` -> { row, btn, state }
  const valueInput = (m, k, field, label, short, placeholder = '') => {
    const el = h('input', { ...INPUT_ATTRS, class: 'mini-input dg-value', 'aria-label': label, placeholder });
    el.addEventListener('input', () => update());
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const all = [...refList.querySelectorAll('input')].filter((i) => !i.closest('[hidden]'));
      const next = all[all.indexOf(el) + 1];
      if (next) next.focus(); else el.blur();
    });
    inputs[`${m}:${k}:${field}`] = el;
    return h('label', { class: 'dg-field' }, h('span', { 'aria-hidden': 'true' }, short), el);
  };
  const FIELDS = {
    axes: (k) => [valueInput('axes', k, 'value', `${REF_LABELS[k]} value`, k[0] === 'x' ? 'x =' : 'y =')],
    length: (k) => (k === 'o'
      ? [valueInput('length', k, 'x', 'Origin x', 'x =', '0'), valueInput('length', k, 'y', 'Origin y', 'y =', '0')]
      : [valueInput('length', k, 'length', 'Length from the origin to the end', 'Length')]),
    four: (k) => [valueInput('four', k, 'x', `${REF_LABELS[k]} x`, 'x ='), valueInput('four', k, 'y', `${REF_LABELS[k]} y`, 'y =')],
  };
  const refList = h('div', { class: 'dg-refs' });
  for (const m of METHODS) {
    for (const k of REFS[m]) {
      const state = h('span', { class: 'dg-ref-state' });
      const btn = h('button', { type: 'button', class: 'dg-ref-btn', onClick: () => { active = k; renderPanel(); queueDraw(); } },
        h('span', { class: 'dg-ref-dot', style: `--ref-color: ${refColor(k)}` }),
        h('span', { class: 'dg-ref-name' }, REF_LABELS[k]), state);
      const row = h('div', { class: 'dg-ref', hidden: true }, btn, h('div', { class: 'dg-fields' }, ...FIELDS[m](k)));
      refRows[`${m}:${k}`] = { row, btn, state };
      refList.append(row);
    }
  }
  // "How to use this": open when the view opens, closed once the first marker is placed,
  // unless it has been opened or closed by hand.
  const guideBodies = {};
  for (const m of METHODS) {
    const [when, steps, note] = GUIDES[m];
    guideBodies[m] = h('div', { class: 'dg-guide-body', hidden: true },
      h('p', {}, when), h('ol', {}, ...steps.map((s) => h('li', {}, s))), h('p', { class: 'dg-guide-note' }, note));
  }
  const guideSummary = h('summary', {}, 'How to use this');
  const guide = h('details', { class: 'dg-guide' }, guideSummary, ...Object.values(guideBodies));
  let guideAuto = true;
  guideSummary.addEventListener('click', () => { guideAuto = false; });

  const calHint = h('p', { class: 'dg-hint', 'aria-live': 'polite' });
  const calStatus = h('p', { class: 'dg-status', 'aria-live': 'polite' });
  const calBox = h('div', { class: 'dg-cal' }, methodSeg, guide, logRow, calHint, refList, calStatus);

  // Points panel.
  const ptHint = h('p', { class: 'dg-hint' });
  const ptCount = h('span', { class: 'dg-count', 'aria-live': 'polite' });
  const selText = h('span', { class: 'dg-sel-text', 'aria-live': 'polite' });
  const delBtn = h('button', { type: 'button', class: 'text-btn dg-del', onClick: () => deleteSelected() }, 'Delete point');
  const selBox = h('div', { class: 'dg-sel' }, selText, delBtn);
  let confirmClear = 0;
  const clearBtn = h('button', { type: 'button', class: 'text-btn', onClick: () => clearPoints() }, 'Clear all');
  const backBtn = h('button', { type: 'button', class: 'secondary-btn', onClick: () => setStep('calibrate') }, 'Back to calibration');
  const ptBox = h('div', { class: 'dg-points', hidden: true }, ptHint, h('div', { class: 'dg-count-row' }, ptCount, clearBtn), selBox, h('div', { class: 'dg-actions' }, backBtn));

  const panel = h('div', { class: 'dg-panel' }, calBox, ptBox);
  const root = h('div', {
    class: 'digitiser', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dg-title', hidden: true,
    tabindex: '-1', 'data-native-undo': '',
  }, bar, stage, panel);
  document.body.append(root);

  // ---- calibration -------------------------------------------------------------------------
  const val = (m, k, field) => {
    const el = inputs[`${m}:${k}:${field}`];
    const v = parseNumber(el ? el.value : '', 'auto');
    return v === null ? null : v;
  };
  function calibration() {
    const pos = refPos[method];
    const refs = {};
    for (const k of REFS[method]) {
      const p = pos[k];
      if (method === 'axes') refs[k] = p && { ...p, value: val('axes', k, 'value') };
      else if (method === 'four') refs[k] = p && { ...p, x: val('four', k, 'x'), y: val('four', k, 'y') };
      else if (k === 'o') refs[k] = p && { ...p, x: val('length', 'o', 'x'), y: val('length', 'o', 'y') };
      else refs[k] = p && { ...p };
    }
    if (method === 'length') refs.length = val('length', 'p', 'length');
    return { method, xLog, yLog, refs };
  }

  function update() {
    cal = calibrate(calibration());
    if (step === 'points' && !cal.ok) step = 'calibrate';
    renderPanel();
    queueDraw();
  }

  function setMethod(m) {
    method = m;
    const pos = refPos[m];
    active = REFS[m].find((k) => !pos[k]) || REFS[m][0];
    update();
  }

  function setStep(s) {
    if (s === 'points' && !cal.ok) return;
    step = s;
    selected = -1;
    renderPanel();
    queueDraw();
  }

  // ---- undo ---------------------------------------------------------------------------------
  const snapshot = () => JSON.stringify({ refPos, points });
  function pushUndo(snap = snapshot()) {
    undoStack.push(snap);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
  }
  function restore(snap) {
    const s = JSON.parse(snap);
    refPos = s.refPos;
    points = s.points;
    if (selected >= points.length) selected = -1;
    update();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
  }

  // ---- placing and editing -------------------------------------------------------------------
  const toImg = (sx, sy) => ({ px: (sx - view.tx) / view.k, py: (sy - view.ty) / view.k });
  const toScr = (px, py) => ({ x: px * view.k + view.tx, y: py * view.k + view.ty });
  const inImage = (p) => source && p.px >= 0 && p.py >= 0 && p.px <= source.width && p.py <= source.height;

  function place(sx, sy) {
    const p = toImg(sx, sy);
    if (!inImage(p)) return;
    pushUndo();
    if (step === 'calibrate') {
      refPos[method][active] = p;
      const order = REFS[method];
      const i = order.indexOf(active);
      const next = [...order.slice(i + 1), ...order.slice(0, i)].find((k) => !refPos[method][k]);
      if (next) active = next;
      if (guideAuto) { guideAuto = false; guide.open = false; }
    } else {
      if (points.length >= MAX_POINTS) { undoStack.pop(); return; }
      points.push(p);
      selected = points.length - 1;
    }
    update();
  }

  function deleteSelected() {
    if (selected < 0 || selected >= points.length) return;
    pushUndo();
    points.splice(selected, 1);
    selected = -1;
    update();
  }

  function clearPoints() {
    if (!points.length) return;
    if (!confirmClear) {
      confirmClear = window.setTimeout(() => { confirmClear = 0; renderPanel(); }, 3000);
      renderPanel();
      return;
    }
    clearTimeout(confirmClear);
    confirmClear = 0;
    pushUndo();
    points = [];
    selected = -1;
    update();
  }

  // The marker a gesture or key acts on: { kind: 'ref', key } or { kind: 'point', i }.
  function markerPos(m) {
    return m.kind === 'ref' ? refPos[method][m.key] : points[m.i];
  }
  function selectedMarker() {
    if (step === 'calibrate') return refPos[method][active] ? { kind: 'ref', key: active } : null;
    return selected >= 0 && points[selected] ? { kind: 'point', i: selected } : null;
  }

  function hitTest(sx, sy, touch) {
    const r = touch ? HIT_TOUCH : HIT_MOUSE;
    let best = null;
    let bestD = r;
    const consider = (m, p) => {
      if (!p) return;
      const s = toScr(p.px, p.py);
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d <= bestD) { bestD = d; best = m; }
    };
    if (step === 'calibrate') for (const k of REFS[method]) consider({ kind: 'ref', key: k }, refPos[method][k]);
    else points.forEach((p, i) => consider({ kind: 'point', i }, p));
    return best;
  }

  // ---- view ---------------------------------------------------------------------------------
  function resize() {
    const r = stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const hgt = Math.max(1, Math.round(r.height));
    const dpr = window.devicePixelRatio || 1;
    if (w === stageW && hgt === stageH && canvas.width === Math.round(w * dpr)) return;
    const first = !stageW;
    stageW = w; stageH = hgt;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    if (!source) return;
    // The photo stays where it is on screen when the panel below changes height.
    if (first) fitView();
    else fitK = Math.min(w / source.width, hgt / source.height) * 0.94;
    draw();
  }

  function fitView() {
    if (!source || !stageW) return;
    fitK = Math.min(stageW / source.width, stageH / source.height) * 0.94;
    view = { k: fitK, tx: (stageW - source.width * fitK) / 2, ty: (stageH - source.height * fitK) / 2 };
  }

  const clampK = (k) => Math.min(Math.max(k, fitK * 0.5), Math.max(fitK * 64, 24));
  function zoomAt(sx, sy, factor) {
    const p = toImg(sx, sy);
    view.k = clampK(view.k * factor);
    view.tx = sx - p.px * view.k;
    view.ty = sy - p.py * view.k;
    queueDraw();
  }
  const zoomBy = (f) => zoomAt(stageW / 2, stageH / 2, f);

  // ---- drawing ------------------------------------------------------------------------------
  function queueDraw() {
    if (drawQueued || root.hidden) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
  }

  function marker(ctx, s, color, { label = '', ring = false, faint = false, error = false } = {}) {
    ctx.save();
    ctx.globalAlpha = faint ? 0.55 : 1;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    const cross = () => {
      ctx.beginPath();
      ctx.moveTo(s.x - 14, s.y); ctx.lineTo(s.x - 4, s.y);
      ctx.moveTo(s.x + 4, s.y); ctx.lineTo(s.x + 14, s.y);
      ctx.moveTo(s.x, s.y - 14); ctx.lineTo(s.x, s.y - 4);
      ctx.moveTo(s.x, s.y + 4); ctx.lineTo(s.x, s.y + 14);
      ctx.stroke();
    };
    cross();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = error ? COLORS.error : color;
    cross();
    ctx.beginPath();
    ctx.arc(s.x, s.y, ring ? 10 : 7, 0, Math.PI * 2);
    ctx.lineWidth = ring ? 3 : 2;
    ctx.stroke();
    if (label) {
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.fillStyle = error ? COLORS.error : color;
      ctx.strokeText(label, s.x + 12, s.y - 10);
      ctx.fillText(label, s.x + 12, s.y - 10);
    }
    ctx.restore();
  }

  // A digitised point: a ring with a fine centre, so the photo's own mark shows through.
  function dot(ctx, s, sel) {
    const r = sel ? 9 : 6;
    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = sel ? 3 : 2;
    ctx.strokeStyle = COLORS.point;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = COLORS.point;
    ctx.beginPath(); ctx.arc(s.x, s.y, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Draws the photo, grid and markers with the view v, on a canvas w × h css px.
  function scene(ctx, v, w, hgt, { labels = true } = {}) {
    const S = (p) => ({ x: p.px * v.k + v.tx, y: p.py * v.k + v.ty });
    ctx.fillStyle = '#2a2d33';
    ctx.fillRect(0, 0, w, hgt);
    if (!source) return;
    ctx.save();
    ctx.translate(v.tx, v.ty);
    ctx.scale(v.k, v.k);
    // Pixels stay sharp when zoomed right in, so their edges can be aimed at.
    ctx.imageSmoothingEnabled = v.k < 3;
    ctx.drawImage(source, 0, 0);
    ctx.restore();

    if (cal.ok && showGrid) {
      ctx.save();
      // The grid only covers the photo.
      const ix0 = Math.max(0, v.tx); const iy0 = Math.max(0, v.ty);
      const ix1 = Math.min(w, v.tx + source.width * v.k); const iy1 = Math.min(hgt, v.ty + source.height * v.k);
      ctx.beginPath();
      ctx.rect(ix0, iy0, ix1 - ix0, iy1 - iy0);
      ctx.clip();
      ctx.lineWidth = 1;
      ctx.font = '11px system-ui, sans-serif';
      for (const line of gridLines(cal.map, source.width, source.height)) {
        ctx.strokeStyle = line.axis === 'x' ? 'rgba(47,111,237,0.55)' : 'rgba(214,51,108,0.55)';
        ctx.beginPath();
        line.points.forEach(([px, py], i) => {
          const s = S({ px, py });
          if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
        });
        ctx.stroke();
        if (!labels) continue;
        // Label each line where it is lowest (x) or furthest left (y) on screen.
        let best = null;
        for (const [px, py] of line.points) {
          const s = S({ px, py });
          if (s.x < ix0 + 14 || s.x > ix1 - 14 || s.y < iy0 + 12 || s.y > iy1 - 4) continue;
          if (!best || (line.axis === 'x' ? s.y > best.y : s.x < best.x)) best = s;
        }
        if (best) {
          const tw = ctx.measureText(line.label).width;
          const lx = line.axis === 'x' ? best.x - tw / 2 : best.x + 3;
          const ly = line.axis === 'x' ? best.y - 4 : best.y - 3;
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillRect(lx - 2, ly - 10, tw + 4, 13);
          ctx.fillStyle = line.axis === 'x' ? '#1c4fc4' : '#a61e4d';
          ctx.fillText(line.label, lx, ly);
        }
      }
      ctx.restore();
    }

    const pos = refPos[method];
    const errRefs = !cal.ok ? cal.refs || [] : [];
    const calibrating = step === 'calibrate';
    // Guide lines between reference points: the two axes, the ruler, the four-sided shape.
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    const seg = (a, b, color) => {
      if (!a || !b) return;
      const sa = S(a); const sb = S(b);
      ctx.strokeStyle = color;
      ctx.globalAlpha = calibrating ? 0.9 : 0.4;
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    };
    if (method === 'axes') { seg(pos.x1, pos.x2, COLORS.x); seg(pos.y1, pos.y2, COLORS.y); }
    if (method === 'length') seg(pos.o, pos.p, COLORS.ref);
    if (method === 'four') { seg(pos.p1, pos.p2, COLORS.ref); seg(pos.p2, pos.p3, COLORS.ref); seg(pos.p3, pos.p4, COLORS.ref); seg(pos.p4, pos.p1, COLORS.ref); }
    ctx.restore();

    for (const k of REFS[method]) {
      if (!pos[k]) continue;
      marker(ctx, S(pos[k]), refColor(k), {
        label: labels ? REF_LABELS[k] : '', ring: calibrating && k === active, faint: !calibrating, error: calibrating && errRefs.includes(k),
      });
    }
    if (!calibrating || points.length) {
      points.forEach((p, i) => dot(ctx, S(p), !calibrating && i === selected));
    }
  }

  function draw() {
    const ctx = canvas.getContext('2d');
    const dpr = canvas.width / Math.max(1, stageW);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scene(ctx, view, stageW, stageH);
    undoBtn.disabled = !undoStack.length;
    redoBtn.disabled = !redoStack.length;
  }

  // Magnifier: the area around image point p, four times the current zoom, beside the
  // finger at screen point (fx, fy).
  function showLoupe(p, fx, fy, touch) {
    const dpr = window.devicePixelRatio || 1;
    if (loupe.width !== LOUPE * dpr) { loupe.width = LOUPE * dpr; loupe.height = LOUPE * dpr; }
    const k = Math.max(view.k * 4, 1.5);
    const v = { k, tx: LOUPE / 2 - p.px * k, ty: LOUPE / 2 - p.py * k };
    const ctx = loupe.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scene(ctx, v, LOUPE, LOUPE, { labels: false });
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    const c = LOUPE / 2;
    ctx.beginPath();
    ctx.moveTo(c - 18, c); ctx.lineTo(c - 4, c); ctx.moveTo(c + 4, c); ctx.lineTo(c + 18, c);
    ctx.moveTo(c, c - 18); ctx.lineTo(c, c - 4); ctx.moveTo(c, c + 4); ctx.lineTo(c, c + 18);
    ctx.stroke();
    ctx.strokeStyle = '#e03131';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Readout of the value under the crosshair, once calibrated.
    let text = '';
    if (cal.ok) {
      const w = toWorld(cal.map, p.px, p.py);
      const r = resolution(cal.map, p.px, p.py);
      if (w) text = `${numText(roundToResolution(w.x, r.x))}, ${numText(roundToResolution(w.y, r.y))}`;
    }
    setText(loupeText, text);
    setHidden(loupeText, !text);
    // Above the finger (or above-right of a mouse pointer); below it near the top edge.
    const gap = touch ? 56 : 24;
    let left = fx - LOUPE / 2 + (touch ? 0 : LOUPE / 2 + 8);
    let top = fy - LOUPE - gap;
    if (top < 4) top = fy + gap;
    left = Math.min(Math.max(4, left), stageW - LOUPE - 4);
    loupeBox.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    loupeBox.hidden = false;
  }
  const hideLoupe = () => { loupeBox.hidden = true; };

  // ---- pointer gestures --------------------------------------------------------------------
  const ptrs = new Map();
  let g = null;
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const isTouch = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';
  const cancelHold = () => { if (g && g.timer) { clearTimeout(g.timer); g.timer = 0; } };

  function startPinch() {
    cancelHold();
    hideLoupe();
    const [a, b] = [...ptrs.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    g = { type: 'pinch', d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), k0: view.k, anchor: toImg(mid.x, mid.y) };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button > 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    ptrs.set(e.pointerId, p);
    root.focus({ preventScroll: true }); // closes the phone keyboard
    if (ptrs.size === 2) { startPinch(); return; }
    if (ptrs.size > 2) return;
    const touch = isTouch(e);
    const hit = hitTest(p.x, p.y, touch);
    if (hit) {
      // A reference marker becomes the active one when it is dragged, or tapped while the
      // active one is already placed. Tapping it while the active one still needs placing
      // places that one there, so x₁ and y₁ can share the origin.
      if (hit.kind === 'point') selected = hit.i;
      else if (refPos[method][active]) active = hit.key;
      g = { type: 'drag', id: e.pointerId, target: hit, start: p, last: p, moved: false, snap: snapshot(), touch };
      renderPanel();
      queueDraw();
      return;
    }
    g = { type: 'pending', id: e.pointerId, start: p, last: p, touch, timer: 0 };
    if (touch) {
      g.timer = window.setTimeout(() => {
        if (!g || g.type !== 'pending') return;
        g = { type: 'aim', id: g.id, last: g.last, touch: true };
        showLoupe(toImg(g.last.x, g.last.y), g.last.x, g.last.y, true);
      }, HOLD_MS);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, p);
    if (!g) return;
    if (g.type === 'pinch') {
      if (ptrs.size < 2) return;
      const [a, b] = [...ptrs.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      view.k = clampK(g.k0 * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0));
      view.tx = mid.x - g.anchor.px * view.k;
      view.ty = mid.y - g.anchor.py * view.k;
      queueDraw();
      return;
    }
    if (g.id !== e.pointerId) return;
    if (g.type === 'drag') {
      const m = markerPos(g.target);
      if (!m) return;
      if (!g.moved) {
        if (Math.hypot(p.x - g.last.x, p.y - g.last.y) < (g.touch ? 3 : 1)) return;
        g.moved = true;
        pushUndo(g.snap);
        if (g.target.kind === 'ref') active = g.target.key;
      }
      m.px = Math.min(Math.max(0, m.px + (p.x - g.last.x) / view.k), source.width);
      m.py = Math.min(Math.max(0, m.py + (p.y - g.last.y) / view.k), source.height);
      g.last = p;
      showLoupe(m, p.x, p.y, g.touch);
      cal = calibrate(calibration());
      renderPanelSoon();
      queueDraw();
    } else if (g.type === 'pending') {
      if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > TAP_SLOP) {
        cancelHold();
        g = { type: 'pan', id: g.id, last: g.last };
        canvas.classList.add('is-panning');
      } else {
        g.last = p;
      }
    }
    if (g.type === 'pan') {
      view.tx += p.x - g.last.x;
      view.ty += p.y - g.last.y;
      g.last = p;
      queueDraw();
    } else if (g.type === 'aim') {
      g.last = p;
      showLoupe(toImg(p.x, p.y), p.x, p.y, true);
    }
  });

  function endPointer(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (!g) return;
    if (g.type === 'pinch') {
      if (ptrs.size === 1) {
        const [[id, p]] = [...ptrs.entries()];
        g = { type: 'pan', id, last: p };
      } else if (!ptrs.size) g = null;
      return;
    }
    if (g.id !== e.pointerId) return;
    const cancelled = e.type === 'pointercancel';
    cancelHold();
    hideLoupe();
    canvas.classList.remove('is-panning');
    if (g.type === 'drag' && g.moved) update();
    else if (g.type === 'drag' && !cancelled && g.target.kind === 'ref' && g.target.key !== active) place(g.start.x, g.start.y);
    else if (g.type === 'pending' && !cancelled) place(g.start.x, g.start.y);
    else if (g.type === 'aim' && !cancelled) place(g.last.x, g.last.y);
    g = null;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(p.x, p.y, Math.exp(-dy * 0.0015));
  }, { passive: false });

  // ---- keyboard --------------------------------------------------------------------------------
  root.addEventListener('keydown', (e) => {
    const inInput = e.target instanceof HTMLInputElement;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); askClose(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (inInput) return; // the input's own undo
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
      return;
    }
    if (inInput) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && step === 'points' && selected >= 0) {
      e.preventDefault();
      deleteSelected();
      return;
    }
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[e.key];
    const m = d && selectedMarker();
    if (!m) return;
    e.preventDefault();
    const p = markerPos(m);
    if (!e.repeat || !undoStack.length) pushUndo();
    const by = (e.shiftKey ? 10 : 1) / view.k;
    p.px = Math.min(Math.max(0, p.px + d[0] * by), source.width);
    p.py = Math.min(Math.max(0, p.py + d[1] * by), source.height);
    update();
  });
  // Focus stays in the view while it is open.
  document.addEventListener('focusin', (e) => {
    if (!root.hidden && !root.contains(e.target)) root.focus({ preventScroll: true });
  });

  // ---- panel ---------------------------------------------------------------------------------
  let panelQueued = false;
  function renderPanelSoon() {
    if (panelQueued) return;
    panelQueued = true;
    requestAnimationFrame(() => { panelQueued = false; renderPanel(); });
  }

  function renderPanel() {
    const calibrating = step === 'calibrate';
    setText(titleEl, calibrating ? 'Calibrate' : 'Tap points');
    setHidden(calBox, !calibrating);
    setHidden(ptBox, calibrating);
    gridBtn.setAttribute('aria-pressed', String(showGrid));
    gridBtn.disabled = !cal.ok;
    doneBtn.disabled = !cal.ok || (!calibrating && !points.length);
    setText(doneBtn, calibrating ? 'Next' : points.length > 1 ? `Add ${points.length} points` : 'Add point');
    setText(closeBtn.lastChild, confirmClose ? 'Discard?' : '');
    closeBtn.classList.toggle('is-confirm', !!confirmClose);

    if (calibrating) {
      for (const m of METHODS) methodBtns[m].setAttribute('aria-checked', String(m === method));
      setHidden(logRow, method === 'length');
      xLogSeg.set(xLog);
      yLogSeg.set(yLog);
      const pos = refPos[method];
      for (const [key, r] of Object.entries(refRows)) {
        const [m, k] = key.split(':');
        setHidden(r.row, m !== method);
        if (m !== method) continue;
        const isActive = k === active;
        r.row.classList.toggle('is-active', isActive);
        r.row.classList.toggle('is-error', !cal.ok && (cal.refs || []).includes(k) && !!pos[k]);
        r.btn.setAttribute('aria-pressed', String(isActive));
        setText(r.state, pos[k] ? (isActive ? 'Placed · tap to move' : 'Placed') : (isActive ? 'Tap the photo' : 'Not placed'));
      }
      for (const m of METHODS) setHidden(guideBodies[m], m !== method);
      const allPlaced = REFS[method].every((k) => pos[k]);
      setText(calHint, allPlaced
        ? 'Drag a marker to fine-tune it, with the magnifier showing where it is. Zoom in for accuracy.'
        : HINTS[active]);
      if (cal.ok && cal.warning) {
        setText(calStatus, cal.warning);
        calStatus.className = 'dg-status is-warn';
      } else if (cal.ok) {
        setText(calStatus, 'Calibrated. Check the grid lines match the photo, then tap Next to add points.');
        calStatus.className = 'dg-status is-ok';
      } else {
        setText(calStatus, /^Place /.test(cal.error) ? '' : cal.error);
        calStatus.className = 'dg-status is-error';
      }
    } else {
      setText(ptHint, points.length
        ? 'Tap to add a point; press and hold to aim with the magnifier. Drag a point to move it.'
        : 'Tap the photo to add a point; press and hold to aim with the magnifier. Zoom in for accuracy.');
      setText(ptCount, `${points.length} ${points.length === 1 ? 'point' : 'points'}`);
      clearBtn.hidden = !points.length;
      setText(clearBtn, confirmClear ? 'Tap again to clear' : 'Clear all');
      const p = selected >= 0 && points[selected];
      setHidden(selBox, !p);
      if (p && cal.ok) {
        const w = toWorld(cal.map, p.px, p.py);
        const r = resolution(cal.map, p.px, p.py);
        setText(selText, w ? `Point: x = ${numText(roundToResolution(w.x, r.x))}, y = ${numText(roundToResolution(w.y, r.y))}` : 'Point is off the graph');
      }
    }
  }

  // ---- open and close --------------------------------------------------------------------------
  function reset() {
    refPos = Object.fromEntries(METHODS.map((m) => [m, emptyRefs(m)]));
    points = [];
    method = 'axes';
    active = 'x1';
    selected = -1;
    step = 'calibrate';
    showGrid = true;
    undoStack = [];
    redoStack = [];
    for (const el of Object.values(inputs)) el.value = '';
    guideAuto = true;
    guide.open = true;
    const axes = getAxes ? getAxes() : {};
    xLog = !!axes.xLog;
    yLog = !!axes.yLog;
    cal = calibrate(calibration());
  }

  // Opens the view on an image. Resolves to null, or to a message if it can't be opened.
  async function open(blob, fileName = '') {
    if (blob.size > MAX_FILE_BYTES) return `That image is ${(blob.size / 1048576).toFixed(1)} MB – the limit is ${MAX_FILE_BYTES / 1048576} MB.`;
    let img;
    try {
      img = await loadImage(blob);
    } catch {
      return `Couldn't open ${fileName || 'that image'}. Try a JPEG, PNG or screenshot (some phones save photos as HEIC, which browsers can't always read).`;
    }
    source = img;
    name = nameFromImage(fileName);
    reset();
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.hidden = false;
    document.documentElement.classList.add('is-digitising');
    renderPanel();
    stageW = 0; stageH = 0;
    resize();
    queueDraw();
    root.focus({ preventScroll: true });
    return null;
  }

  function close() {
    root.hidden = true;
    document.documentElement.classList.remove('is-digitising');
    hideLoupe();
    if (source) { source.width = 0; source.height = 0; } // let the image go
    source = null;
    points = [];
    refPos = {};
    g = null;
    ptrs.clear();
    clearTimeout(confirmClose);
    confirmClose = 0;
    if (returnFocus && returnFocus.isConnected && !(returnFocus instanceof HTMLInputElement)) returnFocus.focus();
    returnFocus = null;
  }

  // Closing loses the work, so with anything placed it takes a second tap.
  function askClose() {
    const placedAny = points.length || Object.values(refPos[method] || {}).some(Boolean);
    if (!placedAny || confirmClose) { close(); return; }
    confirmClose = window.setTimeout(() => { confirmClose = 0; renderPanel(); }, 3000);
    renderPanel();
  }

  function finish() {
    if (!cal.ok || !points.length) return;
    const pts = digitisedPoints(cal.map, points);
    const done = onDone(pts, name);
    if (done !== false) close();
  }

  const ro = new ResizeObserver(() => { if (!root.hidden) resize(); });
  ro.observe(stage);

  return { open, isOpen: () => !root.hidden, close };
}

