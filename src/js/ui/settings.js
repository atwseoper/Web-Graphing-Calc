// Settings popover: angle unit, grid type, axis types, keypad mode, about, clear all.
import { h } from './dom.js';
import { defaultState } from '../state/defaults.js';

const GROUPS = [
  { key: 'angle', label: 'Angles', options: [['rad', 'Radians'], ['deg', 'Degrees']] },
  { key: 'grid', label: 'Grid', options: [['cartesian', 'Cartesian'], ['polar', 'Polar']] },
  { key: 'xAxis', label: 'x axis', options: [['linear', 'Linear'], ['log', 'Log']] },
  { key: 'yAxis', label: 'y axis', options: [['linear', 'Linear'], ['log', 'Log']] },
  { key: 'keypad', label: 'On-screen keypad', options: [['auto', 'Auto'], ['always', 'Always'], ['never', 'Never']] },
  { key: 'pretty', label: 'Maths preview under rows', options: [['on', 'Show'], ['off', 'Hide']] },
];

// The x and y axis settings share a row, side by side.
function pairUp(els) {
  const out = [];
  for (let i = 0; i < els.length; i++) {
    if (els[i].dataset.key === 'xAxis' && els[i + 1] && els[i + 1].dataset.key === 'yAxis') {
      out.push(h('div', { class: 'setting-pair' }, els[i], els[i + 1]));
      i++;
    } else {
      out.push(els[i]);
    }
  }
  return out;
}

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
    ...pairUp(GROUPS.map((g) => h('div', { class: 'setting', 'data-key': g.key },
      h('span', { class: 'setting-label', id: `setting-${g.key}` }, g.label),
      h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': `setting-${g.key}` },
        ...g.options.map(([value, text]) => {
          const b = h('button', {
            type: 'button', role: 'radio', 'aria-checked': 'false',
            onClick: () => store.update((s) => {
              const settings = { ...s.settings, [g.key]: value };
              // The polar grid isn't offered with log axes (Phase 7a).
              if (value === 'log') settings.grid = 'cartesian';
              return { ...s, settings };
            }),
          }, text);
          buttons[`${g.key}:${value}`] = b;
          return b;
        })),
    ))),
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
    const logAxes = state.settings.xAxis === 'log' || state.settings.yAxis === 'log';
    const polar = buttons['grid:polar'];
    polar.disabled = logAxes;
    polar.title = logAxes ? 'Not available with log axes' : '';
  }

  return { render, close };
}
