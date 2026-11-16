// "Save image": the graph as a PNG with a legend of what is drawn on it.
import { isPlottable } from './graph-view.js';
import { displayEquation } from './fit-panel.js';
import { PRESETS } from '../fit/models.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MAX_ENTRIES = 14;
const MAX_PIXELS = 4096; // longest side of the exported image

// What the legend lists: visible graphs, visible data sets and their visible fits.
// Each entry: { color, text, kind: 'line' | 'dot' }.
export function legendEntries(state, analysis, fits) {
  const out = [];
  state.rows.forEach((row, i) => {
    const r = analysis.rows[i];
    if (row.hidden || !isPlottable(r) || !row.text.trim()) return;
    out.push({ color: row.color, text: row.text.trim(), kind: r.kind === 'point' ? 'dot' : 'line' });
  });
  for (const set of state.data.sets) {
    if (set.hidden) continue;
    out.push({ color: set.color, text: set.name, kind: 'dot' });
    for (const { set: s, fit, result } of fits) {
      if (s.id !== set.id) continue;
      let eq = '';
      try {
        eq = displayEquation(result) || '';
      } catch { /* label without the equation */ }
      const name = fit.model === 'poly' ? `Polynomial (degree ${fit.degree})` : PRESETS[fit.model].name;
      out.push({ color: fit.color, text: `${name} fit${eq ? `: ${eq}` : ''}`, kind: 'line' });
    }
  }
  return out;
}

function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

// Build the PNG. Returns a Promise of a Blob, or null if the graph has no size yet.
export function graphPng(graph, entries, { legend = true } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const probe = graph.renderImage(1);
  if (!probe) return Promise.resolve(null);
  const scale = Math.min(Math.max(2, dpr), MAX_PIXELS / Math.max(probe.width, probe.height));
  const img = graph.renderImage(scale);
  const { width, colors } = img;

  const shown = legend ? entries.slice(0, MAX_ENTRIES) : [];
  const more = legend ? entries.length - shown.length : 0;
  const lineH = 24;
  const pad = 14;
  const legendH = shown.length ? pad * 2 + lineH * (shown.length + (more > 0 ? 1 : 0)) : 0;

  const out = document.createElement('canvas');
  out.width = img.canvas.width;
  out.height = Math.round((img.height + legendH) * scale);
  const ctx = out.getContext('2d');
  ctx.drawImage(img.canvas, 0, 0);
  if (legendH) {
    ctx.setTransform(scale, 0, 0, scale, 0, img.height * scale);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, legendH);
    ctx.strokeStyle = colors.gridMajor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0.5);
    ctx.lineTo(width, 0.5);
    ctx.stroke();
    ctx.font = `14px ${FONT}`;
    ctx.textBaseline = 'middle';
    shown.forEach((e, i) => {
      const y = pad + lineH * i + lineH / 2;
      ctx.strokeStyle = e.color;
      ctx.fillStyle = e.color;
      if (e.kind === 'dot') {
        ctx.beginPath();
        ctx.arc(pad + 11, y, 5, 0, 2 * Math.PI);
        ctx.fill();
      } else {
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(pad + 22, y);
        ctx.stroke();
      }
      ctx.fillStyle = colors.text || colors.label;
      ctx.fillText(ellipsize(ctx, e.text, width - pad * 2 - 32), pad + 32, y);
    });
    if (more > 0) {
      ctx.fillStyle = colors.label;
      ctx.globalAlpha = 0.75;
      ctx.fillText(`and ${more} more`, pad + 32, pad + lineH * shown.length + lineH / 2);
      ctx.globalAlpha = 1;
    }
  }
  return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/png'));
}
