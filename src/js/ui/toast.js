// A small message at the top of the screen, with an optional action ("Undo").
import { h } from './dom.js';

let current = null;

export function showToast(text, { action = null, ms = 6000 } = {}) {
  if (current) current.dismiss();
  const el = h('div', { class: 'toast', role: 'status' }, h('span', { class: 'toast-text' }, text));
  let timer = 0;
  const dismiss = () => {
    clearTimeout(timer);
    el.remove();
    if (current && current.el === el) current = null;
  };
  if (action) {
    el.append(h('button', {
      type: 'button', class: 'toast-action',
      onClick: () => {
        dismiss();
        action.onClick();
      },
    }, action.label));
  }
  el.append(h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss', onClick: dismiss }, '×'));
  document.body.append(el);
  timer = setTimeout(dismiss, ms);
  current = { el, dismiss };
  return dismiss;
}
