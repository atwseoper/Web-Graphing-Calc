// Undo / redo of the user's work. Pure module – no DOM access.
//
// What is undoable: expression rows, data sets and fits, the Solve tab's inputs, and the
// angle, grid, axis-type and quartile settings. The view (pan/zoom), the open tab, the keypad setting and the
// Calc history are not: undo should never feel like it is fighting the user.
//
// Rapid changes of the same kind are merged into one step: typing in one row, dragging
// one slider, editing one data set. A pause of COALESCE_MS starts a new step.
// beginGroup() … endGroup() makes everything in between one step, whatever it changes
// and however long it takes (dragging a point that moves two sliders, Phase 6a).

export const UNDO_LIMIT = 200;
export const COALESCE_MS = 1000;

export function undoable(state) {
  return {
    rows: state.rows,
    nextId: state.nextId,
    data: state.data,
    solve: state.solve,
    angle: state.settings.angle,
    grid: state.settings.grid,
    xAxis: state.settings.xAxis,
    yAxis: state.settings.yAxis,
    quartiles: state.settings.quartiles,
  };
}

const PARTS = ['rows', 'nextId', 'data', 'solve', 'angle', 'grid', 'xAxis', 'yAxis', 'quartiles'];

export function sameUndoable(a, b) {
  return PARTS.every((k) => a[k] === b[k]);
}

export function applySnapshot(state, snap) {
  return {
    ...state,
    rows: snap.rows,
    nextId: Math.max(snap.nextId, state.nextId), // ids are never reused, so redo stays safe
    data: snap.data,
    solve: snap.solve,
    settings: {
      ...state.settings, angle: snap.angle, grid: snap.grid, xAxis: snap.xAxis, yAxis: snap.yAxis, quartiles: snap.quartiles,
    },
  };
}

// A label for the kind of change from a to b (undoable snapshots), or null for a change
// that should always be its own step (adding or deleting rows, reordering…).
export function changeKey(a, b) {
  const changed = PARTS.filter((k) => a[k] !== b[k]);
  if (changed.length !== 1) return null;
  const part = changed[0];
  if (part === 'rows') {
    if (a.rows.length !== b.rows.length) return null;
    let key = null;
    for (let i = 0; i < a.rows.length; i++) {
      const ra = a.rows[i];
      const rb = b.rows[i];
      if (ra === rb) continue;
      if (ra.id !== rb.id || key !== null) return null;
      const fields = Object.keys(rb).filter((f) => ra[f] !== rb[f]).sort();
      key = `row:${rb.id}:${fields.join(',')}`;
    }
    return key;
  }
  if (part === 'data') {
    const sa = a.data.sets;
    const sb = b.data.sets;
    if (sa.length !== sb.length) return null;
    let key = 'data';
    for (let i = 0; i < sa.length; i++) {
      if (sa[i] === sb[i]) continue;
      if (sa[i].id !== sb[i].id || key !== 'data') return null;
      key = `set:${sb[i].id}`;
    }
    return key;
  }
  if (part === 'solve') return 'solve';
  return null;
}

export function createHistory({ limit = UNDO_LIMIT, coalesceMs = COALESCE_MS } = {}) {
  let past = []; // snapshots before each step, oldest first
  let future = [];
  let lastKey = null;
  let lastTime = -Infinity;
  let group = null; // { recorded } while a group is open

  return {
    // Call with the full states before and after every store update.
    record(prev, next, now = Date.now()) {
      const a = undoable(prev);
      const b = undoable(next);
      if (sameUndoable(a, b)) return false;
      if (group) {
        if (!group.recorded) {
          past.push(a);
          if (past.length > limit) past = past.slice(past.length - limit);
          group.recorded = true;
        }
        future = [];
        lastKey = null;
        return true;
      }
      const key = changeKey(a, b);
      const merge = key !== null && key === lastKey && now - lastTime < coalesceMs && past.length > 0;
      if (!merge) {
        past.push(a);
        if (past.length > limit) past = past.slice(past.length - limit);
      }
      future = [];
      lastKey = key;
      lastTime = now;
      return true;
    },
    // Returns the snapshot to restore, or null. `current` is the full current state.
    undo(current) {
      group = null;
      if (!past.length) return null;
      future.push(undoable(current));
      lastKey = null;
      return past.pop();
    },
    redo(current) {
      if (!future.length) return null;
      past.push(undoable(current));
      lastKey = null;
      return future.pop();
    },
    // Stop merging into the current step (e.g. when the user moves to another field).
    seal() {
      lastKey = null;
    },
    beginGroup() {
      group = { recorded: false };
      lastKey = null;
    },
    endGroup() {
      group = null;
      lastKey = null;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() {
      past = [];
      future = [];
      lastKey = null;
    },
  };
}
