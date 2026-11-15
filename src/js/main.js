// Entry point. Phase 0 placeholder: responsive shell, panel tabs and a static grid.
import { createViewport } from './plot/viewport.js';
import { drawCartesianGrid } from './plot/grid.js';

const canvas = document.getElementById('graph-canvas');
const ctx = canvas.getContext('2d');
const vp = createViewport({ scale: 40 });

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = cssVar('--graph-bg');
  ctx.fillRect(0, 0, vp.width, vp.height);
  drawCartesianGrid(ctx, vp, {
    gridMinor: cssVar('--grid-minor'),
    gridMajor: cssVar('--grid-major'),
    axis: cssVar('--axis'),
    label: cssVar('--label'),
  });
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  vp.width = rect.width;
  vp.height = rect.height;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  draw();
}

new ResizeObserver(resize).observe(canvas);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);

// Panel tabs
const tabs = document.querySelectorAll('[role="tab"]');
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    for (const t of tabs) {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
    }
  });
}
