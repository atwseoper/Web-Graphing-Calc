// CSV and pasted spreadsheet data. Pure module – no DOM access.
//
// parseCsv(text, options) reads delimited text into a table:
//   - quoted fields ("a, b", "say ""hi""", line breaks inside quotes), BOM, CRLF / CR
//   - delimiter detection: comma, semicolon, tab, | or runs of spaces
//   - decimal separator detection: point or comma (D25), with thousands separators
//   - header row detection, '#' / '%' comment lines, a preamble of lines that don't
//     match the table (e.g. "Exported on …"), blank lines
// options: { delimiter: 'auto'|','|';'|'\t'|'|'|' ', decimal: 'auto'|'point'|'comma',
//            header: 'auto'|true|false }
//
// toPoints(table, { x, y, s }) picks the columns for a data set (x = -1 for row numbers)
// and lists every cell that isn't a number (D28).
import { parseNumber, separatorVote } from './number.js';

export const DELIMITERS = [
  [',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab'], ['|', 'Bar'], [' ', 'Spaces'],
];
export const MAX_POINTS = 100000;
const SAMPLE_LINES = 60;
const COMMENT = /^\s*[#%]/;

// Split text into records of fields. ' ' as the delimiter means runs of spaces/tabs.
export function splitRecords(text, delimiter, limit = Infinity) {
  const records = [];
  const ws = delimiter === ' ';
  let i = 0;
  let line = 1;
  const n = text.length;
  while (i < n && records.length < limit) {
    const startLine = line;
    const fields = [];
    let field = '';
    let quoted = false;
    let atFieldStart = true;
    if (ws) while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
    for (;;) {
      if (i >= n) {
        fields.push({ text: field, quoted });
        break;
      }
      const c = text[i];
      if (atFieldStart && (c === ' ' || (c === '\t' && delimiter !== '\t'))) {
        i++; // spaces before a field (and before an opening quote)
        continue;
      }
      if (atFieldStart && c === '"') {
        // Quoted field: up to the closing quote, with "" for a quote inside.
        quoted = true;
        atFieldStart = false;
        i++;
        while (i < n) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              field += '"';
              i += 2;
              continue;
            }
            i++;
            break;
          }
          if (text[i] === '\n') line++;
          field += text[i++];
        }
        continue;
      }
      if (c === '\r' || c === '\n') {
        fields.push({ text: field, quoted });
        i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
        line++;
        break;
      }
      if (ws ? c === ' ' || c === '\t' : c === delimiter) {
        fields.push({ text: field, quoted });
        field = '';
        quoted = false;
        atFieldStart = true;
        i++;
        if (ws) {
          while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
          if (i >= n || text[i] === '\r' || text[i] === '\n') {
            // Trailing spaces: not another field.
            if (i < n) {
              i += text[i] === '\r' && text[i + 1] === '\n' ? 2 : 1;
              line++;
            }
            break;
          }
        }
        continue;
      }
      i++;
      if (quoted && (c === ' ' || c === '\t')) continue; // spaces after a closing quote
      atFieldStart = false;
      field += c;
    }
    records.push({ line: startLine, fields: fields.map((f) => (f.quoted ? f.text : f.text.trim())) });
  }
  return records;
}

const isBlank = (rec) => rec.fields.every((f) => f === '');
const isComment = (rec) => COMMENT.test(rec.fields[0] || '');

