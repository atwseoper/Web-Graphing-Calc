// Help: one dialog with a page for each screen, opened from the "?" in the tab bar.
// It opens on the page for the current screen; the chips at the top switch pages.
import { h } from './dom.js';
import { ICONS } from './icons.js';

const PAGES = [['graph', 'Graph'], ['data', 'Data'], ['solve', 'Solve'], ['calc', 'Calc'], ['typing', 'Typing']];

// An example row: what to type, and what it does.
const ex = (code, what) => h('tr', {}, h('td', {}, h('code', {}, code)), h('td', {}, what));
const table = (...rows) => h('table', { class: 'help-examples' }, h('tbody', {}, ...rows));
const section = (title, ...body) => h('section', { class: 'help-section' }, h('h3', {}, title), ...body);
const p = (...parts) => h('p', {}, ...parts);
const ul = (...items) => h('ul', {}, ...items.map((i) => h('li', {}, ...[].concat(i))));
const b = (t) => h('b', {}, t);

function graphPage() {
  return [
    section('Type into a row',
      table(
        ex('y = x^2 - 3', 'a graph of y against x (or just x^2 - 3)'),
        ex('x = y^2', 'a sideways graph: x in terms of y'),
        ex('r = 1 + cos(θ)', 'a polar graph; set the θ range in the boxes underneath'),
        ex('(cos(t), sin(t))', 'a parametric curve: x and y both in terms of t, with a t range underneath'),
        ex('(2, 3)', 'a point'),
        ex('a = 2', 'a variable, with a slider to change it'),
        ex('f(x) = x^3 - x', 'your own function. Then use f(2), y = f(x - 1), f\'(x), f\'\'(x)'),
        ex('y = {x < 0: -x, x^2}', 'piecewise: the first true condition wins, the last part is "otherwise"'),
        ex('y = x^2{0 < x < 2}', 'only the part of a curve where the condition holds'),
        ex('sum(k^2, k, 1, 10)', 'Σ (sum) of k² for k = 1 to 10; prod(…) is Π'),
        ex('3 + 4·2', 'a calculation: the answer appears under the row'),
      ),
      p('If a row uses a letter that isn\'t defined yet, buttons appear to add a slider for it.'),
    ),
    section('On the graph',
      ul(
        'Drag to move around. Pinch, or scroll with a mouse, to zoom. Double-tap to zoom in.',
        ['The buttons zoom in and out, ', b('fit'), ' all your graphs, and go back ', b('home'), '.'],
        ['Tap a curve to ', b('trace'), ' it: drag along it to read off coordinates.'],
        'A tapped (or selected) curve shows dots at its roots, maximum and minimum points, y-intercept and where it crosses other curves. Tap a dot to see its coordinates.',
        'Dots are only found in the part of the graph you can see: pan or zoom to look elsewhere.',
        'Tap empty space to clear the trace and the dots.',
      ),
    ),
    section('Row buttons',
      ul(
        ['The coloured ', b('dot'), ' shows or hides the graph.'],
        [b('Analyse'), ' (the curve with a tangent): the derivative, the value, gradient and tangent at any x, and a definite integral, shaded on the graph. For polar graphs: the area enclosed.'],
        [b('Table'), ': a table of values, with a start and step you can change.'],
        [b('×'), ' deletes the row.'],
      ),
    ),
    section('Settings (gear)',
      p('Degrees or radians, a Cartesian or polar grid, when the on-screen keypad appears, and clearing all expressions.'),
    ),
  ];
}

function dataPage() {
  return [
    section('Getting data in',
      ul(
        [b('Open a file'), ': a CSV or text file from your phone, Google Drive or Downloads. On a computer you can also drag a file onto the page.'],
        [b('Paste data'), ': copy cells in Google Sheets or Excel and paste them, or paste CSV text. On a computer, Ctrl+V anywhere on the Data tab works too.'],
        [b('Type it in'), ': start an empty table.'],
      ),
      p('The preview shows how the data was read. Values can be separated by commas, semicolons, tabs or spaces, and decimals can use a point (1.5) or a comma (1,5): both are worked out for you, and you can change them if the guess is wrong. Pick the columns for x, y and, optionally, σy (the uncertainty of each y value).'),
      p('Cells that aren\'t numbers are listed in the preview and left blank, so you can fix them in the table afterwards.'),
    ),
    section('The table',
      ul(
        'Type 1.5 or 1,5 – both work. You can also type a calculation such as π/4 or 2^10.',
        ['Untick a point to ', b('leave it out'), ' of fits. It stays on the graph as a ring.'],
        ['The ', b('σy error column'), ' button adds or hides uncertainties, drawn as error bars.'],
        ['The ', b('1.5 / 1,5'), ' switch chooses how the table shows decimals.'],
        'Enter moves down a row, adding a new one at the end.',
      ),
    ),
    section('Data sets',
      p('Each import makes a new data set with its own colour. Tap a set\'s name at the top to switch to it. The coloured dot shows or hides it on the graph; the bin deletes it (tap twice). Data sets show on the graph in every tab, and you can tap a point on the graph to read its value.'),
    ),
  ];
}

