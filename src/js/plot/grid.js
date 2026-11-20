// Draws the Cartesian or polar grid, axes and labels onto a 2D canvas context.
// Lines are drawn before the curves and labels after them, so a label (with its
// background-coloured outline) always stays readable – including the 0 at the origin,
// where many curves pass. Either Cartesian axis may be logarithmic (Phase 7a): it then
// has no zero line, and the other axis's labels sit at the edge of the graph.
import {
  toScreen, screenX, screenY, worldBounds, niceStep, minorStep, ticks, formatTick, axisTicks, MIN_MAJOR_PX,
} from './viewport.js';

const FONT = '12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function gridSteps(vp) {
  const majorX = niceStep(MIN_MAJOR_PX / vp.scaleX);
  const majorY = niceStep(MIN_MAJOR_PX / vp.scaleY);
  return { majorX, majorY, minorX: minorStep(majorX), minorY: minorStep(majorY) };
}

function strokeVertical(ctx, vp, xs) {
  for (const x of xs) {
    const sx = Math.round(screenX(vp, x)) + 0.5;
    if (!Number.isFinite(sx)) continue;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, vp.height);
  }
}
function strokeHorizontal(ctx, vp, ys) {
  for (const y of ys) {
    const sy = Math.round(screenY(vp, y)) + 0.5;
    if (!Number.isFinite(sy)) continue;
    ctx.moveTo(0, sy);
    ctx.lineTo(vp.width, sy);
  }
}

// Labels outlined in the background colour so they stay legible over curves and lines.
function label(ctx, text, x, y, colors) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = colors.bg;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

// Screen position of the origin; on a log axis there is no zero, so x labels go to the
// bottom edge (log y) and y labels to the left edge (log x).
function origin(vp) {
  const ox = vp.logX ? -Infinity : screenX(vp, 0);
  const oy = vp.logY ? Infinity : screenY(vp, 0);
  return [ox, oy];
}

function drawAxes(ctx, vp, colors) {
  const [ox, oy] = origin(vp);
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (ox >= 0 && ox <= vp.width) { ctx.moveTo(ox, 0); ctx.lineTo(ox, vp.height); }
  if (oy >= 0 && oy <= vp.height) { ctx.moveTo(0, oy); ctx.lineTo(vp.width, oy); }
  ctx.stroke();
}

function drawAxisLabels(ctx, vp, colors, tx, ty) {
  const [ox, oy] = origin(vp);
  ctx.fillStyle = colors.label;
  ctx.font = FONT;

  // x labels: under the x axis, or pinned to the top/bottom edge when it's off screen.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelY = Math.min(Math.max(oy + 5, 4), vp.height - 18);
  tx.major.forEach((x, k) => {
    if (!tx.labels[k]) return;
    // Skip labels the edge of the canvas would cut (log axes often end on a decade line).
    const sx = screenX(vp, x);
    const half = ctx.measureText(tx.labels[k]).width / 2;
    if (sx - half < 1 || sx + half > vp.width - 1) return;
    label(ctx, tx.labels[k], sx, labelY, colors);
  });

  // y labels: right of the y axis, or pinned to the left/right edge.
  const pinRight = ox > vp.width - 40;
  ctx.textAlign = pinRight ? 'right' : 'left';
  ctx.textBaseline = 'middle';
  const labelX = pinRight ? vp.width - 4 : Math.max(ox + 5, 4);
  ty.major.forEach((y, k) => {
    const sy = screenY(vp, y);
    // On log y the x labels run along the bottom edge: keep y labels out of that row.
    if (!ty.labels[k] || sy < 7 || sy > vp.height - 7) return;
    if (ty.labels[k] && !(vp.logY && sy > labelY - 8)) label(ctx, ty.labels[k], labelX, sy, colors);
  });

  if (ox >= 0 && ox <= vp.width && oy >= 0 && oy <= vp.height) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    label(ctx, '0', ox - 5, oy + 5, colors);
  }
}

