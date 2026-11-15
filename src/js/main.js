// Entry point: wires state, analysis and the UI together.
import { createStore } from './state/store.js';
import { load, save } from './state/persist.js';
import { analyse } from './expr/model.js';
import { createGraphView } from './ui/graph-view.js';
import { createExprList } from './ui/expr-list.js';
import { createKeypad } from './ui/keypad.js';
import { createSheet } from './ui/sheet.js';
import { createCalcPanel } from './ui/calc-panel.js';
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

const exprList = createExprList({ listEl: $('expr-list'), addBtn: $('btn-add-row'), store });

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
const tabButtons = [...document.querySelectorAll('[role="tab"]')];
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

// ---- render loop ---------------------------------------------------------------------------
function renderAll(state) {
  exprList.render(state, analysis);
  calc.render(state);
  settings.render(state);
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
