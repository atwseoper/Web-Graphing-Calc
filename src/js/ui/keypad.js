// On-screen maths keypad. Inserts text into the focused input without opening the
// phone's own keyboard (inputs use inputmode="none" while the keypad is in use).
//
// Dispatches on the target input:
//   'input'                    after every change (like typing)
//   'keypad-enter'             for the ↵ key
//   'keypad-backspace-empty'   for ⌫ on an empty input
import { h } from './dom.js';
import { ICONS } from './icons.js';

// Key spec: [label, insert, options]. insert may contain '|' marking where the caret goes.
const NUMBERS = [
  ['7', '7'], ['8', '8'], ['9', '9'], ['÷', '/', { cls: 'op', aria: 'divide' }],
  ['4', '4'], ['5', '5'], ['6', '6'], ['×', '*', { cls: 'op', aria: 'times' }],
  ['1', '1'], ['2', '2'], ['3', '3'], ['−', '-', { cls: 'op', aria: 'minus' }],
  ['0', '0'], ['.', '.'], ['⌫', null, { action: 'backspace', cls: 'op', icon: 'backspace', aria: 'backspace', repeat: true }], ['+', '+', { cls: 'op', aria: 'plus' }],
];

const PAGES = {
  main: [
    ['x', 'x', { cls: 'var' }], ['y', 'y', { cls: 'var' }], ['a²', '^2', { aria: 'squared' }], ['aᵇ', '^', { aria: 'power' }],
    ['(', '(|)'], [')', ')', { action: 'close' }], ['√', 'sqrt(|)', { aria: 'square root' }], ['π', 'π', { aria: 'pi' }],
    ['θ', 'θ', { cls: 'var', aria: 'theta' }], ['t', 't', { cls: 'var' }], [',', ', '], ['=', ' = ', { aria: 'equals' }],
    ['r', 'r', { cls: 'var' }], ['e', 'e'], ['!', '!', { aria: 'factorial' }], ['|a|', 'abs(|)', { aria: 'absolute value' }],
  ],
  func: [
    ['sin', 'sin(|)'], ['cos', 'cos(|)'], ['tan', 'tan(|)'], ['ln', 'ln(|)'],
    ['sin⁻¹', 'asin(|)', { aria: 'inverse sine' }], ['cos⁻¹', 'acos(|)', { aria: 'inverse cosine' }], ['tan⁻¹', 'atan(|)', { aria: 'inverse tangent' }], ['log', 'log(|)'],
    ['eˣ', 'exp(|)', { aria: 'e to the power' }], ['∛', 'cbrt(|)', { aria: 'cube root' }], ['mod', 'mod(|)'], ['n!', '!', { aria: 'factorial' }],
    ['⌊x⌋', 'floor(|)', { aria: 'floor' }], ['⌈x⌉', 'ceil(|)', { aria: 'ceiling' }], ['min', 'min(|)'], ['max', 'max(|)'],
  ],
  abc: [
    ['a', 'a'], ['b', 'b'], ['c', 'c'], ['d', 'd'],
    ['f', 'f'], ['g', 'g'], ['k', 'k'], ['m', 'm'],
    ['n', 'n'], ['p', 'p'], ['q', 'q'], ['s', 's'],
    ['u', 'u'], ['v', 'v'], ['w', 'w'], ['⌨', null, { action: 'keyboard', icon: 'keyboard', cls: 'op', aria: 'Use the phone keyboard' }],
  ],
};

