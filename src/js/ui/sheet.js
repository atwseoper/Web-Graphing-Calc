// Draggable bottom sheet for portrait layouts. In the landscape side-panel layout
// the sheet is inactive and the panel fills the height.

const SIDE_PANEL_QUERY = '(min-width: 720px) and (orientation: landscape)';

export function createSheet({ panel, handle, onResize }) {
  const side = window.matchMedia(SIDE_PANEL_QUERY);
  let snap = 'half';
  let drag = null;

  function heights() {
    const vh = window.innerHeight;
    return { peek: 150, half: Math.round(vh * 0.42), full: Math.round(vh - 120) };
  }

  function apply(px, animate) {
    panel.classList.toggle('is-animating', !!animate);
    panel.style.setProperty('--sheet-h', `${px}px`);
    if (onResize) onResize();
  }

  function setSnap(name, animate = true) {
    snap = name;
    if (side.matches) return;
    apply(heights()[name], animate);
    handle.setAttribute('aria-valuenow', String(['peek', 'half', 'full'].indexOf(name)));
  }

  function refresh() {
    if (side.matches) {
      panel.style.removeProperty('--sheet-h');
    } else {
      apply(heights()[snap], false);
    }
  }

  handle.addEventListener('pointerdown', (e) => {
    if (side.matches) return;
    handle.setPointerCapture(e.pointerId);
    drag = { y0: e.clientY, h0: panel.getBoundingClientRect().height, moved: false };
    panel.classList.remove('is-animating');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = drag.y0 - e.clientY;
    if (Math.abs(dy) > 4) drag.moved = true;
    const { peek, full } = heights();
    apply(Math.min(full, Math.max(peek - 40, drag.h0 + dy)), false);
  });
  const end = (e) => {
    if (!drag) return;
    const hNow = panel.getBoundingClientRect().height;
    const moved = drag.moved;
    const velocity = drag.y0 - e.clientY;
    drag = null;
    const hs = heights();
    if (!moved) {
      // Tap on the handle cycles peek -> half -> full -> half.
      setSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half');
      return;
    }
    // Snap to the nearest height, biased in the direction of the drag.
    const target = hNow + Math.sign(velocity) * 40;
    const best = Object.entries(hs).reduce((a, b) => (Math.abs(b[1] - target) < Math.abs(a[1] - target) ? b : a));
    setSnap(best[0]);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', (e) => {
    const order = ['peek', 'half', 'full'];
    const i = order.indexOf(snap);
    if (e.key === 'ArrowUp' && i < 2) { e.preventDefault(); setSnap(order[i + 1]); }
    if (e.key === 'ArrowDown' && i > 0) { e.preventDefault(); setSnap(order[i - 1]); }
  });

  window.addEventListener('resize', refresh);
  side.addEventListener('change', refresh);
  refresh();

  return {
    setSnap,
    ensureAtLeast(name) {
      const order = ['peek', 'half', 'full'];
      if (order.indexOf(snap) < order.indexOf(name)) setSnap(name);
    },
    isSidePanel: () => side.matches,
  };
}
