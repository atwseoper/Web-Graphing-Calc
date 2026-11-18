// Slider ranges and steps (D19, D39), shared by the slider in the list, its play button
// and draggable points (Phase 6a). Pure – no DOM access.
import { niceStep } from '../plot/viewport.js';

// The range and step of a slider with value `value`. min, max and step are the evaluated
// fields of the row (null when empty or invalid). Empty bounds give −10…10, widened to
// include the value; the automatic step is about 1/200 of the range.
export function sliderRange(value, { min = null, max = null, step = null } = {}) {
  const defLo = Math.min(-10, Math.floor(value));
  const defHi = Math.max(10, Math.ceil(value));
  let lo = min;
  let hi = max;
  if (lo === null) lo = Math.min(defLo, hi === null ? defLo : hi - 1);
  if (hi === null) hi = Math.max(defHi, lo + 1);
  if (!(hi > lo)) hi = lo + 1;
  const autoStep = niceStep((hi - lo) / 200);
  const userStepOk = step !== null && step > 0 && step <= hi - lo;
  return { lo, hi, step: userStepOk ? step : autoStep, autoStep, userStepOk, defLo, defHi };
}

// Decimal places needed to write v exactly (up to 12).
function decimalsOf(v) {
  for (let d = 0; d <= 12; d++) {
    const s = v * 10 ** d;
    if (Math.abs(s - Math.round(s)) < 1e-9 * Math.max(1, Math.abs(s))) return d;
  }
  return 12;
}

// v rounded to the nearest lo + k·step, without floating-point dust (0.1 + 0.2 → 0.3).
export function snapToStep(v, lo, step) {
  const snapped = lo + Math.round((v - lo) / step) * step;
  const d = Math.max(decimalsOf(step), decimalsOf(lo));
  return Number(snapped.toFixed(d));
}

// A slider value as row text: plain decimals, never exponent notation ("1e-7" would read
// as 1·e − 7).
// Values are kept below 1e15, where toFixed is still plain.
export const MAX_SLIDER_VALUE = 1e15;
export function valueText(v) {
  if (!Number.isFinite(v) || v === 0) return '0';
  const c = Math.max(-MAX_SLIDER_VALUE, Math.min(MAX_SLIDER_VALUE, v));
  const s = c.toFixed(decimalsOf(c)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
