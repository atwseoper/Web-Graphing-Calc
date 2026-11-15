import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../src/js/expr/tokenizer.js';
import { parse } from '../src/js/expr/parser.js';
import { analyse } from '../src/js/expr/model.js';
import { formatNumber, formatCoordinate } from '../src/js/expr/format.js';
import { gamma, realPow, mod, nCr } from '../src/js/numerics/special.js';

const close = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// Evaluate a constant expression (one row) and return its value.
function val(text, angle = 'rad') {
  const r = analyse([{ text }], { angle }).rows[0];
  assert.equal(r.kind, 'value', `${text} -> ${JSON.stringify(r.error || r.kind)}`);
  return r.value;
}
// Evaluate y = f(x) at a point.
function fx(text, x, angle = 'rad') {
  const r = analyse([{ text }], { angle }).rows[0];
  assert.ok(r.f, `${text} -> ${JSON.stringify(r.error || r.kind)}`);
  return r.f(x);
}
function err(text) {
  const r = analyse([{ text }]).rows[0];
  assert.equal(r.kind, 'error', `${text} should be an error, got ${r.kind}`);
  return r.error.message;
}

// Render an AST back to a fully bracketed string, to check parse structure.
function show(node) {
  switch (node.type) {
    case 'num': return String(node.value);
    case 'sym': return node.name;
    case 'neg': return `(-${show(node.arg)})`;
    case 'bin': return `(${show(node.left)}${node.op}${show(node.right)})`;
    case 'fact': return `(${show(node.arg)}!)`;
    case 'call':
    case 'apply': return `${node.name}[${node.args.map(show).join(',')}]`;
    case 'tuple': return `<${node.items.map(show).join(',')}>`;
    default: return '?';
  }
}
const p = (s) => {
  const r = parse(s);
  return r.type === 'eq' ? `${show(r.lhs)}=${show(r.rhs)}` : show(r.expr);
};

test('tokenizer: numbers, words, single letters, unicode', () => {
  const t = (s) => tokenize(s).filter((k) => k.type !== 'eof').map((k) => k.value);
  assert.deepEqual(t('2.5e3x'), [2500, 'x']);
  assert.deepEqual(t('2e^x'), [2, 'e', '^', 'x']);
  assert.deepEqual(t('sinx'), ['sin', 'x']);
  assert.deepEqual(t('pix'), ['π', 'x']);
  assert.deepEqual(t('xy'), ['x', 'y']);
  assert.deepEqual(t('Sin(theta)'), ['sin', '(', 'θ', ')']);
  assert.deepEqual(t('a_1 k_max'), ['a_1', 'k_max']);
  assert.deepEqual(t('3×4÷2−1'), [3, '*', 4, '/', 2, '-', 1]);
  assert.deepEqual(t('x²'), ['x', '^', 2]);
  assert.deepEqual(t('√x'), ['sqrt', 'x']);
  assert.deepEqual(t('2**3'), [2, '^', 3]);
  assert.deepEqual(t('arcsin'), ['asin']);
  assert.throws(() => tokenize('1.2.3'), /decimal point/);
  assert.throws(() => tokenize('2 $ 3'), /Unexpected character/);
});

test('parser: precedence and associativity', () => {
  assert.equal(p('1+2*3'), '(1+(2*3))');
  assert.equal(p('-x^2'), '(-(x^2))');
  assert.equal(p('2^3^2'), '(2^(3^2))');
  assert.equal(p('2^-3'), '(2^(-3))');
  assert.equal(p('1/2x'), '((1/2)*x)');
  assert.equal(p('2x^2'), '(2*(x^2))');
  assert.equal(p('-3!'), '(-(3!))');
  assert.equal(p('a-b-c'), '((a-b)-c)');
});

test('parser: implicit multiplication', () => {
  assert.equal(p('2x'), '(2*x)');
  assert.equal(p('xy'), '(x*y)');
  assert.equal(p('2(x+1)'), '(2*(x+1))');
  assert.equal(p('(x+1)(x-1)'), '((x+1)*(x-1))');
  assert.equal(p('2pi r'), '((2*π)*r)');
  assert.equal(p('x(x+1)'), 'x[(x+1)]');
  assert.throws(() => parse('x2'), /Missing operator before '2'/);
  assert.throws(() => parse('2 3'), /Missing operator/);
});

test('parser: function arguments without brackets', () => {
  assert.equal(p('sin x'), 'sin[x]');
  assert.equal(p('sin 2x'), 'sin[(2*x)]');
  assert.equal(p('sin x^2'), 'sin[(x^2)]');
  assert.equal(p('sin x cos x'), '(sin[x]*cos[x])');
  assert.equal(p('sin x + 1'), '(sin[x]+1)');
  assert.equal(p('2sin x'), '(2*sin[x])');
  assert.equal(p('sin^2 x'), '(sin[x]^2)');
  assert.equal(p('sin^2(x)'), '(sin[x]^2)');
  assert.equal(p('sin^-1 x'), 'asin[x]');
  assert.equal(p('sin(x)^2'), '(sin[x]^2)');
  assert.equal(p('√(x+1)'), 'sqrt[(x+1)]');
  assert.equal(p('max(1, 2, 3)'), 'max[1,2,3]');
});

