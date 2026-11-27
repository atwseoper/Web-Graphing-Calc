// Turns expression text into tokens.
//
// Token types: 'num', 'name', 'op', 'eof'. Operators: + - * / ^ ( ) , = ! and, for
// conditions and derivatives, { } : < > <= >= and ' (prime); for lists (Phase 9a)
// [ ] and ... (also typed …), and . for a data set's columns (D_1.x).
// Naming rules (documented in docs/DESIGN.md):
//  - Known multi-letter words (function names, pi, theta, ans) are recognised
//    case-insensitively, longest match first: "sinx" -> sin x, "pix" -> π x.
//  - Any other letters are single-letter names: "xy" -> x y, "ab" -> a b.
//  - A letter may take a subscript with underscore: a_1, k_max.
//  - Unicode maths symbols are accepted: × · ÷ − √ ∛ π θ ² ³ ≤ ≥ Σ Π ′.
import { ExprError } from './errors.js';
import { WORDS } from './builtins.js';

const SINGLE_OPS = new Set(['+', '-', '*', '/', '^', '(', ')', ',', '=', '!', '{', '}', ':', '<', '>', "'", '[', ']']);
const UNICODE_OPS = {
  '×': '*', '·': '*', '⋅': '*', '∙': '*', '÷': '/', '−': '-', '–': '-', '—': '-',
  '≤': '<=', '≥': '>=', '′': "'", '’': "'",
};
const UNICODE_NAMES = {
  'π': 'π', 'θ': 'θ', '√': 'sqrt', '∛': 'cbrt', 'Θ': 'θ', 'Σ': 'sum', '∑': 'sum', 'Π': 'prod', '∏': 'prod',
};
const SUPERSCRIPTS = { '²': '2', '³': '3' };

const WORD_LIST = Object.keys(WORDS).sort((a, b) => b.length - a.length);

function isDigit(c) {
  return c >= '0' && c <= '9';
}
function isLetter(c) {
  return /\p{L}/u.test(c);
}

export function tokenize(src) {
  const tokens = [];
  let i = 0;
  const push = (type, value, start, end) => tokens.push({ type, value, start, end });

  while (i < src.length) {
    const c = src[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ' ') {
      i++;
      continue;
    }

    // A data set's column, D_1.x (Phase 9a-2): a dot straight after a name, before a letter.
    if (c === '.' && tokens.length && tokens[tokens.length - 1].type === 'name' && tokens[tokens.length - 1].end === i && isLetter(src[i + 1] ?? '')) {
      push('op', '.', i, i + 1);
      i++;
      continue;
    }

    // Ranges [1...10]: three dots (or the ellipsis character).
    if (c === '…' || (c === '.' && src[i + 1] === '.' && src[i + 2] === '.')) {
      const n = c === '…' ? 1 : 3;
      push('op', '...', i, i + n);
      i += n;
      continue;
    }
    if (c === '.' && src[i + 1] === '.') throw new ExprError('A range needs three dots, e.g. [1...10]', i, i + 2);

    // Numbers: 12, 1.5, .5, 1e-3 (exponent only when digits follow the e). A dot
    // followed by another dot starts a range (1...10), not a decimal point.
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      const start = i;
      while (isDigit(src[i] ?? '')) i++;
      if (src[i] === '.' && src[i + 1] !== '.') {
        i++;
        while (isDigit(src[i] ?? '')) i++;
      }
      if ((src[i] === 'e' || src[i] === 'E')) {
        let j = i + 1;
        if (src[j] === '+' || src[j] === '-') j++;
        if (isDigit(src[j] ?? '')) {
          i = j;
          while (isDigit(src[i] ?? '')) i++;
        }
      }
      if (src[i] === '.' && src[i + 1] !== '.') throw new ExprError('A number can only have one decimal point', i, i + 1);
      push('num', Number(src.slice(start, i)), start, i);
      continue;
    }

    if (c === '*' && src[i + 1] === '*') {
      push('op', '^', i, i + 2);
      i += 2;
      continue;
    }
    if ((c === '<' || c === '>') && src[i + 1] === '=') {
      push('op', `${c}=`, i, i + 2);
      i += 2;
      continue;
    }
    if (SINGLE_OPS.has(c)) {
      push('op', c, i, i + 1);
      i++;
      continue;
    }
    if (UNICODE_OPS[c]) {
      push('op', UNICODE_OPS[c], i, i + 1);
      i++;
      continue;
    }
    if (SUPERSCRIPTS[c]) {
      push('op', '^', i, i + 1);
      push('num', Number(SUPERSCRIPTS[c]), i, i + 1);
      i++;
      continue;
    }
    if (UNICODE_NAMES[c]) {
      push('name', UNICODE_NAMES[c], i, i + 1);
      i++;
      continue;
    }

    if (isLetter(c)) {
      const rest = src.slice(i).toLowerCase();
      const word = WORD_LIST.find((w) => rest.startsWith(w));
      if (word) {
        push('name', WORDS[word], i, i + word.length);
        i += word.length;
        continue;
      }
      const start = i;
      i++;
      // Optional subscript: a_1, k_max
      if (src[i] === '_' && /[\p{L}\d]/u.test(src[i + 1] ?? '')) {
        i++;
        while (/[\p{L}\d]/u.test(src[i] ?? '')) i++;
      }
      push('name', src.slice(start, i), start, i);
      continue;
    }

    throw new ExprError(`Unexpected character '${c}'`, i, i + 1);
  }
  push('eof', null, src.length, src.length);
  return tokens;
}
