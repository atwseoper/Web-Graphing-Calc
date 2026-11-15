// Saving and restoring state. serialize/deserialize are pure; load/save take a
// Storage-like object (localStorage in the browser) so they can be tested.
import { defaultState, newRow, PALETTE, STATE_VERSION } from './defaults.js';

export const STORAGE_KEY = 'graphcalc:v1';
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
    ui: state.ui,
  });
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
      rows.push(row);
    }
  }
  const maxId = rows.reduce((m, r) => Math.max(m, r.id), 0);

  let view = null;
  if (raw.view && typeof raw.view === 'object') {
    const v = { cx: num(raw.view.cx), cy: num(raw.view.cy), scaleX: num(raw.view.scaleX), scaleY: num(raw.view.scaleY) };
    if (v.cx !== null && v.cy !== null && v.scaleX > 0 && v.scaleY > 0) view = v;
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
    },
    calc: { history },
    ui: { tab: oneOf(raw.ui && raw.ui.tab, ['graph', 'solve', 'data', 'calc'], 'graph') },
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
