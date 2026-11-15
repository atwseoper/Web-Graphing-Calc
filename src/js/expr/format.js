// Number formatting for display.

const SUPERSCRIPT = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const MINUS = '−';

function superscript(n) {
  return String(n).split('').map((c) => SUPERSCRIPT[c] ?? c).join('');
}

function stripZeros(s) {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

// Format a value with up to `sig` significant figures, using ×10ⁿ notation for very
// large or small magnitudes. Uses a proper minus sign.
export function formatNumber(v, sig = 10) {
  if (Number.isNaN(v)) return 'undefined';
  if (v === Infinity) return '∞';
  if (v === -Infinity) return `${MINUS}∞`;
  if (v === 0) return '0';
  const neg = v < 0;
  const a = Math.abs(v);
  let out;
  const rounded = Number(a.toPrecision(sig));
  if (rounded >= 1e10 || rounded < 1e-6) {
    const [mant, exp] = rounded.toExponential(sig - 1).split('e');
    out = `${stripZeros(mant)}×10${superscript(Number(exp))}`;
  } else {
    out = stripZeros(rounded.toPrecision(sig));
    if (out.includes('e')) out = String(rounded);
  }
  return (neg ? MINUS : '') + out;
}

// Format a coordinate to the precision implied by the pixel resolution
// (worldPerPx = how many world units one pixel covers).
export function formatCoordinate(v, worldPerPx) {
  if (!Number.isFinite(v)) return formatNumber(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e8 || a < 1e-5)) return formatNumber(v, 4);
  const decimals = Math.min(10, Math.max(0, Math.ceil(-Math.log10(worldPerPx))));
  const s = stripZeros(v.toFixed(decimals));
  if (s === '-0' || Number(s) === 0) return '0';
  return s.replace('-', MINUS);
}