test('parser: equations, tuples and errors', () => {
  assert.equal(p('y = 2x'), 'y=(2*x)');
  assert.equal(p('f(x) = x^2'), 'f[x]=(x^2)');
  assert.equal(p('(cos t, sin t)'), '<cos[t],sin[t]>');
  const msg = (s) => { try { parse(s); return 'ok'; } catch (e) { return e.message; } };
  assert.match(msg('(1+2'), /Missing '\)'/);
  assert.match(msg('1+2)'), /Unmatched '\)'/);
  assert.match(msg('1+'), /after '\+'/);
  assert.match(msg('y = 1 = 2'), /Only one '='/);
  assert.match(msg('sin'), /needs an argument/);
  assert.match(msg('()'), /Empty brackets/);
  assert.match(msg(''), /Empty/);
});

test('evaluation: arithmetic and functions', () => {
  assert.equal(val('1 + 2*3'), 7);
  assert.equal(val('2^10'), 1024);
  assert.equal(val('-2^2'), -4);
  assert.equal(val('(-8)^(1/3)'), -2);
  assert.equal(val('(-8)^(2/3)'), 4);
  assert.ok(Number.isNaN(val('(-8)^(1/2)')));
  assert.equal(val('5!'), 120);
  assert.ok(close(val('0.5!'), Math.sqrt(Math.PI) / 2));
  assert.equal(val('sin(pi)'), 0);
  assert.equal(val('cos(pi/2)'), 0);
  assert.ok(close(val('sin(pi/6)'), 0.5));
  assert.ok(close(val('ln(e^3)'), 3));
  assert.equal(val('log(1000)'), 3);
  assert.ok(close(val('log(8, 2)'), 3));
  assert.equal(val('mod(-1, 3)'), 2);
  assert.equal(val('max(3, 9, 2)'), 9);
  assert.equal(val('round(3.14159, 2)'), 3.14);
  assert.equal(val('nCr(5, 2)'), 10);
  assert.equal(val('abs(-3)'), 3);
  assert.equal(val('√16'), 4);
  assert.ok(close(val('2pi'), 2 * Math.PI));
});

test('evaluation: degrees mode', () => {
  assert.equal(val('sin(30)', 'deg'), 0.5);
  assert.equal(val('cos(90)', 'deg'), 0);
  assert.equal(val('sin(180)', 'deg'), 0);
  assert.equal(val('tan(45)', 'deg'), 1);
  assert.ok(close(val('asin(1)', 'deg'), 90));
  assert.ok(close(val('atan(1)', 'deg'), 45));
});

test('rows: cartesian, x = g(y), polar, parametric, point, value', () => {
  const a = analyse([
    { text: 'y = x^2' },
    { text: '2x + 1' },
    { text: 'x = y^2' },
    { text: 'r = 1 + cos θ' },
    { text: '(cos t, sin t)' },
    { text: '(1, 2)' },
    { text: '3 + 4' },
    { text: 'sin(x) = y' },
    { text: '' },
    { text: 'y = 5' },
  ]);
  const k = a.rows.map((r) => r.kind);
  assert.deepEqual(k, ['cartesian', 'cartesian', 'cartesian-x', 'polar', 'parametric', 'point', 'value', 'cartesian', 'empty', 'cartesian']);
  assert.equal(a.rows[0].f(3), 9);
  assert.equal(a.rows[1].f(2), 5);
  assert.equal(a.rows[2].f(3), 9);
  assert.equal(a.rows[3].f(0), 2);
  assert.ok(close(a.rows[3].domain.max, 2 * Math.PI));
  assert.equal(a.rows[4].fx(0), 1);
  assert.deepEqual([a.rows[5].x, a.rows[5].y], [1, 2]);
  assert.equal(a.rows[6].value, 7);
  assert.equal(a.rows[9].f(100), 5);
});

test('rows: user variables and functions in any order', () => {
  const a = analyse([
    { text: 'y = a f(x) + b' },
    { text: 'f(x) = x^2' },
    { text: 'b = 2a' },
    { text: 'a = 3' },
    { text: 'g(u, v) = u v + f(u)' },
    { text: 'g(2, 5)' },
  ]);
  assert.equal(a.rows[0].kind, 'cartesian');
  assert.equal(a.rows[0].f(2), 3 * 4 + 6);
  assert.equal(a.rows[1].kind, 'function');
  assert.equal(a.rows[1].f(5), 25, 'f(x) definitions are plottable');
  assert.deepEqual([a.rows[2].kind, a.rows[2].value], ['variable', 6]);
  assert.deepEqual([a.rows[3].kind, a.rows[3].value], ['variable', 3]);
  assert.equal(a.rows[4].kind, 'function');
  assert.equal(a.rows[4].f, undefined, 'functions not of x are not plotted');
  assert.equal(a.rows[5].value, 14);
});

