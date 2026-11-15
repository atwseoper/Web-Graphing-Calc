// Minimal observable store. State is treated as immutable: update() must return a
// new object (and new nested objects for anything that changed).

export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    update(fn) {
      const prev = state;
      const next = fn(prev);
      if (next === prev) return;
      state = next;
      for (const l of [...listeners]) l(state, prev);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
