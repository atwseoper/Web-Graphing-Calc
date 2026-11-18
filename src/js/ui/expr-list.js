// The list of expression rows in the Graph tab.
import { h, setText, setHidden } from './dom.js';
import { ICONS } from './icons.js';
import { newRow, nextColor, MAX_ODE_POINTS } from '../state/defaults.js';
import { formatNumber } from '../expr/format.js';
import { defaultDomain } from '../expr/model.js';
import { niceStep } from '../plot/viewport.js';
import { sliderRange, snapToStep, valueText } from '../expr/slider.js';
import { integrate } from '../numerics/integrate.js';
import { isPlottable, isFunctionOfX, fieldValue } from './graph-view.js';
import { parse } from '../expr/parser.js';
import { prettyLayout, isRich } from '../expr/pretty.js';
import { renderMath } from './math-view.js';

const ERROR_DELAY = 900; // ms after the last keystroke before showing an error in the row being edited
const TABLE_ROWS = 10;
const MAX_POI_CHIPS = 12;
const POI_SHORT = { root: 'Root', max: 'Max', min: 'Min', 'y-intercept': 'y-int', intersection: '∩' };
const MINUS = '−';
const fmt = (v, sig = 8) => formatNumber(v, sig);
const SLIDER_SWEEP_MS = 4000; // a playing slider crosses its whole range in this time

const INPUT_ATTRS = {
  autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'next',
};