test('rows: a(x+1) multiplies when a is a variable', () => {
  const a = analyse([{ text: 'a = 2' }, { text: 'y = a(x+1)' }]);
  assert.equal(a.rows[1].f(1), 4);
});

test('rows: domains for polar and parametric', () => {
  const a = analyse([{ text: 'r = θ', domainMin: '-pi', domainMax: '4pi' }, { text: '(t, t)', domainMax: '0' }], { angle: 'rad' });
  assert.ok(close(a.rows[0].domain.min, -Math.PI));
  assert.ok(close(a.rows[0].domain.max, 4 * Math.PI));
  assert.equal(a.rows[1].domainError.which, 'max');
  const d = analyse([{ text: 'r = 1' }], { angle: 'deg' });
  assert.equal(d.rows[0].domain.max, 360);
});

test('rows: errors are specific', () => {
  assert.match(err('y = q x'), /'q' is not defined/);
  assert.match(err('r = sin(x)'), /Use θ/);
  assert.match(err('y = x + y'), /y on both sides/);
  assert.match(err('x^2 + y^2 = 1'), /isn't supported yet/);
  assert.match(err('(1, 2, 3)'), /exactly two/);
  assert.match(err('sin(1, 2)'), /takes 1 argument/);
  assert.match(err('x + y'), /write y = /);
  assert.match(err('e = 3'), /built-in constant/);
  assert.match(err('2 θ'), /polar/);
  assert.match(err('(x, 1)'), /Use t/);

  const dup = analyse([{ text: 'a = 1' }, { text: 'a = 2' }, { text: 'y = a' }]);
  assert.match(dup.rows[0].error.message, /more than once/);
  assert.match(dup.rows[1].error.message, /more than once/);
  assert.match(dup.rows[2].error.message, /more than once/);

  const cyc = analyse([{ text: 'a = b' }, { text: 'b = a + 1' }]);
  assert.match(cyc.rows[0].error.message, /in terms of itself/);
  assert.match(cyc.rows[1].error.message, /in terms of itself/);

  const rec = analyse([{ text: 'f(x) = f(x - 1)' }]);
  assert.match(rec.rows[0].error.message, /in terms of itself/);

  const dep = analyse([{ text: 'a = x' }, { text: 'y = a' }]);
  assert.match(dep.rows[0].error.message, /can't depend on x/);
  assert.match(dep.rows[1].error.message, /fix its definition/);
});

test('evaluate(): constant expressions with definitions and Ans', () => {
  const a = analyse([{ text: 'k = 4' }, { text: 'f(x) = 2x' }]);
  assert.equal(a.evaluate('f(k) + 1').value, 9);
  assert.equal(a.evaluate('Ans * 2', { Ans: 21 }).value, 42);
  assert.match(a.evaluate('x + 1').error.message, /no value here/);
  assert.match(a.evaluate('1 +').error.message, /after '\+'/);
});

test('error positions point at the problem', () => {
  const r = analyse([{ text: 'y = 2 + q' }]).rows[0];
  assert.equal(r.error.start, 8);
  assert.equal(r.error.end, 9);
});

test('formatNumber', () => {
  assert.equal(formatNumber(0.1 + 0.2), '0.3');
  assert.equal(formatNumber(-2.5), '−2.5');
  assert.equal(formatNumber(1 / 3), '0.3333333333');
  assert.equal(formatNumber(123456789), '123456789');
  assert.equal(formatNumber(6.02214076e23), '6.02214076×10²³');
  assert.equal(formatNumber(1.5e-9), '1.5×10⁻⁹');
  assert.equal(formatNumber(NaN), 'undefined');
  assert.equal(formatNumber(-Infinity), '−∞');
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(1e10), '1×10¹⁰');
});

test('formatCoordinate uses pixel resolution', () => {
  assert.equal(formatCoordinate(1.234567, 0.01), '1.23');
  assert.equal(formatCoordinate(1.5, 0.01), '1.5');
  assert.equal(formatCoordinate(-0.0001, 0.01), '0');
  assert.equal(formatCoordinate(-3.14159, 0.001), '−3.142');
});

test('special functions', () => {
  assert.ok(close(gamma(0.5), Math.sqrt(Math.PI), 1e-13));
  assert.equal(gamma(5), 24);
  assert.ok(close(gamma(-0.5), -2 * Math.sqrt(Math.PI), 1e-13));
  assert.ok(Number.isNaN(gamma(0)));
  assert.equal(realPow(-27, 1 / 3), -3);
  assert.equal(realPow(2, 3), 8);
  assert.equal(mod(7, -3), -2);
  assert.equal(nCr(52, 5), 2598960);
});
