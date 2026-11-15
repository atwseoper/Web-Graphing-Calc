// Calc tab: a calculator with history and Ans. It can use variables and functions
// defined in the Graph tab.
import { h, setHidden } from './dom.js';
import { formatNumber } from '../expr/format.js';

const MAX_HISTORY = 100;

export function createCalcPanel({ historyEl, input, equalsBtn, clearBtn, emptyEl, store, getAnalysis }) {
  let renderedLength = -1;
  let renderedFirst = null;

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
    const r = getAnalysis().evaluate(text, { Ans: lastAns(history) });
    const entry = r.error
      ? { input: text, output: r.error.message, value: null, error: true }
      : { input: text, output: formatNumber(r.value), value: r.value, error: false };
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
    if (e.target.closest('.calc-result') && !entry.error) {
      const s = input.selectionStart ?? input.value.length;
      const en = input.selectionEnd ?? s;
      input.setRangeText(String(entry.value), s, en, 'end');
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
    historyEl.replaceChildren(...history.map((entry, i) => h('li', { class: `calc-item${entry.error ? ' is-error' : ''}`, dataset: { index: String(i) } },
      h('button', { type: 'button', class: 'calc-expr', 'aria-label': `Reuse ${entry.input}` }, entry.input),
      h('button', { type: 'button', class: 'calc-result', 'aria-label': entry.error ? entry.output : `Insert ${entry.output}` },
        entry.error ? entry.output : `= ${entry.output}`),
    )));
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  return { render };
}
