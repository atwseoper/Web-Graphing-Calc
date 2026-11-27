// The cobweb play button (Phase 9b): draws a cobweb diagram one step at a time, up to
// the row's number of steps, so each term can be followed from the curve to the line
// y = x and back. Like the secant play, the step reached isn't saved or undoable; when
// the play ends the whole diagram shows again.
const PLAY_MS = 4000; // the whole play, unless that makes a step shorter than STEP_MIN_MS
const STEP_MIN_MS = 150;
const STEP_MAX_MS = 700;

export function createCobwebPlayer() {
  const plays = new Map(); // row id -> { steps, k, start, raf, stepMs }
  const listeners = new Set();
  const notify = () => { for (const l of listeners) l(); };

  function frame(id, now) {
    const p = plays.get(id);
    if (!p) return;
    if (!p.start) p.start = now;
    const k = Math.min(p.steps, Math.floor((now - p.start) / p.stepMs));
    if (k !== p.k) {
      p.k = k;
      notify();
    }
    if (k >= p.steps) {
      plays.delete(id);
      notify();
      return;
    }
    p.raf = requestAnimationFrame((n) => frame(id, n));
  }

  function stop(id) {
    const p = plays.get(id);
    if (!p) return;
    cancelAnimationFrame(p.raf);
    plays.delete(id);
    notify();
  }

  return {
    // The number of steps to draw instead of the row's, or null.
    value: (id) => (plays.has(id) ? plays.get(id).k : null),
    isPlaying: (id) => plays.has(id),
    toggle(id, steps) {
      if (plays.has(id)) {
        stop(id);
        return;
      }
      const stepMs = Math.min(STEP_MAX_MS, Math.max(STEP_MIN_MS, PLAY_MS / Math.max(1, steps)));
      const p = { steps, k: 0, start: 0, raf: 0, stepMs };
      plays.set(id, p);
      p.raf = requestAnimationFrame((n) => frame(id, n));
      notify();
    },
    stop,
    onChange: (fn) => listeners.add(fn),
  };
}
