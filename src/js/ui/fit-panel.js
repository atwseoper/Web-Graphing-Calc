// Fits of the active data set, shown as cards in the Data tab: model picker, the fitted
// equation, parameters with standard errors and 95% intervals, goodness of fit, and
// "Add to graph".
import { h, setText, setHidden } from './dom.js';
import { ICONS } from './icons.js';
import { formatNumber } from '../expr/format.js';
import { PRESETS, paramLabel, modelSource, equationText } from '../fit/models.js';
import { newFit, nextColor, usedColors } from '../state/defaults.js';

// Models offered in the picker, in order.
export const MODEL_CHOICES = ['line', 'poly', 'log', 'custom'];
const MAX_FITS = 8;
const INPUT_ATTRS = {
  type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'data-keypad': '',
};
const ERROR_DELAY = 900;
const MINUS = '−';

// Significant figures a value deserves given its standard error (two figures of the
// error): 1.00212 ± 0.00043. Without an error estimate, 6 figures.
export function estimateDigits(v, se) {
  if (!(se > 0) || !Number.isFinite(se) || !Number.isFinite(v)) return 6;
  const mag = v === 0 ? Math.floor(Math.log10(se)) : Math.floor(Math.log10(Math.abs(v)));
  return Math.min(15, Math.max(2, mag - Math.floor(Math.log10(se)) + 2));
}
export function formatEstimate(v, se) {
  if (!Number.isFinite(v)) return formatNumber(v);
  return formatNumber(v, estimateDigits(v, se));
}
const fmtSe = (se) => (Number.isFinite(se) ? formatNumber(se, 2) : '–');
const fmtStat = (v, sig = 5) => (Number.isFinite(v) ? formatNumber(v, sig) : '–');

