// Draws a pretty-print layout (expr/pretty.js) as HTML: stacked fractions, raised
// powers, radicals and Σ with limits, styled by styles/math.css.
import { h } from './dom.js';

function isTall(box) {
  switch (box.t) {
    case 'frac': case 'bigop': return true;
    case 'row': return box.c.some(isTall);
    case 'paren': return isTall(box.c);
    case 'sup': return isTall(box.b);
    case 'sqrt': return isTall(box.c);
    default: return false;
  }
}

// Inside an exponent, fractions are written on one line (a/b) so they stay legible.
export function renderMath(box, inExp = false) {
  const r = (b) => renderMath(b, inExp);
  switch (box.t) {
    case 'text': return h('span', { class: `m-${box.k}` }, box.s);
    case 'row': return h('span', { class: 'm-row' }, ...box.c.map(r));
    case 'frac':
      if (inExp) {
        // Brackets only where a/b on one line would read differently.
        const hasOp = (b) => b.t === 'row' && b.c.some((c) => c.t === 'text' && c.k === 'op');
        const wrapN = hasOp(box.n);
        const wrapD = box.d.t === 'row' && box.d.c.length > 1;
        const part = (b, wrap) => (wrap ? h('span', { class: 'm-row' }, '(', r(b), ')') : r(b));
        return h('span', { class: 'm-row' }, part(box.n, wrapN), h('span', { class: 'm-punct' }, '/'), part(box.d, wrapD));
      }
      return h('span', { class: 'm-frac' },
        h('span', { class: 'm-fnum' }, r(box.n)),
        h('span', { class: 'm-fden' }, r(box.d)));
    case 'sup':
      return h('span', { class: 'm-sup' }, r(box.b), h('span', { class: 'm-exp' }, renderMath(box.e, true)));
    case 'sub':
      return h('span', { class: 'm-subs' }, r(box.b), h('span', { class: 'm-sub' }, r(box.s)));
    case 'sqrt':
      return h('span', { class: 'm-sqrt' },
        box.i ? h('span', { class: 'm-root-index' }, r(box.i)) : null,
        h('span', { class: 'm-radical', 'aria-hidden': 'true' }, '√'),
        h('span', { class: 'm-radicand' }, r(box.c)));
    case 'paren': {
      const tall = isTall(box.c) ? ' m-tall' : '';
      return h('span', { class: `m-paren${tall}` },
        h('span', { class: 'm-bracket' }, box.open), r(box.c), h('span', { class: 'm-bracket' }, box.close));
    }
    case 'bigop':
      return h('span', { class: 'm-bigop-wrap' },
        h('span', { class: 'm-bigop' },
          h('span', { class: 'm-limit' }, r(box.hi)),
          h('span', { class: 'm-op-big' }, box.op),
          h('span', { class: 'm-limit' }, r(box.lo))),
        r(box.c));
    default: return h('span');
  }
}
