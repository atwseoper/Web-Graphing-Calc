// Canvas drawing of sampled curves, points and the trace marker.

const LIMIT = 20000; // clamp screen coordinates so the canvas never sees huge values

function clamp(v) {
  return v < -LIMIT ? -LIMIT : v > LIMIT ? LIMIT : v;
}

export function drawLines(ctx, lines, color, width = 2.5) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const { x, y } of lines) {
    if (x.length === 1) {
      ctx.moveTo(clamp(x[0]), clamp(y[0]));
      ctx.lineTo(clamp(x[0]) + 0.01, clamp(y[0]));
      continue;
    }
    ctx.moveTo(clamp(x[0]), clamp(y[0]));
    for (let i = 1; i < x.length; i++) ctx.lineTo(clamp(x[i]), clamp(y[i]));
  }
  ctx.stroke();
  ctx.restore();
}

export function drawPoint(ctx, sx, sy, color, radius = 5) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(sx, sy, radius, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}

// Trace marker: a ringed dot plus a rounded label with the coordinates.
export function drawMarker(ctx, sx, sy, color, text, colors, viewWidth, viewHeight) {
  ctx.save();
  ctx.fillStyle = colors.bg;
  ctx.beginPath();
  ctx.arc(sx, sy, 7, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(sx, sy, 5, 0, 2 * Math.PI);
  ctx.fill();

  if (text) {
    ctx.font = '600 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const padX = 8;
    const h = 26;
    const w = ctx.measureText(text).width + padX * 2;
    // Prefer above-right of the point; flip to stay on screen.
    let lx = sx + 10;
    let ly = sy - h - 10;
    if (lx + w > viewWidth - 4) lx = sx - w - 10;
    if (lx < 4) lx = 4;
    if (ly < 4) ly = sy + 10;
    if (ly + h > viewHeight - 4) ly = viewHeight - h - 4;
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = colors.chipBg;
    roundRect(ctx, lx, ly, w, h, 8);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = colors.chipText;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + padX, ly + h / 2 + 0.5);
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