export function createFitPanel({ store, getAnalysis, fitCache, onSendToGraph }) {
  const cards = new Map(); // fit id -> card elements
  const typedAt = new Map(); // fit id -> last keystroke in the custom model input
  let listKey = '';
  let current = null; // { state, set }

  const updateSet = (id, fn) => store.update((s) => ({
    ...s, data: { ...s.data, sets: s.data.sets.map((set) => (set.id === id ? fn(set) : set)) },
  }));
  const updateFit = (fitId, patch) => {
    const set = current && current.set;
    if (!set) return;
    updateSet(set.id, (s) => ({ ...s, fits: s.fits.map((f) => (f.id === fitId ? { ...f, ...patch } : f)) }));
  };

  const list = h('ol', { class: 'fit-list' });
  const addBtn = h('button', { type: 'button', class: 'text-btn', onClick: () => addFit() }, '+ Add a fit');
  const el = h('section', { class: 'fits', 'aria-label': 'Fits' },
    h('div', { class: 'fits-head' }, h('h3', { class: 'data-h' }, 'Fits'), addBtn), list);

  function addFit() {
    const state = store.get();
    const set = current && current.set;
    if (!set || set.fits.length >= MAX_FITS) return;
    const has = (m) => set.fits.some((f) => f.model === m);
    const model = !has('line') ? 'line' : !has('poly') ? 'poly' : 'custom';
    const color = nextColor(usedColors(state));
    store.update((s) => {
      const id = s.data.nextId;
      const sets = s.data.sets.map((x) => (x.id === set.id ? { ...x, fits: [...x.fits, newFit(id, color, model)] } : x));
      return { ...s, data: { ...s.data, sets, nextId: id + 1 } };
    });
  }

  function makeCard(fit) {
    const c = { id: fit.id };
    c.swatch = h('button', { type: 'button', class: 'swatch fit-swatch', 'aria-label': 'Show or hide this fit on the graph' });
    c.swatch.addEventListener('click', () => {
      const f = current.set.fits.find((x) => x.id === fit.id);
      if (f) updateFit(fit.id, { hidden: !f.hidden });
    });
    c.model = h('select', { class: 'data-select fit-model', 'aria-label': 'Model' },
      ...MODEL_CHOICES.map((m) => h('option', { value: m }, PRESETS[m].name)));
    c.model.addEventListener('change', () => updateFit(fit.id, { model: c.model.value }));
    c.degree = h('select', { class: 'data-select fit-degree', 'aria-label': 'Degree' },
      ...[2, 3, 4, 5, 6].map((d) => h('option', { value: String(d) }, `Degree ${d}`)));
    c.degree.addEventListener('change', () => updateFit(fit.id, { degree: Number(c.degree.value) }));
    c.del = h('button', { type: 'button', class: 'row-btn', 'aria-label': 'Delete this fit', html: ICONS.close });
    c.del.addEventListener('click', () => {
      const set = current.set;
      updateSet(set.id, (s) => ({ ...s, fits: s.fits.filter((f) => f.id !== fit.id) }));
    });
    c.custom = h('input', { class: 'solve-input fit-custom', ...INPUT_ATTRS, 'aria-label': 'Model: y =', placeholder: 'e.g. a + b sin(x) + c cos(x)', enterkeyhint: 'done' });
    c.custom.addEventListener('input', () => {
      typedAt.set(fit.id, Date.now());
      setTimeout(() => current && render(current.state, current.set), ERROR_DELAY + 50);
      updateFit(fit.id, { custom: c.custom.value });
    });
    c.customRow = h('label', { class: 'fit-custom-row' }, h('span', { class: 'fit-y' }, 'y ='), c.custom);
    c.customHelp = h('p', { class: 'an-note' }, 'Use x and any other letters as parameters to fit. Letters defined in the Graph tab are fixed numbers.');
    c.formula = h('div', { class: 'fit-formula' });
    c.error = h('div', { class: 'expr-status is-error fit-error', 'aria-live': 'polite' });
    c.params = h('table', { class: 'fit-params' });
    c.stats = h('div', { class: 'fit-stats' });
    c.notes = h('div', { class: 'fit-notes' });
    c.send = h('button', { type: 'button', class: 'chip', onClick: () => {
      const r = c.result;
      if (r && r.equation) onSendToGraph(r.equation);
    } }, 'Add to graph');
    c.detailsBtn = h('button', { type: 'button', class: 'chip', 'aria-expanded': 'false', onClick: () => {
      c.open = !c.open;
      render(current.state, current.set);
    } }, 'Details');
    c.details = h('div', { class: 'fit-details' });
    c.actions = h('div', { class: 'fit-actions' }, c.send, c.detailsBtn);
    c.body = h('div', { class: 'fit-body' }, c.formula, c.params, c.stats, c.notes, c.actions, c.details);
    c.li = h('li', { class: 'fit-card' },
      h('div', { class: 'fit-head' }, c.swatch, c.model, c.degree, h('span', { class: 'bar-spacer' }), c.del),
      c.customRow, c.customHelp, c.error, c.body);
    return c;
  }

  function renderCard(c, fit, set) {
    const analysis = getAnalysis();
    const r = fitCache.result(set, fit, analysis);
    c.result = r && !r.error && !r.empty ? r : null;
    c.li.style.setProperty('--row-color', fit.color);
    c.swatch.classList.toggle('is-off', fit.hidden);
    c.swatch.setAttribute('aria-pressed', String(!fit.hidden));
    if (c.model.value !== fit.model) c.model.value = MODEL_CHOICES.includes(fit.model) ? fit.model : 'custom';
    setHidden(c.degree, fit.model !== 'poly');
    if (c.degree.value !== String(fit.degree)) c.degree.value = String(fit.degree);
    const isCustom = fit.model === 'custom';
    setHidden(c.customRow, !isCustom);
    setHidden(c.customHelp, !isCustom || !!c.result);
    if (isCustom && document.activeElement !== c.custom && c.custom.value !== fit.custom) c.custom.value = fit.custom;

    // Errors wait for a pause in typing (D12).
    const typing = isCustom && document.activeElement === c.custom && Date.now() - (typedAt.get(fit.id) || 0) < ERROR_DELAY;
    const err = r && r.error ? r.error.message : '';
    setText(c.error, typing ? '' : err);
    setHidden(c.error, typing || !err);
    c.li.classList.toggle('has-error', !!err);

    const src = isCustom ? null : modelSource(fit, analysis);
    if (!c.result) {
      setText(c.formula, src ? src.formula : '');
      setHidden(c.formula, !src);
      for (const e of [c.params, c.stats, c.notes, c.actions, c.details]) setHidden(e, true);
      return;
    }
    setHidden(c.formula, false);
    setText(c.formula, prettyEquation(displayEquation(c.result)) || c.result.model.formula);
    c.formula.title = c.result.model.formula;
    for (const e of [c.params, c.stats, c.actions]) setHidden(e, false);
    renderParams(c, c.result);
    renderStats(c, c.result);
    c.notes.replaceChildren(...c.result.notes.map((n) => h('p', { class: 'an-note' }, n)));
    setHidden(c.notes, !c.result.notes.length);
    c.send.disabled = !c.result.equation;
    c.detailsBtn.setAttribute('aria-expanded', String(!!c.open));
    setHidden(c.details, !c.open);
    if (c.open) renderDetails(c, c.result);
  }

  function renderParams(c, r) {
    const hints = r.model.hints || {};
    const noErr = r.dof === 0;
    c.params.replaceChildren(
      h('thead', {}, h('tr', {},
        h('th', {}, ''), h('th', {}, 'Value'), h('th', {}, noErr ? '' : '± SE'), h('th', { class: 'ci' }, noErr ? '' : '95% interval'))),
      h('tbody', {}, ...r.model.params.map((p, k) => h('tr', {},
        h('td', { class: 'pname' }, h('i', {}, paramLabel(p)), hints[p] ? h('span', { class: 'phint' }, hints[p]) : null),
        h('td', { class: 'pval' }, formatEstimate(r.values[k], r.se[k])),
        h('td', { class: 'pse' }, noErr ? '' : fmtSe(r.se[k])),
        h('td', { class: 'ci' }, noErr ? '' : `${formatEstimate(r.ci[k][0], r.se[k])} … ${formatEstimate(r.ci[k][1], r.se[k])}`)))),
    );
  }

  function renderStats(c, r) {
    const items = [['n', String(r.n)]];
    if (r.weighted) {
      items.push(['χ²', fmtStat(r.chi2)], ['χ²/dof', fmtStat(r.chi2red, 4)], ['P(χ²)', fmtStat(r.pValue, 3)]);
    }
    items.push(['R²', fmtStat(r.r2, 6)]);
    if (r.dof > 0 && r.p > 1) items.push(['adj. R²', fmtStat(r.adjR2, 6)]);
    items.push(['RMSE', fmtStat(r.rmse, 4)]);
    if (r.dof > 0 && !r.weighted) items.push(['s', fmtStat(r.s, 4)]);
    c.stats.replaceChildren(...items.map(([k, v]) => h('span', { class: 'stat' }, h('span', { class: 'k' }, k), ' ', h('span', { class: 'v' }, v))));
  }

  function renderDetails(c, r) {
    const p = r.model.params;
    const lines = [
      `Model: ${r.model.formula}`,
      `Method: ${r.method}${r.iterations ? `, ${r.iterations} iterations` : ''}`,
      `${r.n} points, ${r.p} parameters, ${r.dof} degrees of freedom`,
    ];
    if (r.dof > 0) {
      lines.push(r.weighted
        ? `Weighted by 1/σy². Errors use the σy values as given; 95% intervals are ±${formatNumber(r.q, 4)} SE.`
        : `95% intervals are ±${formatNumber(r.q, 4)} SE (Student t, ${r.dof} degrees of freedom).`);
    }
    const kids = lines.map((l) => h('p', { class: 'an-note' }, l));
    if (p.length > 1 && r.dof > 0) {
      kids.push(h('p', { class: 'an-note' }, 'Correlation between parameters:'),
        h('table', { class: 'fit-corr' },
          h('thead', {}, h('tr', {}, h('th', {}, ''), ...p.map((n) => h('th', {}, h('i', {}, paramLabel(n)))))),
          h('tbody', {}, ...p.map((n, i) => h('tr', {}, h('th', {}, h('i', {}, paramLabel(n))),
            ...p.map((_, j) => h('td', { class: Math.abs(r.corr[i][j]) > 0.95 && i !== j ? 'is-high' : '' }, j > i ? '' : formatNumber(r.corr[i][j], 3))))))));
      if (p.some((_, i) => p.some((__, j) => i !== j && Math.abs(r.corr[i][j]) > 0.95))) {
        kids.push(h('p', { class: 'an-note' }, 'Correlations near ±1 mean those parameters trade off against each other, so their individual errors are large.'));
      }
    }
    c.details.replaceChildren(...kids);
  }

  function render(state, set) {
    current = { state, set };
    const key = set.fits.map((f) => f.id).join(',');
    if (key !== listKey || list.children.length !== set.fits.length) {
      listKey = key;
      for (const id of [...cards.keys()]) if (!set.fits.some((f) => f.id === id)) cards.delete(id);
      list.replaceChildren(...set.fits.map((f) => {
        if (!cards.has(f.id)) cards.set(f.id, makeCard(f));
        return cards.get(f.id).li;
      }));
    }
    for (const fit of set.fits) renderCard(cards.get(fit.id), fit, set);
    addBtn.disabled = set.fits.length >= MAX_FITS;
    setText(addBtn, set.fits.length ? '+ Add a fit' : '+ Fit a curve');
  }

  return { el, render };
}

// The fitted equation with each value rounded to the precision its error justifies.
// ("Add to graph" uses the full-precision equation.)
function displayEquation(r) {
  try {
    const rounded = r.values.map((v, k) => Number(v.toPrecision(estimateDigits(v, r.se[k]))));
    return equationText(r.model, rounded);
  } catch {
    return r.equation;
  }
}

// Equation text for display: proper minus signs and multiplication dots.
function prettyEquation(text) {
  if (!text) return '';
  return text.replace(/(\d)e([-+]?\d)/g, '$1E$2').replace(/-/g, MINUS).replace(/\*/g, '·').replace(/E(−?\d)/g, '×10^$1');
}