export function createExprList({ listEl, addBtn, store, graph }) {
  const els = new Map(); // row id -> element refs
  const lastEdit = new Map(); // row id -> timestamp
  let errorTimer = 0;
  let latest = null; // { state, analysis }

  // ---- state updates -----------------------------------------------------------------
  const updateRow = (id, patch) => store.update((s) => ({
    ...s, rows: s.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }));

  function insertRow(afterId, text = '', { focus = true } = {}) {
    let id;
    store.update((s) => {
      id = s.nextId;
      const row = newRow(id, nextColor(s.rows), text);
      const rows = [...s.rows];
      const at = afterId == null ? rows.length : rows.findIndex((r) => r.id === afterId) + 1;
      rows.splice(at, 0, row);
      return { ...s, nextId: id + 1, rows };
    });
    if (focus) focusRow(id);
    return id;
  }

  // Sliders for undefined names: a = 1, b = 1 … inserted after the row that needs them.
  function addSliders(afterId, names) {
    let after = afterId;
    for (const n of names) after = insertRow(after, `${n} = 1`, { focus: false });
  }

  const rowById = (id) => store.get().rows.find((k) => k.id === id);

  function deleteRow(id, focusNeighbour = false) {
    const rows = store.get().rows;
    const idx = rows.findIndex((r) => r.id === id);
    const neighbour = rows[idx - 1] || rows[idx + 1];
    store.update((s) => {
      const left = s.rows.filter((r) => r.id !== id);
      if (left.length) return { ...s, rows: left };
      const fresh = newRow(s.nextId, nextColor([]));
      return { ...s, nextId: s.nextId + 1, rows: [fresh] };
    });
    if (focusNeighbour && neighbour) focusRow(neighbour.id, true);
  }

  function focusRow(id, atEnd = false) {
    const e = els.get(id);
    if (!e) return;
    e.input.focus();
    if (atEnd) {
      const n = e.input.value.length;
      e.input.setSelectionRange(n, n);
    }
    e.li.scrollIntoView({ block: 'nearest' });
  }

  addBtn.addEventListener('click', () => {
    const rows = store.get().rows;
    const last = rows[rows.length - 1];
    if (last && !last.text.trim()) focusRow(last.id);
    else insertRow(null);
  });

  // ---- row elements -------------------------------------------------------------------
  function createRowEls(row) {
    const id = row.id;
    const input = h('input', {
      class: 'expr-input', type: 'text', ...INPUT_ATTRS, 'data-keypad': '',
      'aria-label': 'Expression', placeholder: 'Type an expression, e.g. y = x²',
    });
    input.addEventListener('input', () => {
      lastEdit.set(id, Date.now());
      updateRow(id, { text: input.value });
      scheduleErrorRefresh();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        insertRow(id);
      } else if (e.key === 'Backspace' && input.value === '' && store.get().rows.length > 1) {
        e.preventDefault();
        deleteRow(id, true);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const rows = store.get().rows;
        const idx = rows.findIndex((r) => r.id === id) + (e.key === 'ArrowUp' ? -1 : 1);
        if (rows[idx]) {
          e.preventDefault();
          focusRow(rows[idx].id, true);
        }
      }
    });
    input.addEventListener('blur', () => scheduleErrorRefresh(0));
    // Keypad events (see keypad.js)
    input.addEventListener('keypad-enter', () => insertRow(id));
    input.addEventListener('keypad-backspace-empty', () => {
      if (store.get().rows.length > 1) deleteRow(id, true);
    });

    const swatch = h('button', {
      class: 'swatch', type: 'button',
      onClick: () => {
        const r = store.get().rows.find((k) => k.id === id);
        if (r) updateRow(id, { hidden: !r.hidden });
      },
    });
    const num = h('span', { class: 'row-num', 'aria-hidden': 'true' });
    const status = h('div', { class: 'expr-status', 'aria-live': 'polite' });
    const pretty = h('div', { class: 'expr-pretty math', 'aria-hidden': 'true', hidden: true });
    input.addEventListener('focus', () => {
      const i = store.get().rows.findIndex((k) => k.id === id);
      if (latest && isFunctionOfX(latest.analysis.rows[i]) && graph) graph.select(id);
    });

    // "Add slider" chips for undefined names.
    const missing = h('div', { class: 'missing', hidden: true });
    missing.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-names]');
      if (b) addSliders(id, b.dataset.names.split(','));
    });

    // Slider for a = <number>.
    const range = h('input', { class: 'slider', type: 'range', 'aria-label': 'Value' });
    const sMin = h('input', { class: 'mini-input slider-bound', type: 'text', ...INPUT_ATTRS, 'data-keypad': '', 'aria-label': 'Slider minimum' });
    const sMax = h('input', { class: 'mini-input slider-bound', type: 'text', ...INPUT_ATTRS, 'data-keypad': '', 'aria-label': 'Slider maximum' });
    sMin.addEventListener('input', () => updateRow(id, { sliderMin: sMin.value }));
    sMax.addEventListener('input', () => updateRow(id, { sliderMax: sMax.value }));
    range.addEventListener('input', () => {
      const e2 = els.get(id);
      if (!e2 || !e2.sliderName) return;
      const step = Number(range.step) || 0.1;
      const v = snapToStep(Number(range.value), Number(range.min), step);
      updateRow(id, { text: `${e2.sliderName} = ${valueText(v)}` });
    });
    range.addEventListener('pointerdown', () => stopPlaying(id));
    const playBtn = h('button', {
      class: 'row-btn play-btn', type: 'button', html: ICONS.play, 'aria-label': 'Play: move the slider back and forth', 'aria-pressed': 'false',
      onClick: () => togglePlaying(id),
    });
    const sStep = h('input', { class: 'mini-input slider-step', type: 'text', ...INPUT_ATTRS, 'data-keypad': '', 'aria-label': 'Slider step' });
    sStep.addEventListener('input', () => updateRow(id, { sliderStep: sStep.value }));
    const stepRow = h('label', { class: 'slider-step-row' }, h('span', { class: 'an-label' }, 'Step'), sStep);
    const slider = h('div', { class: 'expr-slider', hidden: true },
      h('div', { class: 'slider-main' }, playBtn, sMin, range, sMax), stepRow);

    // Analysis panel.
    const derivText = h('span', { class: 'an-deriv' });
    const derivBtn = h('button', {
      type: 'button', class: 'chip', 'aria-pressed': 'false',
      onClick: () => {
        const r = rowById(id);
        if (r) updateRow(id, { showDeriv: !r.showDeriv });
      },
    }, 'Show');
    const derivRow = h('div', { class: 'an-row' }, derivText, derivBtn);
    const atInput = h('input', { class: 'mini-input', type: 'text', ...INPUT_ATTRS, 'data-keypad': '', 'aria-label': 'x value' });
    atInput.addEventListener('input', () => updateRow(id, { atX: atInput.value }));
    const atOut = h('div', { class: 'an-out' });
    const atRow = h('div', { class: 'an-block' }, h('label', { class: 'an-row' }, h('span', { class: 'an-label' }, 'At x ='), atInput), atOut);
    const intFrom = h('input', { class: 'mini-input', type: 'text', ...INPUT_ATTRS, 'data-keypad': '', 'aria-label': 'Integral from' });
    const intTo = h('input', { class: 'mini-input', type: 'text', ...INPUT_ATTRS, 'data-keypad': '', 'aria-label': 'Integral to' });
    intFrom.addEventListener('input', () => updateRow(id, { intFrom: intFrom.value }));
    intTo.addEventListener('input', () => updateRow(id, { intTo: intTo.value }));
    const intLabel = h('span', { class: 'an-label' });
    const intVar = h('span', { class: 'an-label' });
    const intOut = h('div', { class: 'an-out' });
    const intRow = h('div', { class: 'an-block' }, h('div', { class: 'an-row' }, intLabel, intFrom, intVar, intTo), intOut);
    const poiHead = h('div', { class: 'an-note' });
    const poiList = h('div', { class: 'poi-list' });
    poiList.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-x]');
      if (b && graph) graph.showPoint(id, Number(b.dataset.x), Number(b.dataset.y), b.dataset.kind);
    });
    const poiBlock = h('div', { class: 'an-block' }, poiList, poiHead);
    const analysisPanel = h('div', { class: 'expr-analysis', hidden: true }, derivRow, atRow, intRow, poiBlock);
    const analysisBtn = h('button', {
      class: 'row-btn', type: 'button', html: ICONS.analyse, 'aria-label': 'Analyse: derivative, values, integral', 'aria-pressed': 'false',
      onClick: () => {
        const r = rowById(id);
        if (r) updateRow(id, { showAnalysis: !r.showAnalysis });
      },
    });

    const domMinInput = h('input', { class: 'mini-input', type: 'text', ...INPUT_ATTRS, 'data-keypad': '', 'aria-label': 'Start of range' });
    const domMaxInput = h('input', { class: 'mini-input', type: 'text', ...INPUT_ATTRS, 'data-keypad': '', 'aria-label': 'End of range' });
    domMinInput.addEventListener('input', () => updateRow(id, { domainMin: domMinInput.value }));
    domMaxInput.addEventListener('input', () => updateRow(id, { domainMax: domMaxInput.value }));
    const domVar1 = h('span', { class: 'dom-var' });
    const domError = h('div', { class: 'expr-status is-error', hidden: true });
    const sweepBtn = h('button', {
      class: 'row-btn play-btn', type: 'button', html: ICONS.play, 'aria-pressed': 'false',
      onClick: () => graph && graph.toggleSweep(id),
    });
    const domain = h('div', { class: 'expr-domain', hidden: true },
      h('div', { class: 'domain-row' }, domMinInput, h('span', { class: 'le' }, '≤'), domVar1, h('span', { class: 'le' }, '≤'), domMaxInput, sweepBtn),
      domError,
    );

    // Solution curves of a slope field (D43): starting points, added by tapping the graph.
    const odeList = h('div', { class: 'ode-list' });
    odeList.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-k]');
      if (!b) return;
      const r = rowById(id);
      if (r) updateRow(id, { odePoints: r.odePoints.filter((_, k) => k !== Number(b.dataset.k)) });
    });
    const odeAdd = h('button', {
      type: 'button', class: 'chip', 'aria-pressed': 'false',
      onClick: () => {
        if (!graph) return;
        if (armedRow === id) {
          graph.armTap(null);
          return;
        }
        armedRow = id;
        graph.armTap((x, y) => {
          const r = rowById(id);
          if (!r) return;
          updateRow(id, { odePoints: [...r.odePoints, [roundForScreen(x, 'x'), roundForScreen(y, 'y')]].slice(-MAX_ODE_POINTS) });
        });
      },
    }, '+ Solution curve');
    const odeHint = h('span', { class: 'an-label', hidden: true }, 'Tap the graph where it should start');
    const ode = h('div', { class: 'expr-ode', hidden: true }, odeList, h('div', { class: 'an-row' }, odeAdd, odeHint));

    const tStart = h('input', { class: 'mini-input', type: 'text', ...INPUT_ATTRS, 'data-keypad': '', 'aria-label': 'Table start', placeholder: '0' });
    const tStep = h('input', { class: 'mini-input', type: 'text', ...INPUT_ATTRS, 'data-keypad': '', 'aria-label': 'Table step', placeholder: '1' });
    tStart.addEventListener('input', () => updateRow(id, { tableStart: tStart.value }));
    tStep.addEventListener('input', () => updateRow(id, { tableStep: tStep.value }));
    const tHeadA = h('th');
    const tHeadB = h('th');
    const tBody = h('tbody');
    const tableErr = h('div', { class: 'expr-status is-error', hidden: true });
    const table = h('div', { class: 'expr-table', hidden: true },
      h('div', { class: 'table-controls' },
        h('label', {}, 'Start ', tStart),
        h('label', {}, 'Step ', tStep),
      ),
      tableErr,
      h('table', {}, h('thead', {}, h('tr', {}, tHeadA, tHeadB)), tBody),
    );

    const tableBtn = h('button', {
      class: 'row-btn', type: 'button', html: ICONS.table, 'aria-label': 'Table of values', 'aria-pressed': 'false',
      onClick: () => {
        const r = store.get().rows.find((k) => k.id === id);
        if (r) updateRow(id, { showTable: !r.showTable });
      },
    });
    const delBtn = h('button', {
      class: 'row-btn', type: 'button', html: ICONS.close, 'aria-label': 'Delete expression',
      onClick: () => deleteRow(id),
    });

    const li = h('li', { class: 'expr-row', dataset: { id: String(id) } },
      h('div', { class: 'row-left' }, swatch, num),
      h('div', { class: 'expr-main' }, input, pretty, status, missing, slider, domain, ode, table),
      h('div', { class: 'row-actions' }, analysisBtn, tableBtn, delBtn),
      analysisPanel,
    );
    return {
      li, input, swatch, num, status, domain, domMinInput, domMaxInput, domVar1, domError,
      table, tStart, tStep, tHeadA, tHeadB, tBody, tableErr, tableBtn,
      missing, missingKey: '', slider, range, sMin, sMax, sStep, playBtn, sliderName: null, pretty, prettyKey: null,
      sweepBtn, ode, odeList, odeAdd, odeHint, odeKey: '',
      analysisBtn, analysisPanel, derivRow, derivText, derivBtn, atRow, atInput, atOut,
      intRow, intLabel, intVar, intFrom, intTo, intOut, poiBlock, poiHead, poiList, poiKey: '',
    };
  }

  function scheduleErrorRefresh(delay = ERROR_DELAY + 50) {
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => latest && render(latest.state, latest.analysis), delay);
  }

  // ---- render ---------------------------------------------------------------------------
  function render(state, analysis) {
    latest = { state, analysis };
    const ids = new Set(state.rows.map((r) => r.id));
    for (const [id, e] of els) {
      if (!ids.has(id)) {
        e.li.remove();
        stopPlaying(id);
        els.delete(id);
        lastEdit.delete(id);
      }
    }
    state.rows.forEach((row, i) => {
      let e = els.get(row.id);
      if (!e) {
        e = createRowEls(row);
        els.set(row.id, e);
      }
      if (listEl.children[i] !== e.li) listEl.insertBefore(e.li, listEl.children[i] || null);
      renderRow(e, row, analysis.rows[i], i, analysis);
    });
  }

  function syncInput(input, value) {
    if (input.value !== value) input.value = value;
  }

  function renderRow(e, row, r, index, analysis) {
    syncInput(e.input, row.text);
    const plottable = isPlottable(r);
    e.li.style.setProperty('--row-color', row.color);
    e.li.classList.toggle('is-plottable', plottable);
    e.li.classList.toggle('is-hidden', plottable && row.hidden);
    setHidden(e.swatch, !plottable);
    setHidden(e.num, plottable);
    setText(e.num, String(index + 1));
    e.swatch.setAttribute('aria-label', row.hidden ? 'Show graph' : 'Hide graph');
    e.swatch.setAttribute('aria-pressed', String(!row.hidden));

    // Status line: error, value, or nothing.
    const editing = document.activeElement === e.input && Date.now() - (lastEdit.get(row.id) || 0) < ERROR_DELAY;
    let text = '';
    let cls = '';
    if (r.kind === 'error' && !editing) {
      text = r.error.message;
      cls = 'is-error';
    } else if (r.kind === 'value') {
      text = `= ${formatNumber(r.value)}`;
      cls = 'is-value';
    } else if (r.kind === 'variable' && !/^\s*[^=]+=\s*[-−]?\s*[\d.]+\s*$/.test(row.text)) {
      text = `= ${formatNumber(r.value)}`;
      cls = 'is-value';
    }
    renderPretty(e, row, r, cls === 'is-error' || r.kind === 'error');
    setText(e.status, text);
    e.status.className = `expr-status ${cls}`;
    setHidden(e.status, !text);
    e.li.classList.toggle('has-error', cls === 'is-error');

    // Offer sliders for undefined names.
    const names = r.kind === 'error' && !editing && r.error.missing ? r.error.missing : [];
    setHidden(e.missing, !names.length);
    const key = names.join(',');
    if (key !== e.missingKey) {
      e.missingKey = key;
      const chips = names.slice(0, 6).map((n) => h('button', { type: 'button', class: 'chip', dataset: { names: n } }, n));
      if (names.length > 1) chips.push(h('button', { type: 'button', class: 'chip chip-all', dataset: { names: key } }, 'all'));
      e.missing.replaceChildren(h('span', { class: 'an-label' }, names.length > 1 ? 'Add sliders:' : 'Add slider:'), ...chips);
    }

    renderSlider(e, row, r, analysis);

    // Domain for polar / parametric rows.
    const hasDomain = r.kind === 'polar' || r.kind === 'parametric';
    setHidden(e.domain, !hasDomain);
    if (hasDomain) {
      const def = defaultDomain(analysis.angle);
      e.domMinInput.placeholder = def.minText;
      e.domMaxInput.placeholder = def.maxText;
      syncInput(e.domMinInput, row.domainMin);
      syncInput(e.domMaxInput, row.domainMax);
      setText(e.domVar1, r.kind === 'polar' ? 'θ' : 't');
      renderSweepBtn(e, row.id, r.kind);
      const de = r.domainError;
      setHidden(e.domError, !de);
      if (de) setText(e.domError, de.message);
    }

    // Solution curves for slope fields.
    setHidden(e.ode, r.kind !== 'slope');
    if (r.kind === 'slope') renderOde(e, row);

    // Table of values.
    const tableable = r.kind === 'cartesian' || r.kind === 'cartesian-x' || (r.kind === 'function' && !!r.f);
    setHidden(e.tableBtn, !tableable);
    e.tableBtn.setAttribute('aria-pressed', String(!!row.showTable));
    const showTable = tableable && row.showTable;
    setHidden(e.table, !showTable);
    if (showTable) renderTable(e, row, r, analysis);

    // Analysis panel.
    const analysable = isFunctionOfX(r) || r.kind === 'polar';
    setHidden(e.analysisBtn, !analysable);
    e.analysisBtn.setAttribute('aria-pressed', String(!!row.showAnalysis));
    const showAnalysis = analysable && row.showAnalysis;
    setHidden(e.analysisPanel, !showAnalysis);
    if (showAnalysis) renderAnalysis(e, row, r, analysis);
  }

  // Maths preview under the row (D38): only when it shows something the typed text
  // doesn't (a fraction, power, root, Σ, subscript or |…|).
  function renderPretty(e, row, r, hasError) {
    const on = latest && latest.state.settings.pretty !== 'off';
    const src = row.text.trim();
    let key = null;
    if (on && src && !hasError && r.kind !== 'empty') key = src;
    if (key !== e.prettyKey) {
      e.prettyKey = key;
      let box = null;
      if (key) {
        try {
          box = prettyLayout(parse(src, { graph: true }));
        } catch {
          box = null;
        }
      }
      if (box && isRich(box)) e.pretty.replaceChildren(renderMath(box));
      else e.pretty.replaceChildren();
    }
    setHidden(e.pretty, !e.pretty.firstChild);
  }

  function renderOde(e, row) {
    const key = JSON.stringify(row.odePoints);
    if (key !== e.odeKey) {
      e.odeKey = key;
      e.odeList.replaceChildren(...row.odePoints.map(([x, y], k) => h('button', {
        type: 'button', class: 'chip ode-chip', dataset: { k: String(k) }, 'aria-label': `Remove the solution curve through (${fmt(x, 6)}, ${fmt(y, 6)})`,
      }, `(${fmt(x, 6)}, ${fmt(y, 6)})`, h('span', { class: 'chip-x', 'aria-hidden': 'true' }, '×'))));
    }
    const armed = armedRow === row.id && !!graph && graph.isArmed();
    e.odeAdd.setAttribute('aria-pressed', String(armed));
    setText(e.odeAdd, armed ? 'Cancel' : '+ Solution curve');
    setHidden(e.odeHint, !armed);
    e.odeAdd.disabled = !armed && row.odePoints.length >= MAX_ODE_POINTS;
  }

  // A tapped coordinate, rounded to about a pixel.
  function roundForScreen(v, axis) {
    const vp = graph && graph.viewport ? graph.viewport() : null;
    const scale = vp ? (axis === 'x' ? vp.scaleX : vp.scaleY) : 40;
    const step = niceStep(2 / scale);
    const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
    return Number((Math.round(v / step) * step).toFixed(Math.min(decimals, 12)));
  }

  function renderSweepBtn(e, id, kind) {
    const on = !!graph && graph.isSweeping(id);
    const v = kind === 'polar' ? 'θ' : 't';
    const state = `${on}:${v}`;
    if (e.sweepBtn.dataset.state === state) return;
    e.sweepBtn.dataset.state = state;
    e.sweepBtn.innerHTML = on ? ICONS.pause : ICONS.play;
    e.sweepBtn.setAttribute('aria-pressed', String(on));
    e.sweepBtn.setAttribute('aria-label', on ? 'Stop drawing' : `Draw the curve as ${v} increases`);
  }

  // ---- slider play button (D39) -------------------------------------------------------------
  const players = new Map(); // row id -> { raf, pos, dir, last }
  let armedRow = null; // row waiting for a tap on the graph (solution curves)
  if (graph) {
    graph.onArmChange((on) => {
      if (!on) armedRow = null;
      refresh();
    });
  }

  function stopPlaying(id) {
    const p = players.get(id);
    if (!p) return;
    cancelAnimationFrame(p.raf);
    players.delete(id);
    const e = els.get(id);
    if (e) renderPlayBtn(e, id);
  }

  function togglePlaying(id) {
    if (players.has(id)) {
      stopPlaying(id);
      return;
    }
    const e = els.get(id);
    if (!e || !e.sliderName) return;
    const p = { raf: 0, pos: Number(e.range.value), dir: 1, last: 0 };
    players.set(id, p);
    renderPlayBtn(e, id);
    const frame = (now) => {
      if (players.get(id) !== p) return;
      const el = els.get(id);
      if (!el || !el.sliderName || el.slider.hidden) {
        stopPlaying(id);
        return;
      }
      const lo = Number(el.range.min);
      const hi = Number(el.range.max);
      const step = Number(el.range.step) || (hi - lo) / 200;
      const dt = p.last ? Math.min(100, now - p.last) : 0;
      p.last = now;
      if (!(p.pos >= lo && p.pos <= hi)) p.pos = Math.min(hi, Math.max(lo, p.pos));
      p.pos += (p.dir * (hi - lo) * dt) / SLIDER_SWEEP_MS;
      if (p.pos >= hi) { p.pos = hi; p.dir = -1; }
      if (p.pos <= lo) { p.pos = lo; p.dir = 1; }
      const v = Math.min(hi, Math.max(lo, snapToStep(p.pos, lo, step)));
      const text = `${el.sliderName} = ${valueText(v)}`;
      const row = rowById(id);
      if (row && row.text !== text) updateRow(id, { text });
      p.raf = requestAnimationFrame(frame);
    };
    p.raf = requestAnimationFrame(frame);
  }

  function renderPlayBtn(e, id) {
    const on = players.has(id);
    if (e.playBtn.dataset.state === String(on)) return;
    e.playBtn.dataset.state = String(on);
    e.playBtn.innerHTML = on ? ICONS.pause : ICONS.play;
    e.playBtn.setAttribute('aria-pressed', String(on));
    e.playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play: move the slider back and forth');
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') for (const id of [...players.keys()]) stopPlaying(id);
  });

  function renderSlider(e, row, r, analysis) {
    const show = r.kind === 'variable' && r.slider && Number.isFinite(r.value);
    setHidden(e.slider, !show);
    if (!show) {
      e.sliderName = null;
      if (players.has(row.id)) stopPlaying(row.id);
      return;
    }
    e.sliderName = r.name;
    const v = r.value;
    const {
      lo, hi, step, autoStep, userStepOk, defLo, defHi,
    } = sliderRange(v, {
      min: fieldValue(analysis, row.sliderMin),
      max: fieldValue(analysis, row.sliderMax),
      step: fieldValue(analysis, row.sliderStep),
    });
    e.sStep.placeholder = formatNumber(autoStep, 6);
    syncInput(e.sStep, row.sliderStep);
    e.sStep.classList.toggle('is-invalid', !!row.sliderStep.trim() && !userStepOk);
    renderPlayBtn(e, row.id);
    e.sMin.placeholder = formatNumber(Math.min(defLo, hi - 1), 6);
    e.sMax.placeholder = formatNumber(Math.max(defHi, lo + 1), 6);
    syncInput(e.sMin, row.sliderMin);
    syncInput(e.sMax, row.sliderMax);
    const attrs = { min: String(lo), max: String(hi), step: String(step) };
    for (const [k, val] of Object.entries(attrs)) if (e.range[k] !== val) e.range[k] = val;
    if (document.activeElement !== e.range || Number(e.range.value) !== v) {
      const want = String(v);
      if (e.range.value !== want) e.range.value = want;
    }
    e.range.setAttribute('aria-valuetext', `${r.name} = ${formatNumber(v)}`);
  }

  // Derivative, value and tangent at x, integral, and points of interest in view.
  function renderAnalysis(e, row, r, analysis) {
    const polar = r.kind === 'polar';
    setHidden(e.derivRow, polar);
    setHidden(e.atRow, polar);
    setHidden(e.poiBlock, polar);
    syncInput(e.intFrom, row.intFrom);
    syncInput(e.intTo, row.intTo);

    if (polar) {
      const def = defaultDomain(analysis.angle);
      setText(e.intLabel, 'Area from θ =');
      setText(e.intVar, 'to');
      e.intFrom.placeholder = row.domainMin || def.minText;
      e.intTo.placeholder = row.domainMax || def.maxText;
      const a = fieldValue(analysis, row.intFrom) ?? r.domain.min;
      const b = fieldValue(analysis, row.intTo) ?? r.domain.max;
      const k = analysis.angle === 'deg' ? Math.PI / 180 : 1;
      const res = integrate((t) => {
        const rad = r.f(t);
        return 0.5 * rad * rad * k;
      }, a, b);
      renderIntegral(e.intOut, res, '½∫r² dθ', b - a > (analysis.angle === 'deg' ? 360 : 2 * Math.PI) + 1e-9
        ? 'The range is more than a full turn, so overlapping parts are counted more than once.' : '');
      return;
    }

    // Derivative
    const d = r.derivative ? r.derivative() : null;
    const name = r.kind === 'function' ? `${r.name}′(x)` : 'dy/dx';
    let dText;
    if (!d) dText = `${name}: can't be worked out here`;
    else if (d.text) dText = `${name} = ${pretty(d.text)}`;
    else dText = `${name}: worked out numerically`;
    setText(e.derivText, dText);
    e.derivBtn.setAttribute('aria-pressed', String(!!row.showDeriv));
    setText(e.derivBtn, row.showDeriv ? 'Shown' : 'Show');
    e.derivBtn.disabled = !d;

    // Value, slope and tangent at x
    e.atInput.placeholder = 'e.g. 1';
    syncInput(e.atInput, row.atX);
    const a = fieldValue(analysis, row.atX);
    let at = '';
    let atErr = false;
    if (row.atX.trim()) {
      const ev = analysis.evaluate(row.atX);
      if (ev.error) {
        at = ev.error.message;
        atErr = true;
      } else if (a !== null) {
        const y = r.f(a);
        if (!Number.isFinite(y)) {
          at = `${r.kind === 'function' ? r.name + '(x)' : 'y'} is undefined at x = ${fmt(a)}`;
          atErr = true;
        } else {
          const m = d ? d.f(a) : NaN;
          const lines = [`y = ${fmt(y)}`];
          if (Number.isFinite(m)) {
            lines.push(`gradient ${fmt(m)}`);
            let c = y - m * a;
            if (Math.abs(c) < 1e-12 * Math.max(1, Math.abs(y), Math.abs(m * a))) c = 0;
            let tangent = m === 0 ? fmt(y) : `${fmtCoef(m)}x`;
            if (m !== 0 && c !== 0) tangent += ` ${c < 0 ? MINUS : '+'} ${fmt(Math.abs(c))}`;
            lines.push(`tangent y = ${tangent}`);
          } else {
            lines.push('no gradient here');
          }
          at = lines.join(' · ');
        }
      }
    }
    setText(e.atOut, at);
    e.atOut.classList.toggle('is-error', atErr);
    setHidden(e.atOut, !at);

    // Integral
    setText(e.intLabel, '∫ from');
    setText(e.intVar, 'to');
    e.intFrom.placeholder = 'a';
    e.intTo.placeholder = 'b';
    const ia = fieldValue(analysis, row.intFrom);
    const ib = fieldValue(analysis, row.intTo);
    const badBound = [row.intFrom, row.intTo].map((t) => (t.trim() ? analysis.evaluate(t) : null)).find((v) => v && v.error);
    if (badBound) {
      setText(e.intOut, badBound.error.message);
      e.intOut.classList.add('is-error');
      setHidden(e.intOut, false);
    } else if (ia !== null && ib !== null) {
      renderIntegral(e.intOut, integrate(r.f, ia, ib), '∫', '');
    } else {
      setHidden(e.intOut, true);
    }

    // Points of interest in the visible range
    const data = graph ? graph.pointsFor(row.id) : null;
    if (!data) {
      setText(e.poiHead, 'Open the graph to list roots, extrema and intersections.');
      e.poiList.replaceChildren();
      e.poiKey = '';
      return;
    }
    const pois = [...data.pois].sort((p, q) => p.x - q.x);
    const key = `${data.xMin}|${data.xMax}|${pois.map((p) => `${p.kind}${p.x}`).join()}`;
    if (key === e.poiKey) return;
    e.poiKey = key;
    const chips = pois.slice(0, MAX_POI_CHIPS).map((p) => {
      const text = p.kind === 'root' ? `Root ${fmt(p.x, 6)}` : `${POI_SHORT[p.kind]} (${fmt(p.x, 6)}, ${fmt(p.y, 6)})`;
      return h('button', { type: 'button', class: 'chip poi-chip', dataset: { x: String(p.x), y: String(p.y), kind: p.kind } }, text);
    });
    e.poiList.replaceChildren(...chips);
    const more = pois.length > MAX_POI_CHIPS ? ` Showing ${MAX_POI_CHIPS} of ${pois.length}.` : '';
    setText(e.poiHead, pois.length
      ? `In view, x from ${fmt(data.xMin, 4)} to ${fmt(data.xMax, 4)}. Tap a point to mark it. Points closer together than the screen can show may be missed.${more}`
      : `No roots, extrema or intersections for x from ${fmt(data.xMin, 4)} to ${fmt(data.xMax, 4)}. Pan or zoom to look elsewhere.`);
  }

  function renderIntegral(el, res, symbol, note) {
    el.classList.toggle('is-error', !res.ok);
    let text;
    if (!res.ok) text = res.message;
    else {
      const err = res.error > 0 ? ` (± ${formatNumber(res.error, 2)})` : '';
      text = `${symbol} = ${fmt(res.value, 10)}${err}`;
      if (res.message) text += ` – ${res.message}`;
      if (note) text += ` ${note}`;
    }
    setText(el, text);
    setHidden(el, false);
  }

  // Display form of printed maths: proper minus signs and dots.
  function pretty(text) {
    return text.replace(/(?<!\de)-/g, MINUS);
  }

  function fmtCoef(m) {
    if (m === 1) return '';
    if (m === -1) return MINUS;
    return fmt(m);
  }

  function renderTable(e, row, r, analysis) {
    syncInput(e.tStart, row.tableStart);
    syncInput(e.tStep, row.tableStep);
    const inVar = r.kind === 'cartesian-x' ? 'y' : 'x';
    const outVar = r.kind === 'cartesian-x' ? 'x' : r.kind === 'function' ? `${r.name}(x)` : 'y';
    setText(e.tHeadA, inVar);
    setText(e.tHeadB, outVar);
    const start = row.tableStart.trim() ? analysis.evaluate(row.tableStart) : { value: 0 };
    const step = row.tableStep.trim() ? analysis.evaluate(row.tableStep) : { value: 1 };
    const err = start.error ? `Start: ${start.error.message}` : step.error ? `Step: ${step.error.message}` : '';
    setHidden(e.tableErr, !err);
    setText(e.tableErr, err);
    e.tBody.textContent = '';
    if (err) return;
    for (let k = 0; k < TABLE_ROWS; k++) {
      const v = start.value + k * step.value;
      e.tBody.append(h('tr', {}, h('td', {}, formatNumber(v)), h('td', {}, formatNumber(r.f(v)))));
    }
  }

  // Re-render with the latest state, e.g. after the graph view moved (points in view).
  function refresh() {
    if (latest) render(latest.state, latest.analysis);
  }

  return { render, refresh, insertRow, focusRow, stopPlaying };
}
