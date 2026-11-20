// Share links and project files. Pure module – no DOM access (uses the standard
// CompressionStream / btoa globals, which browsers and Node both provide).
//
// A share link carries the whole project – rows, view, angle, grid and axis types, Solve inputs,
// data sets and fits – as compressed JSON in the URL fragment:
//   …/graphcalc.html#g=z<base64url(deflate-raw(json))>
// The fragment never reaches a server. Browsers without CompressionStream write
// `#g=j<base64url(json)>` instead, and every browser can read both.
import { serialize, deserialize } from './persist.js';
import { parse, isDyDx } from '../expr/parser.js';
import { referencedNames } from '../expr/compile.js';

export const SHARE_PARAM = 'g';
export const MAX_LINK_CHARS = 8000; // longer links are unreliable in chat apps and some browsers
export const PROJECT_APP = 'web-graphing-calc';

// The part of the state a link or project file carries.
function projectObject(state) {
  const o = JSON.parse(serialize(state));
  delete o.calc; // the Calc history is personal scratch work
  const {
    angle, grid, xAxis, yAxis, quartiles,
  } = o.settings;
  o.settings = {
    angle, grid, xAxis, yAxis, quartiles,
  };
  return o;
}

export function projectJson(state, { pretty = false } = {}) {
  const o = { app: PROJECT_APP, ...projectObject(state) };
  return pretty ? JSON.stringify(o, null, 1) : JSON.stringify(o);
}

// Combine an opened project with the current state: everything comes from the project
// except the user's own preferences (keypad) and their Calc history.
// Returns { state } or { error }.
export function openProject(current, json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: 'This file isn’t a graph project (it isn’t valid JSON).' };
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rows)) {
    return { error: 'This file isn’t a graph project.' };
  }
  if (raw.version !== current.version) {
    return {
      error: raw.version > current.version
        ? 'This project was saved by a newer version of the calculator.'
        : 'This project was saved in a format this version can’t read.',
    };
  }
  const p = deserialize(json);
  return {
    state: {
      ...p,
      nextId: Math.max(p.nextId, current.nextId),
      settings: {
        ...current.settings,
        angle: p.settings.angle,
        grid: p.settings.grid,
        xAxis: p.settings.xAxis,
        yAxis: p.settings.yAxis,
        quartiles: p.settings.quartiles,
      },
      calc: current.calc,
      ui: { ...current.ui, tab: p.ui.tab },
    },
  };
}

// ---- summary for the "Open a shared project?" dialog (D47) ---------------------------------
// Counts only – never text from the project, which comes from someone else. Rows are
// classified by parsing alone (no evaluation), so a hostile link can't stall the page
// before the user has agreed to open it.

const CURVE_LETTERS = new Set(['y', 'x', 'r']);

function rowKind(text) {
  if (!text.trim()) return null;
  let ast;
  try {
    ast = parse(text, { graph: true });
  } catch {
    return 'other';
  }
  const uses = (node, letters) => [...referencedNames(node).names].some((n) => letters.includes(n));
  if (ast.type === 'ineq') return 'graph';
  if (ast.type === 'eq') {
    const { lhs } = ast;
    if (lhs.type === 'yprime' || isDyDx(lhs)) return 'graph'; // slope field
    if (lhs.type === 'sym' && !lhs.parens) return CURVE_LETTERS.has(lhs.name) ? 'graph' : 'other'; // y = …, or a variable
    if (lhs.type === 'apply') return lhs.args.length === 1 && lhs.args[0].type === 'sym' && lhs.args[0].name === 'x' ? 'graph' : 'other';
    return 'graph'; // implicit curve
  }
  const e = ast.expr;
  if (e.type === 'tuple' && e.items.length === 2) return uses(e, ['t']) ? 'graph' : 'point';
  return uses(e, ['x', 'θ']) ? 'graph' : 'other';
}

const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function listText(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// e.g. "4 graphs, 1 point, 1 data set with 2 fits and Solve inputs". Takes a state from
// openProject.
export function projectSummary(state) {
  const n = { graph: 0, point: 0, other: 0 };
  for (const row of state.rows) {
    const k = rowKind(String(row.text || ''));
    if (k) n[k]++;
  }
  const parts = [];
  if (n.graph) parts.push(count(n.graph, 'graph'));
  if (n.point) parts.push(count(n.point, 'point'));
  if (n.other) parts.push(count(n.other, parts.length ? 'other row' : 'row'));
  const sets = state.data ? state.data.sets : [];
  if (sets.length) {
    const fits = sets.reduce((t, s) => t + s.fits.length, 0);
    parts.push(count(sets.length, 'data set') + (fits ? ` with ${count(fits, 'fit')}` : ''));
  }
  const sv = state.solve || {};
  const solveUsed = [sv.equation, sv.polynomial, ...(sv.system || []), ...Object.values(sv.given || {})]
    .some((v) => typeof v === 'string' && v.trim());
  if (solveUsed) parts.push(parts.length ? 'Solve inputs' : 'Solve inputs only');
  return parts.length ? listText(parts) : 'nothing (an empty project)';
}

// ---- base64url ----------------------------------------------------------------------------
export function bytesToBase64url(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlToBytes(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('bad base64url');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- compression ---------------------------------------------------------------------------
export const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const MAX_INFLATED = 20 * 1024 * 1024; // refuse anything absurd (a "zip bomb" link)

async function inflate(bytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_INFLATED) {
      reader.cancel();
      throw new Error('too large');
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// The fragment value (after "#g=") for a project's JSON.
export async function encodeShare(json, { compress = canCompress() } = {}) {
  const bytes = new TextEncoder().encode(json);
  if (compress) return `z${bytesToBase64url(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
  return `j${bytesToBase64url(bytes)}`;
}

// Back to JSON text; throws on a damaged link.
export async function decodeShare(value) {
  const kind = value[0];
  const bytes = base64urlToBytes(value.slice(1));
  if (kind === 'z') {
    if (!canCompress()) throw new Error('This browser can’t open compressed links.');
    return new TextDecoder('utf-8', { fatal: true }).decode(await inflate(bytes));
  }
  if (kind === 'j') return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  throw new Error('unknown link format');
}

// The share value in a URL hash ("#g=…"), or null.
export function shareValueFromHash(hash) {
  const m = /^#?(?:.*&)?g=([A-Za-z0-9_-]+)/.exec(hash || '');
  return m ? m[1] : null;
}

// Build the full link. Returns { url, length, tooLong }.
export async function shareLink(state, baseUrl, options) {
  const value = await encodeShare(projectJson(state), options);
  const url = `${baseUrl.split('#')[0]}#${SHARE_PARAM}=${value}`;
  return { url, length: url.length, tooLong: url.length > MAX_LINK_CHARS };
}
