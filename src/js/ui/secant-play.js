// The secant play button (Phase 6b): shrinks h from its value towards 0 over a few
// seconds, so the secant turns into the tangent. The shrinking h isn't saved or undoable
// (like the view); when the play ends, the last h stays shown until play is pressed
// again, h is edited or the secant is turned off.
const PLAY_MS = 4000;
const SHRINK_TO = 1e-3; // h ends at this fraction of where it started

export function createSecantPlayer() {
  const plays = new Map(); // row id -> { h0, h, start, raf, playing }
  const listeners = new Set();
  const notify = () => { for (const l of listeners) l(); };

  function frame(id, now) {
    const p = plays.get(id);
    if (!p || !p.playing) return;
    if (!p.start) p.start = now;
    const t = Math.min(1, (now - p.start) / PLAY_MS);
    p.h = p.h0 * SHRINK_TO ** t;
    if (t >= 1) p.playing = false;
    else p.raf = requestAnimationFrame((n) => frame(id, n));
    notify();
  }

  function stop(id) {
    const p = plays.get(id);
    if (!p) return;
    cancelAnimationFrame(p.raf);
    plays.delete(id);
    notify();
  }

  return {
    // The h to show instead of the row's, or null.
    value: (id) => (plays.has(id) ? plays.get(id).h : null),
    isPlaying: (id) => !!(plays.get(id) && plays.get(id).playing),
    // Play from h0, or stop (back to the row's h) if playing.
    toggle(id, h0) {
      if (plays.has(id) && plays.get(id).playing) {
        stop(id);
        return;
      }
      if (plays.has(id)) cancelAnimationFrame(plays.get(id).raf);
      const p = { h0, h: h0, start: 0, raf: 0, playing: true };
      plays.set(id, p);
      p.raf = requestAnimationFrame((n) => frame(id, n));
      notify();
    },
    stop,
    stopAll() { for (const id of [...plays.keys()]) stop(id); },
    onChange: (fn) => listeners.add(fn),
  };
}
