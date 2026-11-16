// Entry point: wires state, analysis and the UI together.
import { createStore } from './state/store.js';
import { load, save } from './state/persist.js';
import { analyse } from './expr/model.js';
import { createGraphView } from './ui/graph-view.js';
import { createExprList } from './ui/expr-list.js';
import { createKeypad } from './ui/keypad.js';
import { createSheet } from './ui/sheet.js';
import { createCalcPanel } from './ui/calc-panel.js';
import { createSolvePanel } from './ui/solve-panel.js';
import { createDataPanel } from './ui/data-panel.js';
import { createHelp } from './ui/help.js';
import { symbolShortcut } from './expr/shortcuts.js';
import { newRow, nextColor } from './state/defaults.js';
import { createSettings } from './ui/settings.js';
import { ICONS } from './ui/icons.js';
import { debounce } from './ui/dom.js';

const $ = (id) => document.getElementById(id);

// ---- state ----------------------------------------------------------------------------
const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const store = createStore(storage ? load(storage) : load({ getItem: () => null }));
let analysis = analyse(store.get().rows, store.get().settings);
const getAnalysis = () => analysis;

const persist = debounce(() => storage && save(storage, store.get()), 400);
window.addEventListener('pagehide', () => persist.flush());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist.flush();
});

// ---- icons in static markup -------------------------------------------------------------
for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon];

// ---- components ----------------------------------------------------------------------------
const graph = createGraphView({ canvas: $('graph-canvas'), store, getAnalysis });
$('btn-zoom-in').addEventListener('click', () => graph.zoomBy(1.5));
$('btn-zoom-out').addEventListener('click', () => graph.zoomBy(1 / 1.5));
$('btn-home').addEventListener('click', () => graph.home());
$('btn-fit').addEventListener('click', () => graph.fit());

const exprList = createExprList({ listEl: $('expr-list'), addBtn: $('btn-add-row'), store, graph });

// "Show on graph" from the Solve tab: add the rows (unless they are already there), switch
// to the graph, frame the solutions and select the first curve so its points show.
function showOnGraph(result) {
  let firstId = null;
  store.update((s) => {
    const rows = [...s.rows];
    let nextId = s.nextId;
    // New rows go before any blank rows at the end of the list.
    let at = rows.length;
    while (at > 0 && !rows[at - 1].text.trim()) at--;
    for (const text of result.graph) {
      const i = rows.findIndex((r) => r.text.trim() === text);
      if (i >= 0) {
        if (rows[i].hidden) rows[i] = { ...rows[i], hidden: false };
        if (firstId === null) firstId = rows[i].id;
        continue;
      }
      const row = newRow(nextId++, nextColor(rows), text);
      rows.splice(at++, 0, row);
      if (firstId === null) firstId = row.id;
    }
    return { ...s, rows, nextId, ui: { ...s.ui, tab: 'graph' } };
  });
  if (result.frame) graph.frameX(result.frame[0], result.frame[1]);
  if (firstId !== null) graph.select(firstId);
}

graph.onViewChange(debounce(() => exprList.refresh(), 250));

createHelp({ backdrop: $('help'), openBtn: $('btn-help'), getTab: () => store.get().ui.tab });

const solvePanel = createSolvePanel({ root: $('tab-solve'), store, getAnalysis, onShowOnGraph: showOnGraph });

const dataPanel = createDataPanel({
  root: $('tab-data'), store, getAnalysis, onFrame: (bounds) => graph.frameBounds(bounds),
});

const calc = createCalcPanel({
  historyEl: $('calc-history'), input: $('calc-input'), equalsBtn: $('calc-equals'),
  clearBtn: $('calc-clear'), emptyEl: $('calc-empty'), store, getAnalysis,
});

const buildMeta = document.querySelector('meta[name="build-info"]');
const buildInfo = buildMeta && !buildMeta.content.startsWith('__') ? buildMeta.content : 'development build';
const settings = createSettings({ popover: $('settings'), toggleBtn: $('btn-settings'), store, buildInfo });

const panel = $('panel');
createSheet({ panel, handle: $('sheet-handle') });

// ---- keypad ------------------------------------------------------------------------------
const keypadEl = $('keypad');
const coarse = window.matchMedia('(pointer: coarse)');
let activeInput = null;
let systemKeyboard = false;

function keypadWanted() {
  const mode = store.get().settings.keypad;
  return !systemKeyboard && (mode === 'always' || (mode === 'auto' && coarse.matches));
}

// inputmode="none" stops the phone keyboard opening while our keypad is in use.
function syncInputModes() {
  const mode = keypadWanted() ? 'none' : 'text';
  for (const el of document.querySelectorAll('input[data-keypad]')) {
    if (el.inputMode !== mode) el.inputMode = mode;
  }
}

function showKeypad(show) {
  if (keypadEl.hidden === !show) return;
  keypadEl.hidden = !show;
  panel.classList.toggle('keypad-open', show);
  if (show && activeInput) requestAnimationFrame(() => activeInput && activeInput.scrollIntoView({ block: 'nearest' }));
}

