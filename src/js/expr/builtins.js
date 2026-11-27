// Built-in functions and constants.
import {
  gamma, nCr, nPr, mod, sinExact, cosExact, tanExact, sinDeg, cosDeg, tanDeg,
} from '../numerics/special.js';
import { DISTRIBUTION_FUNCTIONS } from '../numerics/distributions.js';
import {
  listLength, listSum, listProd, listMean, listMedian, listStdev, listStdevp,
} from '../numerics/listfns.js';

const R2D = 180 / Math.PI;

// Each entry: arity as [min, max] (max Infinity = variadic), and an implementation
// for radian mode and (optionally) degree mode.
function trig(radFn, degFn) {
  return { arity: [1, 1], rad: radFn, deg: degFn };
}
function inverseTrig(fn) {
  return { arity: [1, 1], rad: fn, deg: (x) => fn(x) * R2D };
}
function plain(arity, fn) {
  return { arity, rad: fn, deg: fn };
}

export const FUNCTIONS = {
  sin: trig(sinExact, sinDeg),
  cos: trig(cosExact, cosDeg),
  tan: trig(tanExact, tanDeg),
  sec: trig((x) => 1 / cosExact(x), (x) => 1 / cosDeg(x)),
  csc: trig((x) => 1 / sinExact(x), (x) => 1 / sinDeg(x)),
  cot: trig((x) => 1 / tanExact(x), (x) => 1 / tanDeg(x)),
  asin: inverseTrig(Math.asin),
  acos: inverseTrig(Math.acos),
  atan: inverseTrig(Math.atan),
  sinh: plain([1, 1], Math.sinh),
  cosh: plain([1, 1], Math.cosh),
  tanh: plain([1, 1], Math.tanh),
  asinh: plain([1, 1], Math.asinh),
  acosh: plain([1, 1], Math.acosh),
  atanh: plain([1, 1], Math.atanh),
  exp: plain([1, 1], Math.exp),
  ln: plain([1, 1], Math.log),
  log: plain([1, 2], (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b))),
  sqrt: plain([1, 1], Math.sqrt),
  cbrt: plain([1, 1], Math.cbrt),
  abs: plain([1, 1], Math.abs),
  floor: plain([1, 1], Math.floor),
  ceil: plain([1, 1], Math.ceil),
  round: plain([1, 2], (x, n) => {
    if (n === undefined) return Math.round(x);
    const f = 10 ** Math.round(n);
    return Math.round(x * f) / f;
  }),
  sign: plain([1, 1], Math.sign),
  min: plain([1, Infinity], Math.min),
  max: plain([1, Infinity], Math.max),
  mod: plain([2, 2], mod),
  gamma: plain([1, 1], gamma),
  ncr: plain([2, 2], nCr),
  npr: plain([2, 2], nPr),
  // Probability distributions (Phase 7b): reserved words like sum.
  ...Object.fromEntries(Object.entries(DISTRIBUTION_FUNCTIONS).map(([name, d]) => [name, plain(d.arity, d.fn)])),
  // Functions of a list (Phase 9a). They are typed with one list, length(L); the list
  // code (lists.js) passes its elements on as separate arguments. sum(L) and prod(L)
  // are the one-argument forms of Σ and Π.
  length: plain([0, Infinity], listLength),
  mean: plain([0, Infinity], listMean),
  median: plain([0, Infinity], listMedian),
  stdev: plain([0, Infinity], listStdev),
  stdevp: plain([0, Infinity], listStdevp),
  sum: plain([0, Infinity], listSum),
  prod: plain([0, Infinity], listProd),
};

// Functions that take a whole list and give one number (Phase 9a). min and max do too
// when given a single list.
export const LIST_FUNCTIONS = new Set(['length', 'mean', 'median', 'stdev', 'stdevp', 'sum', 'prod']);

// Alternative spellings accepted when typing.
export const ALIASES = {
  arcsin: 'asin', arccos: 'acos', arctan: 'atan',
  arsinh: 'asinh', arcosh: 'acosh', artanh: 'atanh',
  sgn: 'sign', ncr: 'ncr', npr: 'npr',
  'χ2pdf': 'chi2pdf', 'χ2cdf': 'chi2cdf',
};

export const CONSTANTS = {
  'π': Math.PI,
  e: Math.E,
};

// Multi-letter words recognised by the tokenizer (case-insensitive), mapped to their
// canonical token names. Everything else is split into single-letter names.
export const WORDS = (() => {
  const words = {};
  for (const name of Object.keys(FUNCTIONS)) words[name] = name;
  for (const [alias, name] of Object.entries(ALIASES)) words[alias] = name;
  words.sum = 'sum';
  words.prod = 'prod';
  words.pi = 'π';
  words.theta = 'θ';
  words.ans = 'Ans';
  return words;
})();

// Functions whose ^-1 means the inverse function (sin^-1 x = asin x).
export const INVERSE_OF = {
  sin: 'asin', cos: 'acos', tan: 'atan', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh',
};

// Σ and Π: sum(expr, k, from, to), prod(expr, k, from, to).
export const SERIES = new Set(['sum', 'prod']);

export function isFunctionName(name) {
  return Object.prototype.hasOwnProperty.call(FUNCTIONS, name);
}

export function isConstantName(name) {
  return Object.prototype.hasOwnProperty.call(CONSTANTS, name);
}

