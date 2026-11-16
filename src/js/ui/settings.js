// Settings popover: angle unit, grid type, keypad mode, about, clear all.
import { h } from './dom.js';
import { defaultState } from '../state/defaults.js';

const GROUPS = [
  { key: 'angle', label: 'Angles', options: [['rad', 'Radians'], ['deg', 'Degrees']] },
  { key: 'grid', label: 'Grid', options: [['cartesian', 'Cartesian'], ['polar', 'Polar']] },
  { key: 'keypad', label: 'On-screen keypad', options: [['auto', 'Auto'], ['always', 'Always'], ['never', 'Never']] },
  { key: 'pretty', label: 'Maths preview under rows', options: [['on', 'Show'], ['off', 'Hide']] },
];

export function createSettings({ popover, toggleBtn, store, buildInfo }) {
  const buttons = {};
  let confirmTimer = 0;

  const clearBtn = h('button', { type: 'button', class: 'danger-btn' }, 'Clear all expressions');
  clearBtn.addEventListener('click', () => {
    if (!clearBtn.classList.contains('is-confirming')) {
      clearBtn.classList.add('is-confirming');
      clearBtn.textContent = 'Tap again to clear everything';
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(reset, 3000);
      return;
    }
    reset();
    const fresh = defaultState();
    store.update((s) => ({ ...s, rows: [{ ...fresh.rows[1], id: s.nextId }], nextId: s.nextId + 1 }));
    close();
  });
  function reset() {
    clearBtn.classList.remove('is-confirming');
    clearBtn.textContent = 'Clear all expressions';
  }

  popover.append(
    h('h2', { class: 'popover-title' }, 'Settings'),
    ...GROUPS.map((g) => h('div', { class: 'setting' },
      h('span', { class: 'setting-label', id: `setting-${g.key}` }, g.label),
      h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': `setting-${g.key}` },
        ...g.options.map(([value, text]) => {
          const b = h('button', {
            type: 'button', role: 'radio', 'aria-checked': 'false',
            onClick: () => store.update((s) => ({ ...s, settings: { ...s.settings, [g.key]: value } })),
          }, text);
          buttons[`${g.key}:${value}`] = b;
          return b;
        })),
    )),
    clearBtn,
    h('p', { class: 'about' },
      'Graphing Calculator ', buildInfo, h('br'),
      h('a', { href: 'https://github.com/atwseoper/Web-Graphing-Calc', target: '_blank', rel: 'noopener' }, 'Source'),
      ' · ',
      h('a', { href: 'https://github.com/atwseoper/Web-Graphing-Calc/blob/main/LICENSE.md', target: '_blank', rel: 'noopener' }, 'Non-commercial licence'),
    ),
  );

  function open() {
    popover.hidden = false;
    toggleBtn.setAttribute('aria-expanded', 'true');
  }
  function close() {
    popover.hidden = true;
    toggleBtn.setAttribute('aria-expanded', 'false');
    reset();
  }
  toggleBtn.addEventListener('click', () => (popover.hidden ? open() : close()));
  document.addEventListener('pointerdown', (e) => {
    if (!popover.hidden && !popover.contains(e.target) && !toggleBtn.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popover.hidden) {
      close();
      toggleBtn.focus();
    }
  });

  function render(state) {
    for (const g of GROUPS) {
      for (const [value] of g.options) {
        buttons[`${g.key}:${value}`].setAttribute('aria-checked', String(state.settings[g.key] === value));
      }
    }
  }

  return { render, close };
}
