// Default state, colour palette and row helpers.

// Curve colours chosen to read well on both light and dark backgrounds and to stay
// distinguishable for common colour-vision deficiencies (blue/orange/teal lead).
export const PALETTE = ['#2f6fed', '#e8590c', '#0f9d8a', '#c2255c', '#7048e8', '#5c940d', '#d6336c', '#1098ad'];

export const STATE_VERSION = 1;

export function newRow(id, color, text = '') {
  return {
    id, text, color, hidden: false,
    domainMin: '', domainMax: '',
    showTable: false, tableStart: '', tableStep: '',
  };
}

// The least-used palette colour, in palette order.
export function nextColor(rows) {
  const counts = new Map(PALETTE.map((c) => [c, 0]));
  for (const r of rows) if (counts.has(r.color)) counts.set(r.color, counts.get(r.color) + 1);
  let best = PALETTE[0];
  for (const c of PALETTE) if (counts.get(c) < counts.get(best)) best = c;
  return best;
}

export function defaultState() {
  return {
    version: STATE_VERSION,
    nextId: 3,
    rows: [newRow(1, PALETTE[0], 'y = sin(x)'), newRow(2, PALETTE[1])],
    view: null, // null = home view for the current screen size
    settings: { angle: 'rad', grid: 'cartesian', keypad: 'auto' },
    calc: { history: [] },
    ui: { tab: 'graph' },
  };
}