export function createKeypad({ el, getTarget, onSystemKeyboard, onHide }) {
  let page = 'main';

  function key([label, insert, opt = {}]) {
    const b = h('button', {
      type: 'button',
      class: `key ${opt.cls || ''}`,
      'aria-label': opt.aria || label,
      html: opt.icon ? ICONS[opt.icon] : undefined,
    }, opt.icon ? null : label);
    b.dataset.insert = insert ?? '';
    if (opt.action) b.dataset.action = opt.action;
    if (opt.repeat) b.dataset.repeat = '';
    return b;
  }

  const left = h('div', { class: 'keys keys-left' });
  const right = h('div', { class: 'keys keys-right' }, NUMBERS.map(key));
  const tabs = {};
  const bar = h('div', { class: 'keypad-bar' },
    ...[['main', 'xʸ'], ['func', 'f(x)'], ['abc', 'abc']].map(([name, label]) => {
      tabs[name] = h('button', { type: 'button', class: 'key bar-key', dataset: { page: name }, 'aria-pressed': 'false' }, label);
      return tabs[name];
    }),
    h('span', { class: 'bar-spacer' }),
    h('button', { type: 'button', class: 'key bar-key', dataset: { action: 'left' }, html: ICONS.left, 'aria-label': 'Move left', 'data-repeat': '' }),
    h('button', { type: 'button', class: 'key bar-key', dataset: { action: 'right' }, html: ICONS.right, 'aria-label': 'Move right', 'data-repeat': '' }),
    h('button', { type: 'button', class: 'key bar-key', dataset: { action: 'hide' }, html: ICONS.hideKeypad, 'aria-label': 'Hide keypad' }),
    h('button', { type: 'button', class: 'key bar-key enter', dataset: { action: 'enter' }, html: ICONS.enter, 'aria-label': 'Enter' }),
  );
  el.append(bar, h('div', { class: 'keypad-grid' }, left, right));

  function showPage(name) {
    page = name;
    left.replaceChildren(...PAGES[name].map(key));
    for (const [n, b] of Object.entries(tabs)) b.setAttribute('aria-pressed', String(n === page));
  }
  showPage('main');

  // ---- editing -----------------------------------------------------------------------
  function emit(target) {
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insertText(target, text) {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    const caret = text.indexOf('|');
    const clean = text.replace('|', '');
    const selected = target.value.slice(start, end);
    if (caret >= 0 && selected) {
      // Wrap the selection: sin(|) around "x" -> sin(x)
      const wrapped = clean.slice(0, caret) + selected + clean.slice(caret);
      target.setRangeText(wrapped, start, end, 'end');
    } else {
      target.setRangeText(clean, start, end, 'end');
      if (caret >= 0) {
        const pos = start + caret;
        target.setSelectionRange(pos, pos);
      }
    }
    emit(target);
  }

  function act(btn) {
    const target = getTarget();
    if (btn.dataset.page) {
      showPage(btn.dataset.page);
      return;
    }
    const action = btn.dataset.action;
    if (action === 'keyboard') {
      onSystemKeyboard();
      return;
    }
    if (action === 'hide') {
      onHide();
      return;
    }
    if (!target) return;
    const v = target.value;
    const s = target.selectionStart ?? v.length;
    const e = target.selectionEnd ?? s;
    switch (action) {
      case 'backspace':
        if (!v) {
          target.dispatchEvent(new CustomEvent('keypad-backspace-empty'));
          return;
        }
        if (s !== e) {
          target.setRangeText('', s, e, 'end');
        } else if (s > 0) {
          // Delete an empty bracket pair together: "sin(|)" -> "sin|"
          const pair = v[s - 1] === '(' && v[s] === ')';
          target.setRangeText('', s - 1, pair ? s + 1 : s, 'end');
        } else {
          return;
        }
        emit(target);
        return;
      case 'left':
        target.setSelectionRange(Math.max(0, s - 1), Math.max(0, s - 1));
        return;
      case 'right':
        target.setSelectionRange(Math.min(v.length, e + 1), Math.min(v.length, e + 1));
        return;
      case 'enter':
        target.dispatchEvent(new CustomEvent('keypad-enter'));
        return;
      case 'close':
        // Step over an existing ')' instead of adding another.
        if (s === e && v[s] === ')') {
          target.setSelectionRange(s + 1, s + 1);
          return;
        }
        insertText(target, ')');
        return;
      default:
        insertText(target, btn.dataset.insert);
    }
  }

  // Keep focus in the input: never let keypad buttons take it. Preventing the default
  // of mousedown/touchstart stops the browser moving focus (and suppresses the
  // emulated click); keys act on pointerdown instead.
  el.addEventListener('mousedown', (ev) => ev.preventDefault());
  el.addEventListener('touchstart', (ev) => ev.preventDefault(), { passive: false });
  let repeatTimer = 0;
  el.addEventListener('pointerdown', (ev) => {
    const btn = ev.target.closest('button');
    ev.preventDefault();
    if (!btn) return;
    btn.classList.add('is-pressed');
    act(btn);
    if (btn.hasAttribute('data-repeat')) {
      const tick = (delay) => {
        repeatTimer = setTimeout(() => { act(btn); tick(60); }, delay);
      };
      tick(450);
    }
  });
  const release = () => {
    clearTimeout(repeatTimer);
    for (const b of el.querySelectorAll('.is-pressed')) b.classList.remove('is-pressed');
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', release);
  // Keyboard activation (Enter/Space on a focused key) for accessibility.
  el.addEventListener('click', (ev) => {
    if (ev.detail !== 0) return; // pointer clicks were handled on pointerdown
    const btn = ev.target.closest('button');
    if (btn) act(btn);
  });

  return { showPage };
}
