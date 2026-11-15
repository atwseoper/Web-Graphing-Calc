// Draws the Cartesian grid, axes and tick labels onto a 2D canvas context.
import { toScreen, worldBounds, niceStep, ticks, formatTick } from './viewport.js';

const MIN_MAJOR_PX = 80; // target minimum spacing between labelled grid lines

export function drawCartesianGrid(ctx, vp, colors) {
  const { xMin, xMax, yMin, yMax } = worldBounds(vp);
  const major = niceStep(MIN_MAJOR_PX / vp.scale);
  const minor = major / (String(major / 10 ** Math.floor(Math.log10(major)))[0] === '2' ? 4 : 5);

  ctx.save();
  ctx.lineWidth = 1;

  // Minor and major grid lines (offset by 0.5 px for crisp 1px lines).
  for (const [step, color] of [[minor, colors.gridMinor], [major, colors.gridMajor]]) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const x of ticks(xMin, xMax, step)) {
      const sx = Math.round(toScreen(vp, x, 0)[0]) + 0.5;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, vp.height);
    }
    for (const y of ticks(yMin, yMax, step)) {
      const sy = Math.round(toScreen(vp, 0, y)[1]) + 0.5;
      ctx.moveTo(0, sy); ctx.lineTo(vp.width, sy);
    }
    ctx.stroke();
  }

  // Axes, clamped to the visible edge when off screen so labels stay readable.
  const [ox, oy] = toScreen(vp, 0, 0);
  const axisX = Math.min(Math.max(ox, 0), vp.width);
  const axisY = Math.min(Math.max(oy, 0), vp.height);
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (ox >= 0 && ox <= vp.width) { ctx.moveTo(ox, 0); ctx.lineTo(ox, vp.height); }
  if (oy >= 0 && oy <= vp.height) { ctx.moveTo(0, oy); ctx.lineTo(vp.width, oy); }
  ctx.stroke();

  // Labels
  ctx.fillStyle = colors.label;
  ctx.font = '12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelY = Math.min(Math.max(axisY + 4, 4), vp.height - 18);
  for (const x of ticks(xMin, xMax, major)) {
    if (Math.abs(x) < major * 1e-9) continue;
    ctx.fillText(formatTick(x, major), toScreen(vp, x, 0)[0], labelY);
  }
  ctx.textAlign = axisX > vp.width - 40 ? 'right' : 'left';
  ctx.textBaseline = 'middle';
  const labelX = axisX > vp.width - 40 ? vp.width - 4 : Math.max(axisX + 4, 4);
  for (const y of ticks(yMin, yMax, major)) {
    if (Math.abs(y) < major * 1e-9) continue;
    ctx.fillText(formatTick(y, major), labelX, toScreen(vp, 0, y)[1]);
  }
  if (ox >= 0 && ox <= vp.width && oy >= 0 && oy <= vp.height) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('0', ox - 4, oy + 4);
  }
  ctx.restore();
}
