// Saving and restoring state. serialize/deserialize are pure; load/save take a
// Storage-like object (localStorage in the browser) so they can be tested.
import { RIEMANN_METHODS } from '../numerics/riemann.js';
import {
  defaultState, defaultSolve, defaultData, newRow, newFit, FIT_MODELS, PALETTE, STATE_VERSION, MAX_ODE_POINTS,
} from './defaults.js';
import { newDataSet, MAX_SETS, DISPLAY_MODES } from '../data/table.js';
import { QUARTILE_METHODS } from '../data/summary.js';
import { MAX_POINTS } from '../data/csv.js';

export const STORAGE_KEY = 'graphcalc:v1';
export const AXIS_TYPES = ['linear', 'log'];
const MAX_HISTORY = 100;

const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const bool = (v, fallback = false) => (typeof v === 'boolean' ? v : fallback);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const oneOf = (v, options, fallback) => (options.includes(v) ? v : fallback);

export function serialize(state) {
  return JSON.stringify({
    version: STATE_VERSION,
    nextId: state.nextId,
    rows: state.rows,
    view: state.view,
    settings: state.settings,
    calc: { history: state.calc.history.slice(-MAX_HISTORY) },
    solve: state.solve,
    data: serializeData(state.data),
    ui: state.ui,
  });
}

// Points are stored as [x, y, σy, off] to keep saved data small.
function serializeData(data) {
  if (!data) return undefined;
  return {
    nextId: data.nextId,
    active: data.active,
    sets: data.sets.map((set) => ({
      ...set,
      points: set.points.map((p) => [p.x, p.y, p.s, p.off ? 1 : 0]),
    })),
  };
}

// Parse saved JSON, validating every field and falling back to defaults.
export function deserialize(json) {
  const d = defaultState();
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    return d;
  }
  if (!raw || typeof raw !== 'object' || raw.version !== STATE_VERSION) return d;

  const rows = [];
  const seen = new Set();
  if (Array.isArray(raw.rows)) {
    for (const r of raw.rows) {
      if (!r || typeof r !== 'object' || !Number.isInteger(r.id) || seen.has(r.id)) continue;
      seen.add(r.id);
      const row = newRow(r.id, /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : PALETTE[rows.length % PALETTE.length], str(r.text));
      row.hidden = bool(r.hidden);
      row.domainMin = str(r.domainMin);
      row.domainMax = str(r.domainMax);
      row.showTable = bool(r.showTable);
      row.tableStart = str(r.tableStart);
      row.tableStep = str(r.tableStep);
      row.sliderMin = str(r.sliderMin);
      row.sliderMax = str(r.sliderMax);
      row.sliderStep = str(r.sliderStep);
      row.showAnalysis = bool(r.showAnalysis);
      row.showDeriv = bool(r.showDeriv);
      row.atX = str(r.atX);
      row.intFrom = str(r.intFrom);
      row.intTo = str(r.intTo);
      row.riemann = RIEMANN_METHODS.includes(r.riemann) ? r.riemann : '';
      row.riemannN = str(r.riemannN);
      row.taylor = bool(r.taylor);
      row.taylorN = str(r.taylorN);
      row.taylorAt = str(r.taylorAt);
      row.secant = bool(r.secant);
      row.secantH = str(r.secantH);
      if (Array.isArray(r.odePoints)) {
        row.odePoints = r.odePoints
          .filter((p) => Array.isArray(p) && num(p[0]) !== null && num(p[1]) !== null)
          .slice(0, MAX_ODE_POINTS)
          .map((p) => [p[0], p[1]]);
      }
      rows.push(row);
    }
  }
  const maxId = rows.reduce((m, r) => Math.max(m, r.id), 0);

  let view = null;
  if (raw.view && typeof raw.view === 'object') {
    const v = { cx: num(raw.view.cx), cy: num(raw.view.cy), scaleX: num(raw.view.scaleX), scaleY: num(raw.view.scaleY) };
    // The view is in axis coordinates (log10 on a log axis, Phase 7a), so it records
    // which axes were log; the graph converts it if the settings say otherwise.
    if (v.cx !== null && v.cy !== null && v.scaleX > 0 && v.scaleY > 0) {
      view = { ...v, logX: bool(raw.view.logX), logY: bool(raw.view.logY) };
    }
  }

  const s = raw.settings || {};
  const history = Array.isArray(raw.calc && raw.calc.history)
    ? raw.calc.history
      .filter((h) => h && typeof h.input === 'string')
      .map((h) => ({ input: h.input, output: str(h.output), value: num(h.value), error: bool(h.error) }))
      .slice(-MAX_HISTORY)
    : [];

  return {
    version: STATE_VERSION,
    nextId: Math.max(Number.isInteger(raw.nextId) ? raw.nextId : 0, maxId + 1),
    rows: rows.length ? rows : d.rows,
    view,
    settings: {
      angle: oneOf(s.angle, ['rad', 'deg'], 'rad'),
      grid: oneOf(s.grid, ['cartesian', 'polar'], 'cartesian'),
      keypad: oneOf(s.keypad, ['auto', 'always', 'never'], 'auto'),
      pretty: oneOf(s.pretty, ['on', 'off'], 'on'),
      xAxis: oneOf(s.xAxis, AXIS_TYPES, 'linear'),
      yAxis: oneOf(s.yAxis, AXIS_TYPES, 'linear'),
      quartiles: oneOf(s.quartiles, QUARTILE_METHODS, 'ti'),
    },
    calc: { history },
    solve: deserializeSolve(raw.solve),
    data: deserializeData(raw.data),
    ui: { tab: oneOf(raw.ui && raw.ui.tab, ['graph', 'solve', 'data', 'calc'], 'graph') },
  };
}

