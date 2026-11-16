// Reading numbers typed or imported as data, with either decimal separator (D25).
// Pure module – no DOM access.
//
//   parseNumber('3,14')            -> 3.14     (auto: a single comma is a decimal comma)
//   parseNumber('1.234,5')         -> 1234.5   (both: the last one is the decimal separator)
//   parseNumber('1,234,567')       -> 1234567  (repeated: thousands separators)
//   parseNumber('1 234,5')         -> 1234.5   (spaces, no-break spaces and ' group digits)
//   parseNumber('1,234', 'point')  -> 1234     (a fixed decimal separator, as in a CSV file)
//   parseNumber('')                -> null     (blank)
//   parseNumber('n/a')             -> NaN      (not a number)
//
// decimal: 'auto' (decide per cell), 'point' or 'comma'.

const PLAIN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const GROUPED = /^\d{1,3}(?:,\d{3})+$/; // integer part with thousands separators, after normalising to ','

// Spaces, no-break spaces, narrow no-break spaces and apostrophes between groups of digits.
const GROUP_SPACE = /(\d)[    '’](?=\d{3}(?:\D|$))/g;

export function parseNumber(text, decimal = 'auto') {
  if (text === null || text === undefined) return null;
  let s = String(text).trim();
  if (!s) return null;
  s = s.replace(/[−–]/g, '-').replace(GROUP_SPACE, '$1');
  let sign = '';
  if (s[0] === '+' || s[0] === '-') {
    sign = s[0] === '-' ? '-' : '';
    s = s.slice(1).trimStart();
  }
  // Split off an exponent so separators are only looked for in the mantissa.
  let exp = '';
  const e = s.search(/[eE][+-]?\d+$/);
  if (e > 0) {
    exp = s.slice(e);
    s = s.slice(0, e);
  }
  const dec = decimalOf(s, decimal);
  if (dec === null) return NaN;
  const thou = dec === '.' ? ',' : '.';
  let intPart = s;
  let frac = '';
  const k = s.lastIndexOf(dec);
  if (k >= 0) {
    intPart = s.slice(0, k);
    frac = s.slice(k + 1);
    if (frac.includes(thou) || frac.includes(dec)) return NaN;
  }
  if (intPart.includes(thou)) {
    const normal = thou === ',' ? intPart : intPart.replaceAll('.', ',');
    if (!GROUPED.test(normal)) return NaN;
    intPart = intPart.replaceAll(thou, '');
  }
  if (intPart.includes(dec)) return NaN;
  const canonical = `${sign}${intPart}${k >= 0 ? `.${frac}` : ''}${exp}`;
  if (!PLAIN.test(canonical)) return NaN;
  return Number(canonical);
}

// The decimal separator of one cell ('.' or ','), or null if it can't be read.
function decimalOf(s, mode) {
  if (mode === 'point') return '.';
  if (mode === 'comma') return ',';
  const commas = count(s, ',');
  const dots = count(s, '.');
  if (commas && dots) return s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
  if (commas > 1) return '.'; // 1,234,567
  if (dots > 1) return ','; // 1.234.567
  if (commas === 1) return ',';
  return '.';
}

function count(s, ch) {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

// How one cell votes on the decimal separator of a whole file:
// 'comma' or 'point' when it can only be read one way, 'either' for cells like 1,234 or
// 1.234 (a thousands group or a decimal), null when it has no separator or isn't a number.
export function separatorVote(text) {
  let s = String(text).trim().replace(/[−–]/g, '-').replace(GROUP_SPACE, '$1');
  s = s.replace(/^[+-]/, '').replace(/[eE][+-]?\d+$/, '');
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const commas = count(s, ',');
  const dots = count(s, '.');
  if (!commas && !dots) return null;
  if (commas && dots) return s.lastIndexOf(',') > s.lastIndexOf('.') ? 'comma' : 'point';
  if (commas > 1) return 'point';
  if (dots > 1) return 'comma';
  const sep = commas ? ',' : '.';
  const after = s.length - s.indexOf(sep) - 1;
  const before = s.indexOf(sep);
  // "1,234" could be one thousand two hundred and thirty-four or 1.234.
  if (after === 3 && before >= 1 && before <= 3 && s[0] !== '0') return 'either';
  return commas ? 'comma' : 'point';
}

// Shortest text that reads back as the same number, with the given decimal separator.
export function formatCell(value, decimal = 'point') {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  let s = String(value).replace('e+', 'e');
  if (decimal === 'comma') s = s.replace('.', ',');
  return s;
}
