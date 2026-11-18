// "Open a shared project?" (D47, Phase 5b). A shared link never replaces the current work
// until the user agrees: this dialog shows a factual summary (counts only, never text from
// the project) and Open / Cancel buttons.
//
// Same modal pattern as the help dialog: focus is trapped inside, Cancel has the focus
// first, and Escape or a tap on the backdrop cancels. ask() resolves to 'open' or 'cancel',
// or to 'replaced' when a newer link takes over the open dialog.
import { h } from './dom.js';

export function createShareConfirm({ backdrop }) {
  const dialog = backdrop.querySelector('.confirm-dialog');
  const summaryEl = h('p', { class: 'confirm-summary', id: 'confirm-summary' });
  const cancelBtn = h('button', { type: 'button', class: 'secondary-btn', onClick: () => finish('cancel') }, 'Cancel');
  const openBtn = h('button', { type: 'button', class: 'primary-btn', onClick: () => finish('open') }, 'Open');
  dialog.append(
    h('h2', { id: 'confirm-title' }, 'Open a shared project?'),
    h('p', { id: 'confirm-text' },
      'This link holds graphs and data from someone else. Only open it if you trust where it came from.'),
    summaryEl,
    h('p', { class: 'confirm-note' }, 'Opening it replaces what’s on screen. You can undo this.'),
    h('div', { class: 'confirm-actions' }, cancelBtn, openBtn),
  );
  dialog.setAttribute('aria-describedby', 'confirm-text confirm-summary');

  let resolvePending = null;
  let returnFocus = null;

  function finish(answer) {
    if (!resolvePending) return;
    const resolve = resolvePending;
    resolvePending = null;
    backdrop.hidden = true;
    if (returnFocus && returnFocus.isConnected && !(returnFocus instanceof HTMLInputElement)) returnFocus.focus();
    returnFocus = null;
    resolve(answer);
  }

  function ask(summary) {
    if (resolvePending) {
      // A second link while the dialog is open replaces the first.
      const previous = resolvePending;
      resolvePending = null;
      previous('replaced');
    } else {
      // Inputs aren't refocused afterwards, so the keypad stays closed.
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    summaryEl.textContent = `It contains ${summary}.`;
    backdrop.hidden = false;
    cancelBtn.focus();
    return new Promise((resolve) => { resolvePending = resolve; });
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) finish('cancel'); });
  document.addEventListener('keydown', (e) => {
    if (backdrop.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish('cancel');
    } else if (e.key === 'Tab') {
      // Keep focus on the two buttons.
      e.preventDefault();
      (document.activeElement === cancelBtn ? openBtn : cancelBtn).focus();
    }
  }, true);
  // Anything that tries to take focus elsewhere while the dialog is open gets it back.
  document.addEventListener('focusin', (e) => {
    if (!backdrop.hidden && !dialog.contains(e.target)) cancelBtn.focus();
  });

  return { ask, isOpen: () => !backdrop.hidden };
}
