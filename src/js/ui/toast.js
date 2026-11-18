// A small message at the top of the screen, with an optional action ("Undo").
//
// One toast shows at a time. A lasting toast (`lasting: true`, such as "New version ·
// Reload") has no timer and stays until it is tapped or closed; if another toast takes
// its place for a moment, it comes back when that one goes.
import { h } from './dom.js';

let current = null;
let lasting = null; // { text, options } of a lasting toast that hasn't been closed

export function showToast(text, options = {}) {
  const { action = null, ms = 6000 } = options;
  const isLasting = !!options.lasting;
  if (isLasting) lasting = { text, options };
  if (current) current.dismiss({ replaced: true });
  const el = h('div', { class: 'toast', role: 'status' }, h('span', { class: 'toast-text' }, text));
  let timer = 0;
  const dismiss = ({ replaced = false, closed = false } = {}) => {
    clearTimeout(timer);
    el.remove();
    if (current && current.el === el) current = null;
    if (isLasting && closed && lasting && lasting.text === text) lasting = null;
    // A short toast went away on its own (or was closed): bring back the lasting one.
    if (!replaced && !isLasting && !current && lasting) showToast(lasting.text, lasting.options);
  };
  if (action) {
    el.append(h('button', {
      type: 'button', class: 'toast-action',
      onClick: () => {
        dismiss({ closed: true });
        action.onClick();
      },
    }, action.label));
  }
  el.append(h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss', onClick: () => dismiss({ closed: true }) }, '×'));
  document.body.append(el);
  if (!isLasting) timer = setTimeout(dismiss, ms);
  current = { el, dismiss };
  return () => dismiss({ closed: true });
}