const COLOR = /^#[0-9a-f]{6}$/i;
const cell = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function deserializeData(raw) {
  const d = defaultData();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sets)) return d;
  const ids = new Set();
  let maxId = 0;
  const takeId = (id) => {
    if (!Number.isInteger(id) || id < 1 || ids.has(id)) return null;
    ids.add(id);
    maxId = Math.max(maxId, id);
    return id;
  };
  const sets = [];
  for (const r of raw.sets.slice(0, MAX_SETS)) {
    if (!r || typeof r !== 'object' || !Array.isArray(r.points)) continue;
    const id = takeId(r.id);
    if (id === null) continue;
    const points = [];
    for (const p of r.points.slice(0, MAX_POINTS)) {
      if (!Array.isArray(p)) continue;
      const s = cell(p[2]);
      points.push({ x: cell(p[0]), y: cell(p[1]), s: s !== null && s > 0 ? s : null, off: p[3] === 1 });
    }
    const fits = [];
    if (Array.isArray(r.fits)) {
      for (const f of r.fits.slice(0, 20)) {
        if (!f || typeof f !== 'object') continue;
        const fid = takeId(f.id);
        if (fid === null || !FIT_MODELS.includes(f.model)) continue;
        const start = {};
        if (f.start && typeof f.start === 'object') {
          for (const [k, v] of Object.entries(f.start)) if (typeof v === 'string' && k.length <= 8) start[k] = v;
        }
        fits.push(newFit(fid, COLOR.test(f.color) ? f.color : PALETTE[fits.length % PALETTE.length], f.model, {
          hidden: bool(f.hidden),
          degree: Number.isInteger(f.degree) && f.degree >= 2 && f.degree <= 6 ? f.degree : 2,
          custom: str(f.custom).slice(0, 500),
          start,
          weighted: bool(f.weighted, true),
          bands: oneOf(f.bands, ['none', 'conf', 'both'], 'none'),
          residuals: bool(f.residuals),
        }));
      }
    }
    sets.push(newDataSet(id, COLOR.test(r.color) ? r.color : PALETTE[sets.length % PALETTE.length], str(r.name).slice(0, 60) || `Data ${id}`, points, {
      hidden: bool(r.hidden),
      decimal: oneOf(r.decimal, ['point', 'comma'], 'point'),
      xName: str(r.xName, 'x').slice(0, 40) || 'x',
      yName: str(r.yName, 'y').slice(0, 40) || 'y',
      hasSigma: bool(r.hasSigma),
      display: oneOf(r.display, DISPLAY_MODES, 'scatter'),
      histColumn: oneOf(r.histColumn, ['x', 'y'], 'x'),
      binWidth: num(r.binWidth) > 0 ? r.binWidth : null,
      fits,
    }));
  }
  const active = sets.some((s) => s.id === raw.active) ? raw.active : sets.length ? sets[0].id : null;
  return { sets, nextId: Math.max(Number.isInteger(raw.nextId) ? raw.nextId : 1, maxId + 1), active };
}

function deserializeSolve(raw) {
  const d = defaultSolve();
  if (!raw || typeof raw !== 'object') return d;
  const given = {};
  if (raw.given && typeof raw.given === 'object') {
    for (const [k, v] of Object.entries(raw.given)) if (typeof v === 'string' && k.length <= 8) given[k] = v;
  }
  const system = Array.isArray(raw.system) ? raw.system.filter((t) => typeof t === 'string').slice(0, 12) : d.system;
  return {
    mode: oneOf(raw.mode, ['equation', 'polynomial', 'system'], 'equation'),
    equation: str(raw.equation),
    solveFor: str(raw.solveFor),
    given,
    from: str(raw.from),
    to: str(raw.to),
    polynomial: str(raw.polynomial),
    system: system.length ? system : d.system,
  };
}

export function load(storage) {
  try {
    const json = storage.getItem(STORAGE_KEY);
    return json ? deserialize(json) : defaultState();
  } catch {
    return defaultState();
  }
}

export function save(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, serialize(state));
    return true;
  } catch {
    return false; // storage full or unavailable (e.g. private mode) – keep working
  }
}