function solvePage() {
  return [
    section('Equation',
      p('Solves any equation with one unknown, for example ', h('code', {}, 'cos x = x'), ' or ', h('code', {}, 'e^x = 5000'), '. It works numerically: it searches a range of values (−10 to 10 at first, widening up to ±1,000,000 if nothing is found) and finds the real solutions there.'),
      p('With several letters, such as ', h('code', {}, 'v = u + a t'), ', pick the one to solve for and type values for the others. Set the search range yourself if you know roughly where the answers are.'),
    ),
    section('Polynomial',
      p('Only for polynomials (powers of one unknown, like ', h('code', {}, 'x^3 - 6x^2 + 11x - 6'), '), but it finds ', b('every'), ' root: no search range is needed, nothing is missed, and complex and repeated roots are included.'),
    ),
    section('Which one?',
      ul(
        ['A polynomial and you want all its roots, including complex ones: ', b('Polynomial'), '.'],
        ['Anything else (sin, eˣ, ln, √, fractions with x underneath), or a formula with other letters to fill in: ', b('Equation'), '.'],
        'For a polynomial, Equation finds the real roots inside its search range (and can miss two that are extremely close together); Polynomial finds them all, plus the complex ones.',
      ),
    ),
    section('System',
      p('Several linear equations solved together, for example ', h('code', {}, '2x + 3y = 5'), ' and ', h('code', {}, 'x - y = 1'), '. It also tells you when there is no solution (the equations contradict each other) or infinitely many.'),
    ),
    section('Show on graph',
      p('Adds the equation to the Graph tab, so you can see the solutions as crossing points. Variables and functions you defined on the Graph tab can be used in all three modes.'),
    ),
  ];
}

function calcPage() {
  return [
    section('Calculations',
      ul(
        'Type a calculation and press Enter (or =). The answer appears in the history above.',
        [b('Ans'), ' is the last answer, e.g. ', h('code', {}, 'Ans * 2'), '. Type it as ans, or use the Ans key on the keypad\'s {} page.'],
        'Tap an earlier calculation to edit it again, or tap its answer to insert the number. On a keyboard, ↑ recalls the last calculation.',
        'Variables and functions from the Graph tab work here too.',
        'Trig functions follow the degrees/radians setting.',
      ),
    ),
  ];
}

function typingPage() {
  return [
    section('Symbols on a keyboard',
      p('Type these words and they turn into symbols as you type:'),
      table(
        ex('theta', 'θ'),
        ex('pi', 'π'),
        ex('<=   >=', '≤   ≥'),
      ),
      p('Other names work as words: ', h('code', {}, 'sqrt(x)'), ', ', h('code', {}, 'sum(…)'), ' for Σ, ', h('code', {}, 'prod(…)'), ' for Π, ', h('code', {}, 'asin(x)'), ' for sin⁻¹. Use ^ for powers and * or a space between letters if you like (2x, 2*x and 2 x are the same).'),
      p('On a computer, the keyboard button next to the "?" shows the on-screen keypad as well.'),
    ),
    section('The on-screen keypad',
      ul(
        [b('xʸ'), ': numbers, x, y, θ, powers, roots and brackets.'],
        [b('f(x)'), ': trig, logs, eˣ, Σ, Π and more functions.'],
        [b('{}'), ': conditions (braces, < > ≤ ≥), f′ for derivatives, floor, ceiling and Ans.'],
        [b('abc'), ': letters for variables. ⌨ switches to your phone\'s own keyboard.'],
        'The arrows move the cursor; the down arrow hides the keypad.',
      ),
    ),
    section('How expressions are read',
      ul(
        'Letters are single names: ab means a × b.',
        'Next to each other means multiply: 2x, 3sin(x), (x + 1)(x − 1).',
        'sin 2x means sin(2x); sin^2 x means (sin x)²; sin^-1 x means asin x.',
        '1/2x means (1/2)·x, as on most calculators. Write 1/(2x) for the other meaning.',
      ),
    ),
  ];
}

const BUILDERS = { graph: graphPage, data: dataPage, solve: solvePage, calc: calcPage, typing: typingPage };

export function createHelp({ backdrop, openBtn, getTab }) {
  const dialog = backdrop.querySelector('.help-dialog');
  const body = h('div', { class: 'help-body' });
  const chips = {};
  const nav = h('div', { class: 'help-nav', role: 'tablist', 'aria-label': 'Help topics' },
    ...PAGES.map(([key, label]) => {
      chips[key] = h('button', { type: 'button', class: 'chip', role: 'tab', 'aria-selected': 'false', onClick: () => show(key) }, label);
      return chips[key];
    }));
  const closeBtn = h('button', { type: 'button', class: 'tool-btn help-close', html: ICONS.close, 'aria-label': 'Close help', onClick: close });
  dialog.append(h('div', { class: 'help-head' }, h('h2', { id: 'help-title' }, 'Help'), closeBtn), nav, body);

  function show(key) {
    for (const [k, c] of Object.entries(chips)) c.setAttribute('aria-selected', String(k === key));
    body.replaceChildren(...BUILDERS[key]());
    body.scrollTop = 0;
  }

  function open() {
    show(BUILDERS[getTab()] ? getTab() : 'graph');
    backdrop.hidden = false;
    closeBtn.focus();
  }

  function close() {
    backdrop.hidden = true;
    openBtn.focus();
  }

  openBtn.addEventListener('click', open);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !backdrop.hidden) close();
  });

  return { open, close };
}