createKeypad({
  el: keypadEl,
  getTarget: () => activeInput,
  onHide() {
    if (activeInput) activeInput.blur();
  },
  onSystemKeyboard() {
    if (!activeInput) return;
    systemKeyboard = true;
    const target = activeInput;
    showKeypad(false);
    syncInputModes();
    target.blur();
    target.focus();
  },
});

// On-screen keypad button (mouse and keyboard devices): switches the keypad between
// "Always" and "Auto" (which means off with a mouse), and applies it straight away.
const keypadBtn = $('btn-keypad');
keypadBtn.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the input
keypadBtn.addEventListener('click', () => {
  const on = store.get().settings.keypad !== 'always';
  store.update((s) => ({ ...s, settings: { ...s.settings, keypad: on ? 'always' : 'auto' } }));
  systemKeyboard = false;
  syncInputModes();
  if (activeInput) showKeypad(keypadWanted());
});

// Typing shortcuts: "theta" -> θ, "pi" -> π, "<=" -> ≤, ">=" -> ≥. Runs before the
// inputs' own handlers (capture phase), only for typed text (the keypad's own input
// events have no inputType).
panel.addEventListener('input', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || !t.hasAttribute('data-keypad')) return;
  if (!e.inputType || !e.inputType.startsWith('insert')) return;
  const caret = t.selectionStart;
  if (caret === null || caret !== t.selectionEnd) return;
  const hit = symbolShortcut(t.value.slice(0, caret));
  if (hit) t.setRangeText(hit.replacement, hit.start, caret, 'end');
}, true);

panel.addEventListener('focusin', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || !t.hasAttribute('data-keypad')) return;
  activeInput = t;
  syncInputModes();
  showKeypad(keypadWanted());
});
panel.addEventListener('focusout', (e) => {
  const next = e.relatedTarget;
  if (next instanceof HTMLInputElement && next.hasAttribute('data-keypad')) return;
  // Focus left the inputs: hide the keypad (after any keypad tap has been handled).
  setTimeout(() => {
    const a = document.activeElement;
    if (a instanceof HTMLInputElement && a.hasAttribute('data-keypad')) return;
    activeInput = null;
    systemKeyboard = false;
    showKeypad(false);
    syncInputModes();
  }, 0);
});
// Tapping the graph dismisses the keypad.
$('graph').addEventListener('pointerdown', () => {
  if (activeInput) activeInput.blur();
});

// ---- tabs ---------------------------------------------------------------------------------
const tabButtons = [...document.querySelectorAll('.tab-bar [role="tab"]')];
// Tabs that use the whole screen (no graph). Graph and Data keep the graph visible.
const FULL_PAGE_TABS = new Set(['calc', 'solve']);
const appEl = $('app');
for (const tab of tabButtons) {
  tab.addEventListener('click', () => store.update((s) => ({ ...s, ui: { ...s.ui, tab: tab.dataset.tab } })));
}
function renderTabs(state) {
  appEl.classList.toggle('full-panel', FULL_PAGE_TABS.has(state.ui.tab));
  for (const t of tabButtons) {
    const selected = t.dataset.tab === state.ui.tab;
    t.setAttribute('aria-selected', String(selected));
    t.tabIndex = selected ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !selected;
  }
}

// ---- data files: drag and drop, and pasting outside an input -------------------------------
const showDataTab = () => store.update((s) => (s.ui.tab === 'data' ? s : { ...s, ui: { ...s.ui, tab: 'data' } }));
const hasFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  appEl.classList.add('is-dropping');
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) appEl.classList.remove('is-dropping');
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  appEl.classList.remove('is-dropping');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  showDataTab();
  dataPanel.openFile(file);
});
document.addEventListener('paste', (e) => {
  const t = e.target;
  if (store.get().ui.tab !== 'data' || (t instanceof HTMLElement && t.closest('input, textarea, [contenteditable]'))) return;
  const text = e.clipboardData && e.clipboardData.getData('text/plain');
  if (!text || !text.trim()) return;
  e.preventDefault();
  dataPanel.pasteText(text);
});

// ---- render loop ---------------------------------------------------------------------------
function renderAll(state) {
  exprList.render(state, analysis);
  calc.render(state);
  solvePanel.render(state);
  dataPanel.render(state);
  settings.render(state);
  keypadBtn.setAttribute('aria-pressed', String(state.settings.keypad === 'always'));
  renderTabs(state);
  graph.requestDraw();
}

store.subscribe((state, prev) => {
  if (state.rows !== prev.rows || state.settings !== prev.settings) {
    analysis = analyse(state.rows, state.settings);
  }
  if (state.settings !== prev.settings) {
    syncInputModes();
    if (activeInput) showKeypad(keypadWanted());
  }
  renderAll(state);
  persist();
});

renderAll(store.get());
syncInputModes();
