// Data tab: data sets (chips), importing CSV files or pasted cells with a preview, and
// the editable table of points. Fits are added to this panel by fit-panel.js.
import { h, setText, setHidden } from './dom.js';
import { ICONS } from './icons.js';
import {
  parseCsv, decodeBytes, columnStats, defaultColumns, toPoints, DELIMITERS, MAX_POINTS,
} from '../data/csv.js';
import { parseNumber, formatCell } from '../data/number.js';
import {
  newDataSet, blankPoint, summary, dataBounds, nameFromFile, MAX_SETS,
} from '../data/table.js';
import { nextColor, usedColors } from '../state/defaults.js';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PAGE_ROWS = 100;
const ERROR_DELAY = 900;
const PREVIEW_ROWS = 6;
const CELL_ATTRS = {
  type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'data-keypad': '',
};
const DELIMITER_NAMES = Object.fromEntries(DELIMITERS);

// The decimal separator this browser's language uses, for new data typed in by hand.
export function localeDecimal() {
  try {
    return (1.5).toLocaleString().includes(',') ? 'comma' : 'point';
  } catch {
    return 'point';
  }
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

export function createDataPanel({ root, store, getAnalysis, onFrame, fitsSlot }) {
  let imp = null; // import in progress
  let choosing = false; // the "add data" chooser is open
  let confirmDelete = 0; // set id waiting for a second tap on delete
  let confirmTimer = 0;
  const shown = new Map(); // set id -> rows shown in the table
  const invalid = new Map(); // `${setId}:${row}:${col}` -> text that isn't a number
  let tableKey = '';
  let latest = null;

  const updateData = (fn) => store.update((s) => {
    const data = fn(s.data);
    return data === s.data ? s : { ...s, data };
  });
  const updateSet = (id, fn) => updateData((d) => ({ ...d, sets: d.sets.map((set) => (set.id === id ? fn(set) : set)) }));
  const activeSet = (state) => state.data.sets.find((set) => set.id === state.data.active) || null;

  // ---- set chips ------------------------------------------------------------------------
  const setBar = h('div', { class: 'set-bar', role: 'group', 'aria-label': 'Data sets' });
  const addChip = h('button', { type: 'button', class: 'chip add-chip', onClick: () => openChooser() }, '+ Add data');

  // ---- start: open a file, paste, or type ------------------------------------------------
  const fileInput = h('input', {
    type: 'file', hidden: true,
    accept: '.csv,.tsv,.txt,.dat,.tab,text/csv,text/plain,text/tab-separated-values,text/comma-separated-values,application/vnd.ms-excel',
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) openFile(file);
  });
  const startBtn = (icon, label, detail, onClick) => h('button', { type: 'button', class: 'start-btn', onClick },
    h('span', { class: 'start-icon', html: ICONS[icon] }),
    h('span', { class: 'start-text' }, h('b', {}, label), h('span', {}, detail)));
  const startCancel = h('button', { type: 'button', class: 'text-btn', onClick: () => { choosing = false; rerender(); } }, 'Cancel');
  const startError = h('p', { class: 'expr-status is-error data-error', hidden: true, 'aria-live': 'polite' });
  const startBox = h('section', { class: 'data-start' },
    h('p', { class: 'data-intro' }, 'Load data from a CSV file or paste cells from a spreadsheet, then fit a curve to the points.'),
    h('div', { class: 'start-btns' },
      startBtn('file', 'Open a file', 'CSV or text: from your phone, Drive or Downloads', () => fileInput.click()),
      startBtn('paste', 'Paste data', 'Cells copied from Sheets or Excel, or CSV text', () => startPaste()),
      startBtn('table', 'Type it in', 'Start an empty table', () => newEmptySet())),
    startError,
    startCancel,
    fileInput);

  // ---- import preview ----------------------------------------------------------------------
  const sel = (label, onChange) => {
    const s = h('select', { class: 'data-select', 'aria-label': label });
    s.addEventListener('change', () => onChange(s.value));
    return s;
  };
  const optionsOf = (s, list, value) => {
    const key = list.map(([v, t]) => `${v}=${t}`).join('|');
    if (s.dataset.key !== key) {
      s.replaceChildren(...list.map(([v, t]) => h('option', { value: String(v) }, t)));
      s.dataset.key = key;
    }
    s.value = String(value);
  };
  const pasteArea = h('textarea', {
    class: 'paste-area', rows: 5, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off',
    'aria-label': 'Data to import', placeholder: 'Paste here: cells from a spreadsheet, or lines like 1.5, 2.25',
  });
  pasteArea.addEventListener('input', () => {
    if (!imp) return;
    imp.text = pasteArea.value;
    reparse(true);
  });
  const fileLine = h('p', { class: 'import-file' });
  const delimSel = sel('Separator between values', (v) => { imp.options.delimiter = v; reparse(false); });
  const decimalSel = sel('Decimal separator', (v) => { imp.options.decimal = v; reparse(false); });
  const headerBox = h('input', { type: 'checkbox' });
  headerBox.addEventListener('change', () => { imp.options.header = headerBox.checked; reparse(false); });
  const detected = h('p', { class: 'an-note import-detected', 'aria-live': 'polite' });
  const xSel = sel('Column for x', (v) => { imp.cols.x = Number(v); renderImport(); });
  const ySel = sel('Column for y', (v) => { imp.cols.y = Number(v); renderImport(); });
  const sSel = sel('Column for σy', (v) => { imp.cols.s = Number(v); renderImport(); });
  const previewTable = h('table', { class: 'data-preview' });
  const problemsBox = h('div', { class: 'import-problems', 'aria-live': 'polite' });
  const nameInput = h('input', { class: 'data-name-input', type: 'text', 'aria-label': 'Name of the data set', maxlength: 60 });
  nameInput.addEventListener('input', () => { if (imp) imp.name = nameInput.value; });
  const importBtn = h('button', { type: 'button', class: 'primary-btn', onClick: () => finishImport() }, 'Import');
  const importCancel = h('button', { type: 'button', class: 'text-btn', onClick: () => cancelImport() }, 'Cancel');
  const importSettings = h('div', { class: 'import-grid' },
    h('label', { class: 'field-label' }, 'Values separated by', delimSel),
    h('label', { class: 'field-label' }, 'Decimal separator', decimalSel),
    h('label', { class: 'check-label' }, headerBox, 'First row is a header'));
  const importCols = h('div', { class: 'import-grid import-cols' },
    h('label', { class: 'field-label' }, 'x', xSel),
    h('label', { class: 'field-label' }, 'y', ySel),
    h('label', { class: 'field-label' }, 'σy (optional)', sSel));
  const importBody = h('div', { class: 'import-body' },
    importSettings, detected, importCols, previewTable, problemsBox,
    h('label', { class: 'field-label' }, 'Name', nameInput));
  const importBox = h('section', { class: 'import-box', 'aria-label': 'Import data' },
    h('h3', { class: 'data-h' }, 'Import data'),
    fileLine, pasteArea, importBody,
    h('div', { class: 'data-actions' }, importBtn, importCancel));

  // ---- the active data set -----------------------------------------------------------------
  const swatch = h('button', { type: 'button', class: 'swatch set-swatch', 'aria-label': 'Show or hide this data set' });
  swatch.addEventListener('click', () => {
    const set = latest && activeSet(latest);
    if (set) updateSet(set.id, (s) => ({ ...s, hidden: !s.hidden }));
  });
  const setName = h('input', { class: 'set-name', type: 'text', 'aria-label': 'Data set name', maxlength: 60, autocomplete: 'off' });
  setName.addEventListener('input', () => {
    const set = latest && activeSet(latest);
    if (set) updateSet(set.id, (s) => ({ ...s, name: setName.value }));
  });
  setName.addEventListener('blur', () => {
    const set = latest && activeSet(latest);
    if (set && !set.name.trim()) updateSet(set.id, (s) => ({ ...s, name: `Data ${s.id}` }));
  });
  const frameBtn = h('button', { type: 'button', class: 'row-btn', 'aria-label': 'Zoom to this data set', html: ICONS.fit });
  frameBtn.addEventListener('click', () => {
    const set = latest && activeSet(latest);
    const b = set && dataBounds([{ ...set, hidden: false }]);
    if (b) onFrame(b);
  });
  const deleteBtn = h('button', { type: 'button', class: 'row-btn set-delete', 'aria-label': 'Delete this data set', html: ICONS.trash });
  deleteBtn.addEventListener('click', () => {
    const set = latest && activeSet(latest);
    if (!set) return;
    if (confirmDelete !== set.id) {
      confirmDelete = set.id;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => { confirmDelete = 0; rerender(); }, 3000);
      rerender();
      return;
    }
    confirmDelete = 0;
    deleteSet(set.id);
  });
  const metaLine = h('p', { class: 'set-meta', 'aria-live': 'polite' });
  const setHead = h('div', { class: 'set-head' }, swatch, setName, frameBtn, deleteBtn);

  const typedAt = new WeakMap(); // cell input -> time of the last keystroke
  const thead = h('thead');
  const tbody = h('tbody');
  const table = h('table', { class: 'data-table' }, thead, tbody);
  table.addEventListener('input', (e) => typedAt.set(e.target, Date.now()), true);
  table.addEventListener('input', onCellInput);
  table.addEventListener('keydown', onCellKey);
  table.addEventListener('keypad-enter', (e) => moveDown(e.target));
  table.addEventListener('focusout', (e) => {
    if (e.target.matches('.cell-input')) setTimeout(() => rerender(), 0);
  });
  table.addEventListener('click', onTableClick);
  const moreBtn = h('button', { type: 'button', class: 'text-btn', onClick: () => showMore() });
  const addPointBtn = h('button', { type: 'button', class: 'text-btn', onClick: () => addPoint() }, '+ Add point');
  const sigmaBtn = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onClick: () => toggleSigma() }, 'σy error column');
  const decBtns = {};
  const decimalSeg = h('div', { class: 'segmented mini-seg', role: 'radiogroup', 'aria-label': 'Decimal separator in the table' },
    ...[['point', '1.5'], ['comma', '1,5']].map(([v, label]) => {
      decBtns[v] = h('button', {
        type: 'button', role: 'radio', 'aria-checked': 'false',
        onClick: () => {
          const set = latest && activeSet(latest);
          if (set) updateSet(set.id, (s) => ({ ...s, decimal: v }));
        },
      }, label);
      return decBtns[v];
    }));
  const tableStatus = h('p', { class: 'expr-status is-error cell-error', hidden: true, 'aria-live': 'polite' });
  const tableFoot = h('div', { class: 'table-foot' }, addPointBtn, moreBtn, h('span', { class: 'bar-spacer' }), sigmaBtn, decimalSeg);
  const tableBox = h('section', { class: 'data-table-box', 'aria-label': 'Data table' },
    h('div', { class: 'table-scroll' }, table), tableStatus, tableFoot);
  const setBox = h('section', { class: 'set-box' }, setHead, metaLine, fitsSlot || '', tableBox);

  const wrap = h('div', { class: 'data' }, setBar, startBox, importBox, setBox);
  root.replaceChildren(wrap);

  // ---- actions -------------------------------------------------------------------------------
  function rerender() {
    if (latest) render(latest);
  }

  function openChooser() {
    if (imp) return;
    choosing = true;
    startError.hidden = true;
    rerender();
  }

  function showStartError(message) {
    choosing = true;
    startError.textContent = message;
    startError.hidden = false;
    rerender();
  }

  function addSet(name, points, extra) {
    const state = store.get();
    if (state.data.sets.length >= MAX_SETS) {
      showStartError(`You can have up to ${MAX_SETS} data sets. Delete one to add another.`);
      return null;
    }
    let id = 0;
    updateData((d) => {
      id = d.nextId;
      const color = nextColor(usedColors(store.get()));
      const set = newDataSet(id, color, name, points, extra);
      return { ...d, sets: [...d.sets, set], nextId: id + 1, active: id };
    });
    return id;
  }

  function deleteSet(id) {
    shown.delete(id);
    for (const k of [...invalid.keys()]) if (k.startsWith(`${id}:`)) invalid.delete(k);
    updateData((d) => {
      const i = d.sets.findIndex((s) => s.id === id);
      const sets = d.sets.filter((s) => s.id !== id);
      const next = sets[Math.min(i, sets.length - 1)];
      return { ...d, sets, active: next ? next.id : null };
    });
  }

  function newEmptySet() {
    choosing = false;
    const points = Array.from({ length: 3 }, blankPoint);
    const id = addSet('', points, { decimal: localeDecimal() });
    if (id === null) return;
    requestAnimationFrame(() => {
      const first = tbody.querySelector('.cell-input');
      if (first) first.focus();
    });
  }

  function startPaste() {
    choosing = false;
    imp = newImport('paste', '', '');
    rerender();
    requestAnimationFrame(() => pasteArea.focus());
  }

  async function openFile(file) {
    if (file.size > MAX_FILE_BYTES) {
      showStartError(`That file is ${(file.size / 1048576).toFixed(1)} MB – the limit is ${MAX_FILE_BYTES / 1048576} MB.`);
      return;
    }
    let text;
    try {
      text = decodeBytes(new Uint8Array(await file.arrayBuffer()));
    } catch {
      showStartError(`Couldn't read ${file.name}.`);
      return;
    }
    if (/[\u0000-\u0008\u000e-\u001f]/.test(text.slice(0, 2000))) {
      showStartError(`${file.name} doesn't look like a text or CSV file. From Excel or Sheets, save or download it as CSV first.`);
      return;
    }
    choosing = false;
    imp = newImport('file', text, nameFromFile(file.name), file.name, file.size);
    reparse(true);
  }

  function newImport(source, text, name, fileName = '', size = 0) {
    return {
      source, text, name, fileName, size,
      options: { delimiter: 'auto', decimal: 'auto', header: 'auto' },
      table: null, cols: { x: -1, y: -1, s: -1 }, points: null,
    };
  }

  // Parse the text again. fresh: the text changed, so redetect everything and pick the
  // columns again; otherwise keep the column choices that still exist.
  function reparse(fresh) {
    if (!imp) return;
    if (fresh) imp.options = { delimiter: 'auto', decimal: 'auto', header: 'auto' };
    const t = parseCsv(imp.text, imp.options);
    imp.table = t;
    const n = t.columns.length;
    if (fresh || imp.cols.y >= n || imp.cols.x >= n || imp.cols.s >= n || imp.cols.y < 0) {
      imp.cols = defaultColumns(t);
      if (!imp.name && t.header && imp.cols.y >= 0 && imp.source === 'paste') imp.name = t.columns[imp.cols.y];
    }
    rerender();
  }

  function cancelImport() {
    imp = null;
    rerender();
  }

  function finishImport() {
    if (!imp || !imp.points || !imp.points.points.length) return;
    const { points } = imp.points;
    const t = imp.table;
    const colName = (k, fallback) => (k >= 0 && t.header ? t.columns[k] : fallback);
    const name = (imp.name || '').trim() || (imp.fileName ? nameFromFile(imp.fileName) : '');
    const id = addSet(name, points, {
      decimal: t.decimal,
      xName: imp.cols.x < 0 ? 'n' : colName(imp.cols.x, 'x').slice(0, 40),
      yName: colName(imp.cols.y, 'y').slice(0, 40),
      hasSigma: imp.cols.s >= 0,
    });
    if (id === null) return;
    imp = null;
    const set = store.get().data.sets.find((s) => s.id === id);
    const b = set && dataBounds([set]);
    if (b) onFrame(b);
    rerender();
  }

  // ---- table editing -------------------------------------------------------------------------
  // Read a cell: a number with either decimal separator, or an expression such as π/2.
  function readCell(text) {
    const t = text.trim();
    if (!t) return null;
    const v = parseNumber(t.replace(/,\s+/g, ','));
    if (!Number.isNaN(v)) return v;
    const r = getAnalysis().evaluate(t);
    return !r.error && Number.isFinite(r.value) ? r.value : NaN;
  }

  function cellOf(el) {
    const tr = el.closest('tr[data-row]');
    return tr ? { row: Number(tr.dataset.row), col: el.dataset.col } : null;
  }

  let errorTimer = 0;
  function onCellInput(e) {
    const el = e.target;
    if (!el.matches('.cell-input')) return;
    const set = latest && activeSet(latest);
    const at = cellOf(el);
    if (!set || !at) return;
    const key = `${set.id}:${at.row}:${at.col}`;
    let v = readCell(el.value);
    if (at.col === 's' && v !== null && !Number.isNaN(v) && !(v > 0)) v = NaN;
    el.classList.remove('is-invalid');
    clearTimeout(errorTimer);
    if (Number.isNaN(v)) {
      invalid.set(key, el.value);
      errorTimer = setTimeout(() => rerender(), ERROR_DELAY);
      v = null;
    } else {
      invalid.delete(key);
    }
    updateSet(set.id, (s) => {
      const points = s.points.slice();
      points[at.row] = { ...points[at.row], [at.col]: v };
      return { ...s, points };
    });
  }

  function onCellKey(e) {
    if (e.key === 'Enter' && e.target.matches('.cell-input')) {
      e.preventDefault();
      moveDown(e.target);
    }
  }

  // Enter: the same column in the next row (adding a row at the end).
  function moveDown(el) {
    const set = latest && activeSet(latest);
    const at = cellOf(el);
    if (!set || !at) return;
    const focusNext = () => {
      const next = tbody.querySelector(`tr[data-row="${at.row + 1}"] .cell-input[data-col="${at.col}"]`);
      if (next) next.focus();
    };
    if (at.row + 1 >= set.points.length) {
      addPoint(at.col);
      return;
    }
    if (at.row + 1 >= (shown.get(set.id) || PAGE_ROWS)) {
      shown.set(set.id, at.row + 1 + PAGE_ROWS);
      rerender();
    }
    focusNext();
  }

  function addPoint(col = 'x') {
    const set = latest && activeSet(latest);
    if (!set) return;
    if (set.points.length >= MAX_POINTS) return;
    const row = set.points.length;
    if (row >= (shown.get(set.id) || PAGE_ROWS)) shown.set(set.id, row + 1);
    updateSet(set.id, (s) => ({ ...s, points: [...s.points, blankPoint()] }));
    requestAnimationFrame(() => {
      const el = tbody.querySelector(`tr[data-row="${row}"] .cell-input[data-col="${col}"]`);
      if (el) el.focus();
    });
  }

  function onTableClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const set = latest && activeSet(latest);
    const at = cellOf(btn);
    if (!set || !at) return;
    if (btn.dataset.act === 'toggle') {
      updateSet(set.id, (s) => {
        const points = s.points.slice();
        points[at.row] = { ...points[at.row], off: !points[at.row].off };
        return { ...s, points };
      });
    } else if (btn.dataset.act === 'delete') {
      // Invalid-cell notes below this row move up by one.
      const moved = new Map();
      for (const [k, v] of invalid) {
        const [sid, r, c] = k.split(':');
        if (Number(sid) !== set.id) moved.set(k, v);
        else if (Number(r) < at.row) moved.set(k, v);
        else if (Number(r) > at.row) moved.set(`${sid}:${Number(r) - 1}:${c}`, v);
      }
      invalid.clear();
      for (const [k, v] of moved) invalid.set(k, v);
      updateSet(set.id, (s) => ({ ...s, points: s.points.filter((_, i) => i !== at.row) }));
    }
  }

  function showMore() {
    const set = latest && activeSet(latest);
    if (!set) return;
    shown.set(set.id, (shown.get(set.id) || PAGE_ROWS) + 5 * PAGE_ROWS);
    rerender();
  }

  function toggleSigma() {
    const set = latest && activeSet(latest);
    if (set) updateSet(set.id, (s) => ({ ...s, hasSigma: !s.hasSigma }));
  }

  // ---- rendering ---------------------------------------------------------------------------
  function renderChips(state) {
    const sets = state.data.sets;
    const key = sets.map((s) => `${s.id}|${s.color}|${s.hidden}`).join(',');
    if (setBar.dataset.key !== key) {
      setBar.dataset.key = key;
      setBar.replaceChildren(...sets.map((set) => {
        const b = h('button', {
          type: 'button', class: `chip set-chip${set.hidden ? ' is-hidden' : ''}`, 'aria-pressed': 'false',
          dataset: { id: String(set.id) }, onClick: () => {
            imp = null;
            choosing = false;
            updateData((d) => ({ ...d, active: set.id }));
          },
        }, h('span', { class: 'chip-dot', style: `--dot: ${set.color}` }), h('span', { class: 'chip-name' }));
        return b;
      }), addChip);
    }
    for (const b of setBar.querySelectorAll('.set-chip')) {
      const set = sets.find((s) => String(s.id) === b.dataset.id);
      if (!set) continue;
      setText(b.querySelector('.chip-name'), set.name || `Data ${set.id}`);
      b.setAttribute('aria-pressed', String(set.id === state.data.active && !imp && !choosing));
    }
    addChip.setAttribute('aria-pressed', String(!!imp || choosing));
    setHidden(addChip, sets.length === 0 && !imp);
    setHidden(setBar, sets.length === 0);
  }

  function renderImport() {
    if (!imp) return;
    const t = imp.table;
    const isPaste = imp.source === 'paste';
    setHidden(pasteArea, !isPaste);
    if (isPaste && pasteArea.value !== imp.text) pasteArea.value = imp.text;
    setHidden(fileLine, isPaste);
    if (!isPaste) setText(fileLine, `${imp.fileName} · ${imp.size < 1024 ? `${imp.size} bytes` : `${(imp.size / 1024).toFixed(imp.size < 10240 ? 1 : 0)} KB`}`);
    if (document.activeElement !== nameInput) nameInput.value = imp.name;

    const hasText = imp.text.trim().length > 0;
    setHidden(importBody, !hasText);
    if (!hasText || !t) {
      importBtn.disabled = true;
      setText(importBtn, 'Import');
      return;
    }
    optionsOf(delimSel, [['auto', 'Automatic'], ...DELIMITERS], imp.options.delimiter);
    optionsOf(decimalSel, [['auto', 'Automatic'], ['point', 'Point: 1.5'], ['comma', 'Comma: 1,5']], imp.options.decimal);
    headerBox.checked = t.header;

    const stats = columnStats(t);
    const colLabel = (c) => `${c.name}${c.numbers ? '' : ' (no numbers)'}`;
    const cols = stats.map((c) => [c.index, colLabel(c)]);
    optionsOf(xSel, [[-1, 'Row number (1, 2, 3 …)'], ...cols], imp.cols.x);
    optionsOf(ySel, cols, imp.cols.y);
    optionsOf(sSel, [[-1, 'None'], ...cols], imp.cols.s);

    imp.points = imp.cols.y >= 0 ? toPoints(t, imp.cols) : { points: [], problems: [], truncated: false };
    const { points, problems, truncated } = imp.points;

    const parts = [
      `${DELIMITER_NAMES[t.delimiter]}-separated`,
      t.decimal === 'comma' ? 'decimal commas' : 'decimal points',
      t.header ? 'header row' : 'no header',
      plural(t.rows.length, 'row'),
    ];
    const skipped = [];
    if (t.skipped.comments) skipped.push(plural(t.skipped.comments, 'comment line'));
    if (t.skipped.preamble) skipped.push(plural(t.skipped.preamble, 'line') + ' before the table');
    setText(detected, `${parts.join(' · ')}${skipped.length ? `. Skipped ${skipped.join(' and ')}.` : ''}`);

    renderPreview(t, points);

    problemsBox.replaceChildren();
    const msgs = [];
    if (truncated) msgs.push(`Only the first ${MAX_POINTS.toLocaleString('en-GB')} points will be imported.`);
    if (t.columns.length < 2 && imp.cols.x < 0) msgs.push('Only one column found, so x will be the row number. If the values are split wrongly, change the separator above.');
    if (problems.length) {
      const list = problems.slice(0, 5).map((p) => `Line ${p.line}, ${p.column}: '${p.text}'${p.reason ? ` – ${p.reason}` : ''}`);
      if (problems.length > 5) list.push(`and ${problems.length - 5} more`);
      msgs.push(`${plural(problems.length, 'cell')} ${problems.length === 1 ? "isn't a number" : "aren't numbers"} and will be left blank, so you can fix ${problems.length === 1 ? 'it' : 'them'} in the table:`);
      problemsBox.append(...msgs.map((m) => h('p', { class: 'import-problem' }, m)), h('ul', { class: 'problem-list' }, ...list.map((l) => h('li', {}, l))));
    } else {
      problemsBox.append(...msgs.map((m) => h('p', { class: 'import-problem' }, m)));
    }
    importBtn.disabled = points.length === 0;
    setText(importBtn, points.length ? `Import ${plural(points.length, 'point')}` : 'Nothing to import');
  }

  function renderPreview(t, points) {
    const { x, y, s } = imp.cols;
    const head = ['', x < 0 ? 'n' : t.columns[x], y >= 0 ? t.columns[y] : 'y'];
    if (s >= 0) head.push(t.columns[s]);
    // The rows behind the first few points, with the original text of bad cells.
    const rows = [];
    let k = 0;
    for (const r of t.rows) {
      if (rows.length >= PREVIEW_ROWS || k >= points.length) break;
      const vals = [x, y, s].filter((c) => c >= 0).map((c) => r.values[c]);
      if (vals.every((v) => v === null || v === undefined)) continue;
      const p = points[k++];
      const cell = (c, v) => {
        if (c < 0) return h('td', {}, String(v));
        const raw = r.values[c];
        if (Number.isNaN(raw)) return h('td', { class: 'is-bad' }, r.cells[c]);
        return h('td', {}, v === null ? '' : formatCell(v, t.decimal));
      };
      const tds = [h('td', { class: 'line-no' }, String(r.line)), cell(x, p.x), cell(y, p.y)];
      if (s >= 0) tds.push(cell(s, p.s));
      rows.push(h('tr', {}, ...tds));
    }
    const more = points.length - rows.length;
    previewTable.replaceChildren(
      h('thead', {}, h('tr', {}, ...head.map((c, i) => h('th', { class: i === 0 ? 'line-no' : '' }, i === 0 ? 'Line' : c)))),
      h('tbody', {}, ...rows,
        more > 0 ? h('tr', {}, h('td', { class: 'preview-more', colspan: String(head.length) }, `… and ${plural(more, 'more point')}`)) : null),
    );
  }

  function renderSet(state, set) {
    swatch.style.setProperty('--row-color', set.color);
    swatch.classList.toggle('is-off', set.hidden);
    swatch.setAttribute('aria-pressed', String(!set.hidden));
    if (document.activeElement !== setName) setName.value = set.name;
    const confirming = confirmDelete === set.id;
    deleteBtn.classList.toggle('is-confirming', confirming);
    deleteBtn.setAttribute('aria-label', confirming ? 'Tap again to delete this data set' : 'Delete this data set');
    deleteBtn.replaceChildren();
    if (confirming) deleteBtn.append('Delete?');
    else deleteBtn.innerHTML = ICONS.trash;

    const sm = summary(set);
    const bits = [plural(sm.used, 'point') + (sm.off || sm.incomplete ? ' used' : '')];
    if (sm.off) bits.push(`${sm.off} left out`);
    if (sm.incomplete) bits.push(`${sm.incomplete} incomplete`);
    if (set.hidden) bits.push('hidden');
    setText(metaLine, bits.join(' · '));

    sigmaBtn.setAttribute('aria-pressed', String(set.hasSigma));
    for (const [v, b] of Object.entries(decBtns)) b.setAttribute('aria-checked', String(set.decimal === v));
    renderTable(set);
  }

  function renderTable(set) {
    const limit = Math.min(set.points.length, shown.get(set.id) || PAGE_ROWS);
    const key = `${set.id}|${set.points.length}|${limit}|${set.hasSigma}`;
    const focused = table.contains(document.activeElement) ? document.activeElement : null;
    if (key !== tableKey) {
      tableKey = key;
      const cols = [['x', set.xName], ['y', set.yName]];
      if (set.hasSigma) cols.push(['s', 'σ']);
      thead.replaceChildren(h('tr', {},
        h('th', { class: 'col-use' }, h('span', { class: 'sr-only' }, 'Use')),
        ...cols.map(([c]) => h('th', { dataset: { col: c } })),
        h('th', { class: 'col-del' }, h('span', { class: 'sr-only' }, 'Delete'))));
      const rows = [];
      for (let i = 0; i < limit; i++) {
        rows.push(h('tr', { dataset: { row: String(i) } },
          h('td', { class: 'col-use' }, h('button', { type: 'button', class: 'use-btn', dataset: { act: 'toggle' }, 'aria-label': `Use point ${i + 1} in fits` })),
          ...cols.map(([c]) => h('td', {}, h('input', { class: 'cell-input', ...CELL_ATTRS, dataset: { col: c }, 'aria-label': `${c === 's' ? 'σy' : c} of point ${i + 1}` }))),
          h('td', { class: 'col-del' }, h('button', { type: 'button', class: 'row-btn', dataset: { act: 'delete' }, 'aria-label': `Delete point ${i + 1}` }, '×'))));
      }
      tbody.replaceChildren(...rows);
      if (focused && focused.matches('.cell-input')) {
        // Keep focus on the same cell after the rows were rebuilt.
        const at = focused.dataset.col;
        const row = focused.closest('tr') && focused.closest('tr').dataset.row;
        const again = row && tbody.querySelector(`tr[data-row="${row}"] .cell-input[data-col="${at}"]`);
        if (again && again !== focused) {
          again.value = focused.value;
          again.focus();
        }
      }
    }
    for (const th of thead.querySelectorAll('th[data-col]')) {
      const c = th.dataset.col;
      setText(th, c === 'x' ? set.xName : c === 'y' ? set.yName : `± σ`);
      th.title = c === 's' ? `Uncertainty (standard error) of ${set.yName}` : '';
    }

    // The cell being typed in doesn't show an error until there's a pause (D12).
    const now = document.activeElement;
    let typingKey = '';
    if (now && now.matches && now.matches('.cell-input') && Date.now() - (typedAt.get(now) || 0) < ERROR_DELAY) {
      const at = cellOf(now);
      if (at) typingKey = `${set.id}:${at.row}:${at.col}`;
    }
    let bad = 0;
    let firstBad = null;
    for (const [k, text] of invalid) {
      const [sid, r, c] = k.split(':');
      if (Number(sid) !== set.id) continue;
      if (Number(r) >= set.points.length) {
        invalid.delete(k);
        continue;
      }
      if (k === typingKey) continue;
      bad++;
      if (!firstBad) firstBad = { row: Number(r), col: c, text };
    }
    for (const tr of tbody.children) {
      const i = Number(tr.dataset.row);
      const p = set.points[i];
      if (!p) continue;
      tr.classList.toggle('is-off', p.off);
      tr.querySelector('.use-btn').setAttribute('aria-pressed', String(!p.off));
      for (const input of tr.querySelectorAll('.cell-input')) {
        const c = input.dataset.col;
        const k = `${set.id}:${i}:${c}`;
        const pending = invalid.get(k);
        input.classList.toggle('is-invalid', pending !== undefined && k !== typingKey);
        if (input === now) continue; // never rewrite what is being typed
        const text = pending !== undefined ? pending : formatCell(p[c], set.decimal);
        if (input.value !== text) input.value = text;
      }
    }
    if (firstBad) {
      const name = firstBad.col === 'x' ? set.xName : firstBad.col === 'y' ? set.yName : `σ${set.yName}`;
      const what = firstBad.col === 's' && !Number.isNaN(parseNumber(firstBad.text)) ? 'must be greater than 0' : "isn't a number";
      setText(tableStatus, `Point ${firstBad.row + 1}, ${name}: '${firstBad.text}' ${what}${bad > 1 ? ` (and ${bad - 1} more cell${bad > 2 ? 's' : ''})` : ''}. It is left out until fixed.`);
    }
    setHidden(tableStatus, !firstBad);
    const more = set.points.length - limit;
    setHidden(moreBtn, more <= 0);
    if (more > 0) setText(moreBtn, `Show ${plural(Math.min(more, 5 * PAGE_ROWS), 'more row')} (${more.toLocaleString('en-GB')} hidden)`);
    addPointBtn.disabled = set.points.length >= MAX_POINTS;
  }

  function render(state) {
    latest = state;
    const sets = state.data.sets;
    const set = activeSet(state);
    const mode = imp ? 'import' : choosing || !set ? 'start' : 'set';
    renderChips(state);
    setHidden(startBox, mode !== 'start');
    setHidden(startCancel, sets.length === 0);
    setHidden(importBox, mode !== 'import');
    setHidden(setBox, mode !== 'set');
    if (mode === 'import') renderImport();
    if (mode === 'set') renderSet(state, set);
    if (mode !== 'start') startError.hidden = true;
  }

  // Text pasted onto the Data tab (outside any input): straight into the import preview.
  function pasteText(text) {
    choosing = false;
    imp = newImport('paste', text, '');
    reparse(true);
  }

  return {
    render,
    openFile: (file) => openFile(file),
    startPaste,
    pasteText,
  };
}