export function drawCartesianGrid(ctx, vp, colors) {
  const tx = axisTicks(vp, 'x');
  const ty = axisTicks(vp, 'y');

  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.gridMinor;
  ctx.beginPath();
  strokeVertical(ctx, vp, tx.minor);
  strokeHorizontal(ctx, vp, ty.minor);
  ctx.stroke();

  ctx.strokeStyle = colors.gridMajor;
  ctx.beginPath();
  strokeVertical(ctx, vp, tx.major);
  strokeHorizontal(ctx, vp, ty.major);
  ctx.stroke();

  drawAxes(ctx, vp, colors);
  ctx.restore();
}

export function drawCartesianLabels(ctx, vp, colors) {
  ctx.save();
  drawAxisLabels(ctx, vp, colors, axisTicks(vp, 'x'), axisTicks(vp, 'y'));
  ctx.restore();
}

// Angle labels for the polar grid.
const PI_LABELS = {
  0: '0', 30: 'π/6', 60: 'π/3', 90: 'π/2', 120: '2π/3', 150: '5π/6', 180: 'π',
  210: '7π/6', 240: '4π/3', 270: '3π/2', 300: '5π/3', 330: '11π/6',
};

export function drawPolarGrid(ctx, vp, colors) {
  const { xMin, xMax, yMin, yMax } = worldBounds(vp);
  const [ox, oy] = toScreen(vp, 0, 0);
  const step = niceStep(MIN_MAJOR_PX / Math.min(vp.scaleX, vp.scaleY));
  const minor = minorStep(step);

  // Radius range that intersects the view.
  const nearestX = Math.min(Math.max(0, xMin), xMax);
  const nearestY = Math.min(Math.max(0, yMin), yMax);
  const rMin = Math.hypot(nearestX, nearestY);
  const rMax = Math.max(Math.hypot(xMin, yMin), Math.hypot(xMin, yMax), Math.hypot(xMax, yMin), Math.hypot(xMax, yMax));

  ctx.save();
  ctx.lineWidth = 1;
  for (const [s, color] of [[minor, colors.gridMinor], [step, colors.gridMajor]]) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const r of ticks(Math.max(s, rMin - s), rMax + s, s, 400)) {
      ctx.moveTo(ox + r * vp.scaleX, oy);
      ctx.ellipse(ox, oy, r * vp.scaleX, r * vp.scaleY, 0, 0, 2 * Math.PI);
    }
    ctx.stroke();
  }

  // Radial lines every 15° (minor) and 30° (major), drawn from the origin to well past the view.
  const far = (rMax + step) * 2;
  for (const [every, color] of [[15, colors.gridMinor], [30, colors.gridMajor]]) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let deg = 0; deg < 360; deg += every) {
      if (deg % 90 === 0) continue;
      const a = (deg * Math.PI) / 180;
      const [ex, ey] = toScreen(vp, far * Math.cos(a), far * Math.sin(a));
      ctx.moveTo(ox, oy);
      ctx.lineTo(ex, ey);
    }
    ctx.stroke();
  }

  drawAxes(ctx, vp, colors);
  ctx.restore();
}

export function drawPolarLabels(ctx, vp, colors, angleMode = 'rad') {
  const { xMin, xMax } = worldBounds(vp);
  const [ox, oy] = toScreen(vp, 0, 0);
  const step = niceStep(MIN_MAJOR_PX / Math.min(vp.scaleX, vp.scaleY));
  ctx.save();

  // Radius labels along the positive x axis.
  ctx.fillStyle = colors.label;
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelY = Math.min(Math.max(oy + 5, 4), vp.height - 18);
  for (const r of ticks(Math.max(step, xMin), xMax, step)) {
    if (r <= 0) continue;
    label(ctx, formatTick(r, step), toScreen(vp, r, 0)[0], labelY, colors);
  }

  // Angle labels on a circle that fits in the view (if the origin is visible enough).
  const inset = 18;
  const ring = Math.min(ox - inset, vp.width - ox - inset, oy - inset, vp.height - oy - inset);
  if (ring > 60) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let deg = 0; deg < 360; deg += 30) {
      const a = (deg * Math.PI) / 180;
      const text = angleMode === 'deg' ? `${deg}°` : PI_LABELS[deg];
      label(ctx, text, ox + ring * Math.cos(a), oy - ring * Math.sin(a), colors);
    }
  } else {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    if (ox >= 0 && ox <= vp.width && oy >= 0 && oy <= vp.height) label(ctx, '0', ox - 5, oy + 5, colors);
  }
  ctx.restore();
}
