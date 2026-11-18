// Dragging points on the graph (Phase 6a). The graph view asks which points have a
// handle, and passes the finger position during a drag; this turns it into new slider
// values (expr/drag.js), snapped to each slider's step, and writes them to the slider
// rows. A drag past a slider's min or max widens its range: empty bounds widen by
// themselves (D19), and a bound the user typed is moved to the new value. The whole drag
// is one undo step.
import { dragPlan, nearestOnPath, solvePair, pairCondition, MAX_CONDITION } from '../expr/drag.js';
import { sliderRange, snapToStep, valueText } from '../expr/slider.js';

function fieldValue(analysis, text) {
  if (!text || !text.trim()) return null;
  const r = analysis.evaluate(text);
  return !r.error && Number.isFinite(r.value) ? r.value : null;
}

export function createPointDrag({ store, getAnalysis, history }) {
  const startListeners = new Set();
  // Plans for the current analysis, by row id: { plan, point(...vals) } | null.
  let planned = { analysis: null, byRow: new Map(), sliders: new Map() };

  function refreshCache() {
    const analysis = getAnalysis();
    if (planned.analysis === analysis) return planned;
    const state = store.get();
    const sliders = new Map(); // name -> row index
    analysis.rows.forEach((r, i) => {
      if (r && r.kind === 'variable' && r.slider && Number.isFinite(r.value)) sliders.set(r.name, i);
    });
    planned = { analysis, byRow: new Map(), sliders, rows: state.rows };
    return planned;
  }

  function planFor(rowId) {
    const c = refreshCache();
    if (c.byRow.has(rowId)) return c.byRow.get(rowId);
    let out = null;
    const i = c.rows.findIndex((row) => row.id === rowId);
    const r = i >= 0 ? c.analysis.rows[i] : null;
    if (r && r.kind === 'point' && r.expr) {
      const plan = dragPlan(r.expr, {
        isSlider: (n) => c.sliders.has(n),
        dependencies: (n) => c.analysis.dependencies(n),
      });
      if (plan) {
        try {
          const fx = c.analysis.compileIn(r.expr.items[0], plan.names);
          const fy = c.analysis.compileIn(r.expr.items[1], plan.names);
          const point = (...vals) => {
            const x = fx(vals);
            const y = fy(vals);
            return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
          };
          out = { plan, point };
        } catch {
          out = null;
        }
      }
    }
    c.byRow.set(rowId, out);
    return out;
  }

  const sliderValues = (names) => {
    const c = refreshCache();
    return names.map((n) => c.analysis.rows[c.sliders.get(n)].value);
  };

  // Does this point row get a handle? scale: [px per unit in x, in y].
  function isDraggable(rowId, scale) {
    const p = planFor(rowId);
    if (!p) return false;
    if (p.plan.kind !== 'solve') return true;
    return pairCondition(p.point, ...sliderValues(p.plan.names), scale) < MAX_CONDITION;
  }

  function rangeOf(row, value, analysis) {
    return sliderRange(value, {
      min: fieldValue(analysis, row.sliderMin),
      max: fieldValue(analysis, row.sliderMax),
      step: fieldValue(analysis, row.sliderStep),
    });
  }

  function begin(rowId) {
    const p = planFor(rowId);
    if (!p) return null;
    const c = refreshCache();
    const names = p.plan.names;
    const rowIds = names.map((n) => c.rows[c.sliders.get(n)].id);
    const values = sliderValues(names);
    const ranges = names.map((n, k) => rangeOf(c.rows[c.sliders.get(n)], values[k], c.analysis));
    for (const l of startListeners) l(rowIds);
    history.beginGroup();
    return { ...p, rowIds, values, ranges };
  }

  // target: [x, y] where the point should go (world units); scale: px per unit.
  function move(session, target, scale) {
    const { plan, point } = session;
    let raw;
    if (plan.kind === 'axis') {
      raw = [target[plan.axis]];
    } else if (plan.kind === 'path') {
      // Search the range the slider had when the drag began, plus half its width on
      // each side, so a drag can carry it a little past its ends.
      const { lo, hi } = session.ranges[0];
      const w = hi - lo;
      const v = nearestOnPath(point, lo - w / 2, hi + w / 2, target, scale, { near: session.values[0] });
      if (v === null) return;
      raw = [v];
    } else {
      raw = solvePair(point, session.values, target, scale);
      if (!raw) return;
    }
    if (!raw.every(Number.isFinite)) return;

    const analysis = getAnalysis();
    const state = store.get();
    const changes = new Map(); // row id -> fields
    const next = raw.map((v, k) => {
      const row = state.rows.find((r) => r.id === session.rowIds[k]);
      if (!row) return v;
      const range = rangeOf(row, v, analysis);
      const snapped = snapToStep(v, range.lo, range.step);
      const fields = { text: `${plan.names[k]} = ${valueText(snapped)}` };
      // Widen a bound the user typed; empty bounds follow the value by themselves.
      const min = fieldValue(analysis, row.sliderMin);
      const max = fieldValue(analysis, row.sliderMax);
      if (min !== null && snapped < min) fields.sliderMin = valueText(snapped);
      if (max !== null && snapped > max) fields.sliderMax = valueText(snapped);
      changes.set(row.id, fields);
      return snapped;
    });
    session.values = next;
    store.update((s) => {
      let changed = false;
      const rows = s.rows.map((r) => {
        const f = changes.get(r.id);
        if (!f || Object.keys(f).every((k) => r[k] === f[k])) return r;
        changed = true;
        return { ...r, ...f };
      });
      return changed ? { ...s, rows } : s;
    });
  }

  function end() {
    history.endGroup();
  }

  return {
    isDraggable, begin, move, end,
    // Called with the slider row ids when a drag starts (to stop them playing).
    onStart: (fn) => startListeners.add(fn),
  };
}
