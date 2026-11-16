// Solve tab: one equation (any unknown), polynomials (all roots, including complex),
// and linear systems. Results update as you type; "Show on graph" sends the equations
// to the Graph tab.
import { h, setText, setHidden } from './dom.js';
import { formatNumber } from '../expr/format.js';
import { solveEquation, solvePolynomial, solveSystem, polynomialText } from '../expr/solve.js';

const ERROR_DELAY = 900;
const MODES = [['equation', 'Equation'], ['polynomial', 'Polynomial'], ['system', 'System']];
const MINUS = '−';
const INPUT_ATTRS = {
  type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'data-keypad': '',
};
const fmt = (v, sig = 12) => formatNumber(v, sig);
const small = (v) => formatNumber(v, 2);

function complexText(re, im) {
  if (im === 0) return fmt(re);
  const imAbs = Math.abs(im);
  const imPart = `${imAbs === 1 ? '' : fmt(imAbs)}i`;
  if (re === 0) return `${im < 0 ? MINUS : ''}${imPart}`;
  return `${fmt(re)} ${im < 0 ? MINUS : '+'} ${imPart}`;
}

export function createSolvePanel({ root, store, getAnalysis, onShowOnGraph }) {
  const lastEdit = { t: 0 };
  let timer = 0;
  let cache = { key: null, analysis: null, result: null };
  let latestState = null;

  const update = (patch) => store.update((s) => ({ ...s, solve: { ...s.solve, ...patch } }));
  const typed = () => {
    lastEdit.t = Date.now();
    clearTimeout(timer);
    timer = setTimeout(() => latestState && render(latestState), ERROR_DELAY + 50);
  };

  // ---- mode switch -----------------------------------------------------------------------
  const modeBtns = {};
  const modes = h('div', { class: 'segmented solve-modes', role: 'radiogroup', 'aria-label': 'What to solve' },
    ...MODES.map(([value, label]) => {
      modeBtns[value] = h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', onClick: () => update({ mode: value }) }, label);
      return modeBtns[value];
    }));

  // ---- equation -------------------------------------------------------------------------------
  const eqInput = h('input', { class: 'solve-input', ...INPUT_ATTRS, 'aria-label': 'Equation', placeholder: 'e.g. x^3 − 2x = 5', enterkeyhint: 'done' });
  eqInput.addEventListener('input', () => { typed(); update({ equation: eqInput.value }); });
  const forBox = h('div', { class: 'solve-for', hidden: true });
  forBox.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-name]');
    if (b) update({ solveFor: b.dataset.name });
  });
  const givenBox = h('div', { class: 'given', hidden: true });
  const givenInputs = new Map();
  const fromInput = h('input', { class: 'mini-input', ...INPUT_ATTRS, 'aria-label': 'Search from', placeholder: 'auto' });
  const toInput = h('input', { class: 'mini-input', ...INPUT_ATTRS, 'aria-label': 'Search to', placeholder: 'auto' });
  fromInput.addEventListener('input', () => { typed(); update({ from: fromInput.value }); });
  toInput.addEventListener('input', () => { typed(); update({ to: toInput.value }); });
  const rangeVar = h('span', { class: 'an-label' }, 'x');
  const rangeRow = h('div', { class: 'an-row solve-range' }, h('span', { class: 'an-label' }, 'Search'), rangeVar, h('span', { class: 'an-label' }, 'from'), fromInput, h('span', { class: 'an-label' }, 'to'), toInput);
  const eqSection = h('section', { class: 'solve-section' },
    h('label', { class: 'field-label' }, 'Equation', eqInput),
    forBox, givenBox, rangeRow);

  // ---- polynomial -----------------------------------------------------------------------------
  const polyInput = h('input', { class: 'solve-input', ...INPUT_ATTRS, 'aria-label': 'Polynomial', placeholder: 'e.g. x^3 − 6x^2 + 11x − 6', enterkeyhint: 'done' });
  polyInput.addEventListener('input', () => { typed(); update({ polynomial: polyInput.value }); });
  const polySection = h('section', { class: 'solve-section' }, h('label', { class: 'field-label' }, 'Polynomial (= 0), or an equation', polyInput));

  // ---- system ---------------------------------------------------------------------------------
  const sysList = h('ol', { class: 'sys-list' });
  const sysInputs = [];
  const addEqBtn = h('button', {
    type: 'button', class: 'text-btn',
    onClick: () => {
      const sys = store.get().solve.system;
      if (sys.length >= 12) return;
      update({ system: [...sys, ''] });
      requestAnimationFrame(() => sysInputs[sys.length] && sysInputs[sys.length].focus());
    },
  }, '+ Add equation');
  const sysSection = h('section', { class: 'solve-section' },
    h('span', { class: 'field-label' }, 'Linear equations, one per line'), sysList, addEqBtn);

  function sysInput(i) {
    const input = h('input', { class: 'solve-input', ...INPUT_ATTRS, 'aria-label': `Equation ${i + 1}`, enterkeyhint: 'next' });
    input.addEventListener('input', () => {
      typed();
      const sys = [...store.get().solve.system];
      sys[i] = input.value;
      update({ system: sys });
    });
    const next = () => {
      const sys = store.get().solve.system;
      if (i + 1 < sys.length) sysInputs[i + 1].focus();
      else addEqBtn.click();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        next();
      }
    });
    input.addEventListener('keypad-enter', next);
    const del = h('button', {
      type: 'button', class: 'row-btn', 'aria-label': `Remove equation ${i + 1}`,
      onClick: () => {
        const sys = store.get().solve.system.filter((_, k) => k !== i);
        update({ system: sys.length ? sys : [''] });
      },
    }, '×');
    const err = h('div', { class: 'expr-status is-error', hidden: true });
    const li = h('li', { class: 'sys-item' }, h('div', { class: 'sys-line' }, input, del), err);
    return { li, input, del, err };
  }
  const sysEls = [];

  // ---- results ---------------------------------------------------------------------------------
  const errorEl = h('div', { class: 'expr-status is-error solve-error', hidden: true, 'aria-live': 'polite' });
  const results = h('div', { class: 'solve-results', 'aria-live': 'polite' });
  const note = h('p', { class: 'an-note solve-note' });
  const showBtn = h('button', { type: 'button', class: 'primary-btn', onClick: () => cache.result && onShowOnGraph(cache.result) }, 'Show on graph');
  const help = h('p', { class: 'placeholder solve-help' });
  const desc = h('p', { class: 'solve-desc' });

  for (const el of [eqInput, polyInput]) {
    el.addEventListener('keypad-enter', () => el.blur());
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
  }

  root.append(h('div', { class: 'solve' }, modes, desc, eqSection, polySection, sysSection, errorEl, results, note, showBtn, help));

  const syncInput = (input, value) => { if (input.value !== value) input.value = value; };

  // ---- rendering -------------------------------------------------------------------------------
  function compute(solve, analysis) {
    const key = JSON.stringify(solve);
    if (cache.key === key && cache.analysis === analysis) return cache.result;
    let result;
    if (solve.mode === 'equation') {
      result = solveEquation(analysis, solve.equation, { solveFor: solve.solveFor, given: solve.given, from: solve.from, to: solve.to });
    } else if (solve.mode === 'polynomial') {
      result = solvePolynomial(analysis, solve.polynomial);
    } else {
      result = solveSystem(analysis, solve.system);
    }
    cache = { key, analysis, result };
    return result;
  }

  function render(state) {
    latestState = state;
    if (state.ui.tab !== 'solve') return; // nothing to do until the tab is open
    const solve = state.solve;
    for (const [v, b] of Object.entries(modeBtns)) b.setAttribute('aria-checked', String(v === solve.mode));
    setHidden(eqSection, solve.mode !== 'equation');
    setHidden(polySection, solve.mode !== 'polynomial');
    setHidden(sysSection, solve.mode !== 'system');
    syncInput(eqInput, solve.equation);
    syncInput(polyInput, solve.polynomial);
    syncInput(fromInput, solve.from);
    syncInput(toInput, solve.to);
    renderSystemInputs(solve.system);

    const result = compute(solve, getAnalysis());
    const editing = Date.now() - lastEdit.t < ERROR_DELAY;
    results.replaceChildren();
    setText(note, '');
    setHidden(errorEl, true);
    for (const s of sysEls) setHidden(s.err, true);

    if (solve.mode === 'equation') renderEquation(result, solve, editing);
    else if (solve.mode === 'polynomial') renderPolynomial(result, editing);
    else renderSystem(result, editing);

    setHidden(showBtn, !(result && result.graph && result.graph.length && !result.error));
    setText(desc, DESCRIPTIONS[solve.mode]);
    setHidden(help, !(result && result.empty));
    setText(help, EXAMPLES[solve.mode]);
  }

  function showError(result, editing) {
    if (!result.error || editing) return;
    setText(errorEl, result.error.message);
    setHidden(errorEl, false);
  }

  function renderEquation(r, solve, editing) {
    setHidden(forBox, true);
    setHidden(givenBox, true);
    setText(rangeVar, (r && r.solveFor) || 'x');
    if (!r || r.empty) return;
    showError(r, editing);
    if (!r.unknowns) return;

    // Choose the unknown when there is more than one.
    if (r.unknowns.length > 1) {
      setHidden(forBox, false);
      forBox.replaceChildren(h('span', { class: 'an-label' }, 'Solve for'),
        ...r.unknowns.map((n) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(n === r.solveFor), dataset: { name: n } }, n)));
      // Values for the others.
      const others = r.unknowns.filter((n) => n !== r.solveFor);
      setHidden(givenBox, false);
      const rows = others.map((n) => {
        let input = givenInputs.get(n);
        if (!input) {
          input = h('input', { class: 'mini-input given-input', ...INPUT_ATTRS, 'aria-label': `Value of ${n}` });
          input.addEventListener('input', () => {
            typed();
            update({ given: { ...store.get().solve.given, [n]: input.value } });
          });
          givenInputs.set(n, input);
        }
        syncInput(input, solve.given[n] || '');
        const err = r.givenErrors && r.givenErrors[n] && !editing ? h('span', { class: 'given-error' }, r.givenErrors[n]) : null;
        return h('label', { class: 'given-row' }, h('span', { class: 'given-name' }, `${n} =`), input, err);
      });
      givenBox.replaceChildren(...rows);
    }
    if (r.needs && r.needs.length) {
      setText(note, `Give ${r.needs.length === 1 ? 'a value' : 'values'} for ${r.needs.join(', ')} to solve for ${r.solveFor}.`);
      return;
    }
    if (!r.roots) return;

    const v = r.solveFor;
    if (r.roots.length) {
      results.append(...r.roots.map((root) => h('div', { class: 'result-card' },
        h('div', { class: 'result-main' }, `${v} = ${fmt(root.x)}`),
        h('div', { class: 'result-detail' },
          `residual ${small(root.residual)} · ${root.iterations} iteration${root.iterations === 1 ? '' : 's'}${root.tangential ? ' · the graph touches zero here' : ''}`))));
    }
    const [a, b] = r.range;
    const range = `${fmt(a, 6)} ≤ ${v} ≤ ${fmt(b, 6)}`;
    let text;
    if (r.roots.length) {
      text = `${r.roots.length} solution${r.roots.length === 1 ? '' : 's'} for ${range}.`;
      if (r.auto && a !== -10) text += ` None between −10 and 10, so the search was widened.`;
    } else {
      text = `No solutions found for ${range}. There may be none, or they may lie outside this range.`;
    }
    text += ' The search checks 2,000 points across the range, so solutions very close together can be missed.';
    if (r.renamed) text += ` On the graph, ${r.renamed} is shown as x.`;
    setText(note, text);
  }

  function renderPolynomial(r, editing) {
    if (!r || r.empty) return;
    showError(r, editing);
    if (r.error) return;
    const v = r.variable;
    results.append(h('div', { class: 'result-detail poly-form' }, `Degree ${r.degree}: ${polynomialText(r.coefficients, v, (x) => fmt(x, 10))} = 0`));
    results.append(...r.roots.map((z) => h('div', { class: 'result-card' },
      h('div', { class: 'result-main' }, `${v} = ${complexText(z.re, z.im)}${z.multiplicity > 1 ? `  (×${z.multiplicity})` : ''}`),
      h('div', { class: 'result-detail' }, `residual ${small(z.residual)}`))));
    const realCount = r.roots.filter((z) => z.im === 0).reduce((s, z) => s + z.multiplicity, 0);
    let text = `${r.degree} root${r.degree === 1 ? '' : 's'} counting repeats: ${realCount} real, ${r.degree - realCount} complex.`;
    if (r.roots.some((z) => z.multiplicity > 1)) text += ' A repeated root is listed once, with (×n) showing how many times it repeats.';
    if (!r.converged) text += ' Warning: the iteration did not fully converge.';
    if (r.renamed) text += ` On the graph, ${r.renamed} is shown as x.`;
    setText(note, text);
  }

  function renderSystem(r, editing) {
    if (!r || r.empty) return;
    if (r.error) {
      if (editing) return;
      if (r.index !== undefined && sysEls[r.index]) {
        setText(sysEls[r.index].err, r.error.message);
        setHidden(sysEls[r.index].err, false);
      } else {
        showError(r, editing);
      }
      return;
    }
    if (r.status === 'unique') {
      results.append(...r.unknowns.map((n, i) => h('div', { class: 'result-card' }, h('div', { class: 'result-main' }, `${n} = ${fmt(r.values[i])}`))));
      let text = `${r.equations} equation${r.equations === 1 ? '' : 's'}, ${r.unknowns.length} unknown${r.unknowns.length === 1 ? '' : 's'}. Largest residual ${small(r.residual)}.`;
      if (r.nearlySingular) text += ' Warning: the equations are nearly dependent, so small changes in them change the answer a lot.';
      setText(note, text + renamedNote(r));
    } else if (r.status === 'none') {
      results.append(h('div', { class: 'result-card' }, h('div', { class: 'result-main' }, 'No solution')));
      setText(note, `The equations contradict each other (for example, parallel lines).${renamedNote(r)}`);
    } else {
      results.append(h('div', { class: 'result-card' }, h('div', { class: 'result-main' }, 'Infinitely many solutions')));
      const lines = r.relations.map((rel) => {
        let t = fmt(rel.constant);
        for (const term of rel.terms) {
          const c = term.coef;
          const mag = Math.abs(c) === 1 ? '' : fmt(Math.abs(c));
          t = t === '0' ? `${c < 0 ? MINUS : ''}${mag}${term.unknown}` : `${t} ${c < 0 ? MINUS : '+'} ${mag}${term.unknown}`;
        }
        return `${rel.unknown} = ${t}`;
      });
      results.append(...lines.map((l) => h('div', { class: 'result-detail' }, l)));
      setText(note, `${r.free.join(', ')} can be any value${r.free.length > 1 ? 's' : ''}.${renamedNote(r)}`);
    }
  }

  function renamedNote(r) {
    if (!r.renamed) return '';
    const [[a], [b]] = Object.entries(r.renamed);
    return ` On the graph, ${a} is shown as x and ${b} as y.`;
  }

  function renderSystemInputs(system) {
    while (sysEls.length < system.length) {
      const el = sysInput(sysEls.length);
      sysEls.push(el);
      sysInputs.push(el.input);
    }
    while (sysEls.length > system.length) {
      sysEls.pop().li.remove();
      sysInputs.pop();
    }
    system.forEach((t, i) => {
      const el = sysEls[i];
      if (el.li.parentNode !== sysList) sysList.append(el.li);
      syncInput(el.input, t);
      el.input.placeholder = i === 0 ? 'e.g. 2x + 3y = 5' : i === 1 ? 'e.g. x − y = 1' : '';
      el.del.hidden = system.length <= 1;
    });
  }

  return { render };
}

// A line under the mode buttons saying what each mode is for (more in the help).
const DESCRIPTIONS = {
  equation: 'Any equation in one unknown, solved numerically by searching a range. Finds real solutions; works with sin, eˣ, ln, √ and anything else.',
  polynomial: 'Polynomials only, but finds every root with nothing missed, including complex and repeated roots. No search range needed.',
  system: 'Several linear equations solved together. Says when there is no solution or infinitely many.',
};

const EXAMPLES = {
  equation: 'Try cos x = x, e^x = 5000, or a formula such as v = u + a t (choose the letter to solve for and give the others values). Variables and functions from the Graph tab can be used.',
  polynomial: 'Try x^3 - 6x^2 + 11x - 6, (x - 1)^2 (x + 3) or 2x^3 = x + 1.',
  system: 'Try 2x + 3y = 5 and x - y = 1. Use any letters, with up to 12 unknowns.',
};