// Text from a file's bytes: UTF-8, or UTF-16 with a byte-order mark (Excel's "Unicode
// text"), falling back to Windows-1252 for older European exports that aren't UTF-8.
export function decodeBytes(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// The most common field count among records and how many records have it.
function modeCount(records) {
  const counts = new Map();
  for (const r of records) counts.set(r.fields.length, (counts.get(r.fields.length) || 0) + 1);
  let best = 0;
  let bestN = 0;
  for (const [k, v] of counts) if (v > bestN || (v === bestN && k > best)) { best = k; bestN = v; }
  return { count: best, share: records.length ? bestN / records.length : 0 };
}

function contentRecords(text, delimiter, limit) {
  return splitRecords(text, delimiter, limit).filter((r) => !isBlank(r) && !isComment(r));
}

// Score each delimiter on the first lines: a consistent number of fields (more than
// one), and fields that read as numbers.
export function detectDelimiter(text) {
  let best = { delimiter: ',', score: -1 };
  for (const [d] of DELIMITERS) {
    const recs = contentRecords(text, d, SAMPLE_LINES);
    if (!recs.length) continue;
    const { count, share } = modeCount(recs);
    if (count < 2) continue;
    let cells = 0;
    let numeric = 0;
    for (const r of recs) {
      if (r.fields.length !== count) continue;
      for (const f of r.fields) {
        if (f === '') continue;
        cells++;
        if (!Number.isNaN(parseNumber(f))) numeric++;
      }
    }
    const score = share * (0.4 + 0.6 * (cells ? numeric / cells : 0)) + (d === ' ' ? -0.01 : 0);
    if (score > best.score + 1e-9) best = { delimiter: d, score };
  }
  return best.score < 0 ? null : best.delimiter;
}

// Votes from every cell: cells like 3,14 say comma, 3.14 say point. Cells such as 1,234
// could be either; they lean towards comma when the file uses semicolons (as European
// spreadsheet exports do).
export function detectDecimal(cells, delimiter) {
  let comma = 0;
  let point = 0;
  let either = 0;
  let eitherComma = 0;
  for (const c of cells) {
    const v = separatorVote(c);
    if (v === 'comma') comma++;
    else if (v === 'point') point++;
    else if (v === 'either') {
      either++;
      if (c.includes(',')) eitherComma++;
    }
  }
  if (comma > point) return 'comma';
  if (point > comma) return 'point';
  if (either && delimiter === ';' && eitherComma === either) return 'comma';
  return 'point';
}

const letters = (k) => {
  let s = '';
  for (let n = k + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export const columnLetter = letters;

export function parseCsv(input, options = {}) {
  const text = stripBom(String(input || ''));
  const notes = [];
  let delimiter = options.delimiter && options.delimiter !== 'auto' ? options.delimiter : detectDelimiter(text);
  const autoDelimiter = !options.delimiter || options.delimiter === 'auto';
  if (delimiter === null) delimiter = text.includes('\t') ? '\t' : text.includes(';') ? ';' : ',';

  const all = splitRecords(text, delimiter);
  let comments = 0;
  let blank = 0;
  const recs = [];
  for (const r of all) {
    if (isBlank(r)) { blank++; continue; }
    if (isComment(r)) { comments++; continue; }
    recs.push(r);
  }
  if (!recs.length) {
    return { delimiter, autoDelimiter, decimal: 'point', header: false, columns: [], rows: [], skipped: { comments, blank, preamble: 0 }, notes: ['No data found'] };
  }

  const { count } = modeCount(recs);
  const width = Math.max(1, count);
  // A preamble: leading lines with a different number of fields from the table.
  let start = 0;
  if (width > 1) {
    while (start < recs.length - 1 && recs[start].fields.length !== width && start < 20) start++;
  }
  const body = recs.slice(start);

  const decimal = options.decimal && options.decimal !== 'auto'
    ? options.decimal
    : detectDecimal(body.slice(0, 400).flatMap((r) => r.fields), delimiter);

  const num = (f) => parseNumber(f, decimal);
  // Header: the first record has a non-empty cell that isn't a number, and the next one
  // has fewer of them.
  const nonNumeric = (r) => r.fields.filter((f) => f !== '' && Number.isNaN(num(f))).length;
  let header = false;
  if (options.header === true || options.header === false) header = options.header;
  else if (body.length > 1) header = nonNumeric(body[0]) > 0 && nonNumeric(body[0]) > nonNumeric(body[1]);

  const ncols = Math.max(width, ...body.map((r) => r.fields.length).slice(0, 2000));
  const names = [];
  for (let k = 0; k < ncols; k++) {
    const h = header ? (body[0].fields[k] || '').trim() : '';
    names.push(h || `Column ${letters(k)}`);
  }
  const dataRecs = header ? body.slice(1) : body;
  const rows = dataRecs.map((r) => ({ line: r.line, cells: r.fields, values: r.fields.map(num) }));

  if (start) notes.push(`Skipped ${start} line${start === 1 ? '' : 's'} before the table`);
  return {
    delimiter, autoDelimiter, decimal, header, columns: names, rows,
    skipped: { comments, blank, preamble: start }, notes,
  };
}

// Which columns are mostly numbers, and sensible defaults for x, y and σy.
export function columnStats(table) {
  return table.columns.map((name, k) => {
    let numbers = 0;
    let bad = 0;
    let empty = 0;
    for (const r of table.rows) {
      const v = r.values[k];
      if (v === null || v === undefined) empty++;
      else if (Number.isNaN(v)) bad++;
      else numbers++;
    }
    return { index: k, name, numbers, bad, empty };
  });
}

const SIGMA_NAME = /σ|sigma|\berr|error|uncert|\bunc\b|\bsd\b|std|stdev|±|^d[a-z]$|^δ|delta|fehler|unsicher|erreur|errore|incert|fout|onzeker/i;

export function defaultColumns(table) {
  const stats = columnStats(table);
  const numeric = stats.filter((c) => c.numbers > 0 && c.numbers >= c.bad).map((c) => c.index);
  if (numeric.length === 0) return { x: -1, y: table.columns.length ? 0 : -1, s: -1 };
  if (numeric.length === 1) return { x: -1, y: numeric[0], s: -1 };
  const [x, y, third] = numeric;
  const s = third !== undefined && SIGMA_NAME.test(table.columns[third]) ? third : -1;
  return { x, y, s };
}

// A data set's points from chosen columns. x = -1 numbers the rows 1, 2, 3, …; s = -1
// means no σy column. Cells that aren't numbers become blanks (null) and are listed in
// problems; rows that are blank in every chosen column are skipped.
export function toPoints(table, { x, y, s = -1 }) {
  const points = [];
  const problems = [];
  let truncated = false;
  const cols = [['x', x], ['y', y], ['σy', s]].filter(([, k]) => k >= 0);
  for (const r of table.rows) {
    const read = (k) => {
      if (k < 0) return null;
      const v = r.values[k];
      return v === undefined ? null : v;
    };
    const vals = cols.map(([, k]) => read(k));
    if (vals.every((v) => v === null)) continue;
    if (points.length >= MAX_POINTS) {
      truncated = true;
      break;
    }
    for (let j = 0; j < cols.length; j++) {
      if (Number.isNaN(vals[j])) {
        problems.push({ line: r.line, point: points.length + 1, column: table.columns[cols[j][1]], text: r.cells[cols[j][1]] });
      }
    }
    const clean = (v) => (v === null || Number.isNaN(v) ? null : v);
    const px = x < 0 ? points.length + 1 : clean(read(x));
    const sy = s < 0 ? null : clean(read(s));
    if (sy !== null && !(sy > 0)) {
      problems.push({ line: r.line, point: points.length + 1, column: table.columns[s], text: r.cells[s], reason: 'σy must be greater than 0' });
    }
    points.push({ x: px, y: clean(read(y)), s: sy !== null && sy > 0 ? sy : null, off: false });
  }
  return { points, problems, truncated };
}
