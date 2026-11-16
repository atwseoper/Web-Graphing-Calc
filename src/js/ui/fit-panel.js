// Fits of the active data set, shown as cards in the Data tab: model picker, the fitted
// equation, parameters with standard errors and 95% intervals, goodness of fit, bands,
// residual plot, starting values, "Add to graph" and "Copy results".
import { h, setText, setHidden } from './dom.js';
import { ICONS } from './icons.js';
import { copyText, flashLabel } from './export.js';
import { formatNumber } from '../expr/format.js';
import { formatCell } from '../data/number.js';
import { PRESETS, paramLabel, modelSource, equationText } from '../fit/models.js';
import { newFit, nextColor, usedColors } from '../state/defaults.js';

// Models offered in the picker, in order.
export const MODEL_CHOICES = ['line', 'poly', 'exp', 'power', 'log', 'logistic', 'sin', 'gauss', 'custom'];
const BANDS = [['none', 'No bands'], ['conf', '95% confidence band'], ['both', 'Confidence + prediction']];
const COMMIT_DELAY = 450; // ms after the last keystroke before a custom model is fitted
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
    // Fitting a custom model can take a moment, so it is fitted after a pause in typing.
    const commit = () => {
      clearTimeout(c.commitTimer);
      const f = current && current.set.fits.find((x) => x.id === fit.id);
      if (f && f.custom !== c.custom.value) updateFit(fit.id, { custom: c.custom.value });
    };
    c.custom.addEventListener('input', () => {
      typedAt.set(fit.id, Date.now());
      clearTimeout(c.commitTimer);
      c.commitTimer = setTimeout(commit, COMMIT_DELAY);
      setTimeout(() => current && render(current.state, current.set), ERROR_DELAY + 50);
    });
    c.custom.addEventListener('blur', commit);
    c.custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
    c.custom.addEventListener('keypad-enter', commit);
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
    c.copy = h('button', { type: 'button', class: 'chip', onClick: async () => {
      if (!c.result) return;
      const ok = await copyText(resultsText(c.result, current.set));
      flashLabel(c.copy, ok ? 'Copied' : 'Copy failed');
    } }, 'Copy results');
    c.weight = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onClick: () => {
      const f = current.set.fits.find((x) => x.id === fit.id);
      if (f) updateFit(fit.id, { weighted: !f.weighted });
    } }, 'Weighted by σy');
    c.residBtn = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onClick: () => {
      const f = current.set.fits.find((x) => x.id === fit.id);
      if (f) updateFit(fit.id, { residuals: !f.residuals });
    } }, 'Residuals');
    c.bands = h('select', { class: 'data-select fit-bands', 'aria-label': 'Bands on the graph' },
      ...BANDS.map(([v, t]) => h('option', { value: v }, t)));
    c.bands.addEventListener('change', () => updateFit(fit.id, { bands: c.bands.value }));
    c.residCanvas = h('canvas', { class: 'resid-plot', role: 'img', 'aria-label': 'Residual plot' });
    c.residBox = h('div', { class: 'resid-box' }, c.residCanvas);
    c.startBox = h('div', { class: 'fit-starts' });
    c.startInputs = new Map();
    c.details = h('div', { class: 'fit-details' });
    c.options = h('div', { class: 'fit-actions' }, c.weight, c.residBtn, c.bands);
    c.actions = h('div', { class: 'fit-actions' }, c.send, c.copy, c.detailsBtn);
    c.body = h('div', { class: 'fit-body' }, c.formula, c.params, c.stats, c.notes, c.options, c.residBox, c.actions, c.details);
    c.li = h('li', { class: 'fit-card' },
      h('div', { class: 'fit-head' }, c.swatch, c.model, c.degree, h('span', { class: 'bar-spacer' }), c.del),
      c.customRow, c.customHelp, c.error, c.startBox, c.body);
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
    const failed = !!(r && r.error);
    renderStarts(c, fit, analysis, failed);
    if (!c.result) {
      setText(c.formula, src ? src.formula : '');
      setHidden(c.formula, !src);
      for (const e of [c.params, c.stats, c.notes, c.options, c.residBox, c.actions, c.details]) setHidden(e, true);
      return;
    }
    setHidden(c.weight, !set.hasSigma);
    c.weight.setAttribute('aria-pressed', String(!!fit.weighted && set.hasSigma));
    c.residBtn.setAttribute('aria-pressed', String(!!fit.residuals));
    if (c.bands.value !== fit.bands) c.bands.value = fit.bands;
    setHidden(c.residBox, !fit.residuals);
    if (fit.residuals) requestAnimationFrame(() => drawResiduals(c, c.result, set, fit));
    setHidden(c.formula, false);
    setText(c.formula, prettyEquation(displayEquation(c.result)) || c.result.model.formula);
    c.formula.title = c.result.model.formula;
    for (const e of [c.params, c.stats, c.actions, c.options]) setHidden(e, false);
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
    if (c.startBox.dataset.key && !c.startBox.hidden) c.details.append(c.startBox);
  }

  // Starting values for non-linear models: in Details, or straight away when the fit
  // failed, so the user can steer a hard fit (D6).
  function renderStarts(c, fit, analysis, failed) {
    const r = c.result;
    const src = r ? null : modelSource(fit, analysis);
    const params = r ? r.model.params : (src && src.params) || [];
    const linear = r ? r.model.linear : ['line', 'poly', 'log'].includes(fit.model);
    const show = !linear && params.length > 0 && (failed || !!(c.open && r));
    setHidden(c.startBox, !show);
    if (!show) return;
    const key = params.join(',');
    if (c.startBox.dataset.key !== key) {
      c.startBox.dataset.key = key;
      c.startInputs.clear();
      const rows = params.map((p) => {
        const input = h('input', {
          class: 'mini-input', type: 'text', inputmode: 'decimal', autocomplete: 'off',
          'aria-label': `Starting value for ${paramLabel(p)}`, placeholder: 'auto',
        });
        input.addEventListener('change', () => {
          const f = current.set.fits.find((x) => x.id === fit.id);
          if (!f) return;
          const start = { ...f.start };
          if (input.value.trim()) start[p] = input.value.trim();
          else delete start[p];
          updateFit(fit.id, { start });
        });
        c.startInputs.set(p, input);
        return h('label', { class: 'start-row' }, h('i', {}, paramLabel(p)), input);
      });
      c.startBox.replaceChildren(
        h('p', { class: 'an-note' }, 'Starting values: where the search begins. Leave them blank for automatic, or type rough values if the fit fails or looks wrong.'),
        h('div', { class: 'start-grid' }, ...rows));
    }
    for (const [p, input] of c.startInputs) {
      const v = (fit.start && fit.start[p]) || '';
      if (document.activeElement !== input && input.value !== v) input.value = v;
    }
    // In Details when the fit worked; above the card body when it didn't.
    if (failed && c.startBox.parentNode !== c.li) c.li.insertBefore(c.startBox, c.body);
    if (!failed && c.startBox.parentNode !== c.details) c.details.append(c.startBox);
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
export function displayEquation(r) {
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

// Residuals (y − fit) against x, with σy error bars for weighted fits.
function drawResiduals(c, r, set, fit) {
  const canvas = c.residCanvas;
  const w = Math.round(canvas.clientWidth);
  const hgt = 120;
  if (w < 10) return;
  const key = `${w}|${fit.color}|${set.color}`;
  if (c.drawn === r && c.drawnKey === key) return;
  c.drawn = r;
  c.drawnKey = key;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(hgt * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cs = getComputedStyle(document.documentElement);
  const col = (n) => cs.getPropertyValue(n).trim();
  ctx.clearRect(0, 0, w, hgt);
  const { x, r: res, s } = r.residuals;
  if (!x.length) return;
  let xMin = Math.min(...x);
  let xMax = Math.max(...x);
  if (xMax === xMin) { xMin -= 1; xMax += 1; }
  const padX = (xMax - xMin) * 0.04;
  let m = 0;
  res.forEach((v, i) => { m = Math.max(m, Math.abs(v) + (s ? s[i] : 0)); });
  m = m * 1.15 || 1;
  const left = 8;
  const right = w - 8;
  const top = 18;
  const bottom = hgt - 8;
  const sx = (v) => left + ((v - xMin + padX) / (xMax - xMin + 2 * padX)) * (right - left);
  const sy = (v) => (top + bottom) / 2 - (v / m) * ((bottom - top) / 2);
  ctx.strokeStyle = col('--axis');
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, sy(0));
  ctx.lineTo(right, sy(0));
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = col('--text-muted');
  ctx.textBaseline = 'top';
  ctx.fillText('residuals: y − fit', left, 2);
  ctx.textAlign = 'right';
  ctx.fillText(`scale ±${formatNumber(m, 2)}`, right, 2);
  if (s) {
    ctx.strokeStyle = set.color;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    res.forEach((v, i) => {
      ctx.moveTo(sx(x[i]), sy(v - s[i]));
      ctx.lineTo(sx(x[i]), sy(v + s[i]));
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = set.color;
  ctx.beginPath();
  const rad = x.length > 500 ? 2 : 3;
  res.forEach((v, i) => {
    ctx.moveTo(sx(x[i]) + rad, sy(v));
    ctx.arc(sx(x[i]), sy(v), rad, 0, 2 * Math.PI);
  });
  ctx.fill();
}

// Tab-separated results for pasting into a spreadsheet, using the data set's decimal
// separator.
export function resultsText(r, set) {
  const d = set.decimal || 'point';
  const n = (v) => (Number.isFinite(v) ? formatCell(v, d) : '');
  const lines = [
    ['Data set', set.name],
    ['Model', r.model.formula],
    ['Fitted equation', r.equation || ''],
    ['Method', r.method],
    [],
    ['Parameter', 'Value', 'Standard error', '95% lower', '95% upper'],
    ...r.model.params.map((p, k) => [paramLabel(p), n(r.values[k]), n(r.se[k]), n(r.ci[k][0]), n(r.ci[k][1])]),
    [],
    ['Points', String(r.n)],
    ['Degrees of freedom', String(r.dof)],
    ['R²', n(r.r2)],
    ['Adjusted R²', n(r.adjR2)],
    ['RMSE', n(r.rmse)],
  ];
  if (r.weighted) lines.push(['χ²', n(r.chi2)], ['χ²/dof', n(r.chi2red)], ['P(χ²)', n(r.pValue)]);
  else lines.push(['Residual standard deviation', n(r.s)]);
  return `${lines.map((l) => l.join('\t')).join('\n')}\n`;
}
