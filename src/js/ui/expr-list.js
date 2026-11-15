// The list of expression rows in the Graph tab.
import { h, setText, setHidden } from './dom.js';
import { ICONS } from './icons.js';
import { newRow, nextColor } from '../state/defaults.js';
import { formatNumber } from '../expr/format.js';
import { defaultDomain } from '../expr/model.js';
import { isPlottable } from './graph-view.js';

const ERROR_DELAY = 900; // ms after the last keystroke before showing an error in the row being edited
const TABLE_ROWS = 10;

const INPUT_ATTRS = {
  autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'next',
};

export function createExprList({ listEl, addBtn, store }) {
  const els = new Map(); // row id -> element refs
  const lastEdit = new Map(); // row id -> timestamp
  let errorTimer = 0;
  let latest = null; // { state, analysis }

  // ---- state updates -----------------------------------------------------------------
  const updateRow = (id, patch) => store.update((s) => ({
    ...s, rows: s.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }));

  function insertRow(afterId, text = '') {
    let id;
    store.update((s) => {
      id = s.nextId;
      const row = newRow(id, nextColor(s.rows), text);
      const rows = [...s.rows];
      const at = afterId == null ? rows.length : rows.findIndex((r) => r.id === afterId) + 1;
      rows.splice(at, 0, row);
      return { ...s, nextId: id + 1, rows };
    });
    focusRow(id);
    return id;
  }

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

    const domMinInput = h('input', { class: 'mini-input', type: 'text', ...INPUT_ATTRS, 'data-keypad': '', 'aria-label': 'Start of range' });
    const domMaxInput = h('input', { class: 'mini-input', type: 'text', ...INPUT_ATTRS, 'data-keypad': '', 'aria-label': 'End of range' });
    domMinInput.addEventListener('input', () => updateRow(id, { domainMin: domMinInput.value }));
    domMaxInput.addEventListener('input', () => updateRow(id, { domainMax: domMaxInput.value }));
    const domVar1 = h('span', { class: 'dom-var' });
    const domError = h('div', { class: 'expr-status is-error', hidden: true });
    const domain = h('div', { class: 'expr-domain', hidden: true },
      h('div', { class: 'domain-row' }, domMinInput, h('span', { class: 'le' }, '≤'), domVar1, h('span', { class: 'le' }, '≤'), domMaxInput),
      domError,
    );

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
      h('div', { class: 'expr-main' }, input, status, domain, table),
      h('div', { class: 'row-actions' }, tableBtn, delBtn),
    );
    return {
      li, input, swatch, num, status, domain, domMinInput, domMaxInput, domVar1, domError,
      table, tStart, tStep, tHeadA, tHeadB, tBody, tableErr, tableBtn,
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
    setText(e.status, text);
    e.status.className = `expr-status ${cls}`;
    setHidden(e.status, !text);
    e.li.classList.toggle('has-error', cls === 'is-error');

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
      const de = r.domainError;
      setHidden(e.domError, !de);
      if (de) setText(e.domError, de.message);
    }

    // Table of values.
    const tableable = r.kind === 'cartesian' || r.kind === 'cartesian-x' || (r.kind === 'function' && !!r.f);
    setHidden(e.tableBtn, !tableable);
    e.tableBtn.setAttribute('aria-pressed', String(!!row.showTable));
    const showTable = tableable && row.showTable;
    setHidden(e.table, !showTable);
    if (showTable) renderTable(e, row, r, analysis);
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

  return { render, insertRow, focusRow };
}
