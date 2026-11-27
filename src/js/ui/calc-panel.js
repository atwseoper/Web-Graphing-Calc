// Calc tab: a calculator with history and Ans. It can use variables and functions
// defined in the Graph tab.
import { h, setHidden } from './dom.js';
import { formatNumber } from '../expr/format.js';
import { listText, countText } from '../expr/lists.js';

const MAX_HISTORY = 100;

export function createCalcPanel({ historyEl, input, equalsBtn, clearBtn, emptyEl, store, getAnalysis }) {
  let renderedLength = -1;
  let renderedFirst = null;
  const openLists = new Set(); // history positions whose whole list is shown

  function lastAns(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (!history[i].error && typeof history[i].value === 'number') return history[i].value;
    }
    return 0;
  }

  function evaluateInput() {
    const text = input.value.trim();
    if (!text) return;
    const history = store.get().calc.history;
    const r = getAnalysis().evaluate(text, { Ans: lastAns(history) }, { allowList: true });
    let entry;
    if (r.error) entry = { input: text, output: r.error.message, value: null, error: true };
    else if (r.list) {
      // A list (Phase 9a): the first and last few elements, all of them on request.
      entry = { input: text, output: listText(r.list), value: null, list: r.list, count: r.list.length, error: false };
    } else entry = { input: text, output: formatNumber(r.value), value: r.value, error: false };
    if (r.warning) entry.note = r.warning;
    store.update((s) => ({ ...s, calc: { history: [...s.calc.history, entry].slice(-MAX_HISTORY) } }));
    if (!r.error) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    requestAnimationFrame(() => { historyEl.scrollTop = historyEl.scrollHeight; });
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      evaluateInput();
    } else if (e.key === 'ArrowUp' && !input.value) {
      const hist = store.get().calc.history;
      if (hist.length) {
        e.preventDefault();
        input.value = hist[hist.length - 1].input;
      }
    }
  });
  input.addEventListener('keypad-enter', evaluateInput);
  equalsBtn.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the input
  equalsBtn.addEventListener('click', evaluateInput);
  clearBtn.addEventListener('click', () => store.update((s) => ({ ...s, calc: { history: [] } })));

  // Tap an entry: the expression replaces the input; the result is inserted at the caret.
  historyEl.addEventListener('click', (e) => {
    const item = e.target.closest('[data-index]');
    if (!item) return;
    const entry = store.get().calc.history[Number(item.dataset.index)];
    if (!entry) return;
    if (e.target.closest('.calc-more')) {
      const i = Number(item.dataset.index);
      if (openLists.has(i)) openLists.delete(i);
      else openLists.add(i);
      renderedLength = -1;
      render(store.get());
      return;
    }
    if (e.target.closest('.calc-result') && !entry.error) {
      const s = input.selectionStart ?? input.value.length;
      const en = input.selectionEnd ?? s;
      // A list goes in as a list, when it is short enough to read; a long one as its expression.
      const insert = entry.list ? (entry.list.length <= 50 ? `[${entry.list.map((v) => String(v)).join(', ')}]` : `(${entry.input})`) : String(entry.value);
      input.setRangeText(insert, s, en, 'end');
    } else {
      input.value = entry.input;
    }
    input.focus();
  });

  function render(state) {
    const history = state.calc.history;
    setHidden(emptyEl, history.length > 0);
    setHidden(clearBtn, history.length === 0);
    if (history.length === renderedLength && history[0] === renderedFirst) return;
    renderedLength = history.length;
    renderedFirst = history[0];
    if (!history.length) openLists.clear();
    historyEl.replaceChildren(...history.map((entry, i) => {
      const long = !!entry.list && entry.list.length > 6;
      const open = long && openLists.has(i);
      const count = entry.count > 6 ? h('span', { class: 'calc-count' }, countText(entry.count)) : null;
      return h('li', { class: `calc-item${entry.error ? ' is-error' : ''}`, dataset: { index: String(i) } },
        h('button', { type: 'button', class: 'calc-expr', 'aria-label': `Reuse ${entry.input}` }, entry.input),
        h('button', { type: 'button', class: 'calc-result', 'aria-label': entry.error ? entry.output : `Insert ${entry.output}` },
          entry.error ? entry.output : `= ${entry.output}`),
        entry.note ? h('div', { class: 'calc-note' }, `⚠ ${entry.note}`) : null,
        count || long ? h('div', { class: 'calc-list-row' }, count,
          long ? h('button', { type: 'button', class: 'chip calc-more', 'aria-expanded': String(open) }, open ? 'Hide' : 'Show all') : null) : null,
        open ? h('div', { class: 'list-all calc-list-all', tabindex: '0' }, entry.list.map((v) => formatNumber(v, 10)).join(', ')) : null,
      );
    }));
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  return { render };
}
