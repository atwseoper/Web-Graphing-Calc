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
        ex('x^2 + y^2 = 9', 'an implicit curve: any equation in x and y'),
        ex('y < x^2', 'a shaded region. < and > give a dashed edge, <= and >= (≤ ≥) a solid one'),
        ex('0 < y < x', 'regions can be chained, and can use x and y anywhere: x^2 + y^2 <= 4'),
        ex("y' = x - y", 'a slope field (dy/dx = … works too). Tap + Solution curve, then the graph, to draw the solution through that point'),
        ex('a = 2', 'a variable, with a slider to change it'),
        ex('f(x) = x^3 - x', 'your own function. Then use f(2), y = f(x - 1), f\'(x), f\'\'(x)'),
        ex('y = {x < 0: -x, x^2}', 'piecewise: the first true condition wins, the last part is "otherwise"'),
        ex('y = x^2{0 < x < 2}', 'only the part of a curve where the condition holds'),
        ex('sum(k^2, k, 1, 10)', 'Σ (sum) of k² for k = 1 to 10; prod(…) is Π'),
        ex('3 + 4·2', 'a calculation: the answer appears under the row'),
      ),
      p('If a row uses a letter that isn\'t defined yet, buttons appear to add a slider for it.'),
      p('Under a row with powers, fractions, roots or Σ, the expression is shown as it would be written by hand, so you can check how it was read: 1/2x is ½·x. Settings can hide this.'),
    ),
    section('Sliders and animation',
      ul(
        ['Drag a slider, or type its ', b('min'), ' and ', b('max'), '. ', b('Step'), ' sets how far each move goes (leave it empty for small steps).'],
        [b('▷ Play'), ' moves the slider back and forth across its range, so every graph that uses it moves too. Tap again to pause.'],
        ['On a polar or parametric row, ', b('▷'), ' next to the θ or t range draws the curve as θ or t increases, showing the current point.'],
      ),
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
    section('Undo and redo',
      p('The arrows at the top left undo and redo changes to your rows, data, fits and Solve inputs (Ctrl+Z and Ctrl+Shift+Z on a keyboard). Moving the graph around isn\'t undone.'),
    ),
    section('Share and save',
      ul(
        [b('Share a link'), ': the link holds your whole project (graphs, data and fits), so whoever opens it gets their own copy. Nothing is uploaded. Very large data sets don\'t fit in a link: save a project file instead.'],
        [b('Save image'), ': a PNG of the graph as it is on screen, with a key of what\'s drawn.'],
        [b('Save project file'), ' and ', b('Open project file'), ': everything as a .json file. Opening one replaces what\'s here, and you can undo it. You can also drop a project file onto the page.'],
        ['To keep the calculator on your phone\'s home screen, open it from its web address and use your browser\'s ', b('Add to Home screen'), ' or ', b('Install app'), '.'],
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
    section('Fitting a curve',
      ul(
        [b('+ Fit a curve'), ' adds a fit to the data set, drawn on the graph in its own colour. Add more fits to compare models.'],
        [b('Models'), ': line, polynomial (degree 2 to 6), exponential a·eᵇˣ, power a·xᵇ, logarithmic a + b·ln x, logistic, sinusoidal, Gaussian, or your own (Custom), such as ', h('code', {}, 'a e^(-b x) + c'), '.'],
        ['In a custom model, x is the variable and every other letter is a parameter to fit, except letters defined in the Graph tab, which are fixed numbers. ', h('code', {}, 'a(1 - e^(-b x))'), ' means a times the bracket.'],
        ['Each parameter has a ', b('standard error'), ' (± SE) and a ', b('95% interval'), '. The value is rounded to the digits the error justifies.'],
        [b('R²'), ' is the share of the variation in y the fit explains; ', b('RMSE'), ' is the typical size of a residual; ', b('s'), ' is the residual standard deviation, allowing for the number of parameters.'],
      ),
    ),
    section('Errors, bands and residuals',
      ul(
        ['With a σy column, fits are ', b('weighted by σy'), ' (tap to turn it off). The σy values are taken as the true uncertainties: ', b('χ²/dof'), ' near 1 means the points scatter as much as σy says; ', b('P(χ²)'), ' is the chance of a χ² this large if the model is right.'],
        [b('Bands'), ': the shaded 95% confidence band shows where the true curve probably lies; the dashed prediction band (unweighted fits) shows where new points would probably fall.'],
        [b('Residuals'), ' plots y − fit for each point. A good model leaves residuals scattered randomly around 0; a curve or trend means the model is missing something.'],
      ),
    ),
    section('If a fit fails or looks wrong',
      p('Models such as exponential, logistic and custom ones are fitted by searching from starting values. Built-in models guess good ones; custom models try several. If the search fails or finds a poor fit, open ', b('Details'), ' and type rough starting values for the parameters. The card also warns when a parameter is poorly determined.'),
    ),
    section('Using the results',
      ul(
        [b('Add to graph'), ' copies the fitted equation, at full precision, to the Graph tab, where you can find roots, turning points and integrals.'],
        [b('Copy results'), ' copies the parameters and statistics as cells to paste into a spreadsheet. Below the table, ', b('Download CSV'), ' and ', b('Copy table'), ' export the data.'],
        [b('Details'), ' shows the method, the degrees of freedom and how strongly the parameters are correlated.'],
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
      p('Several equations solved together. Linear ones, for example ', h('code', {}, '2x + 3y = 5'), ' and ', h('code', {}, 'x - y = 1'), ', are solved exactly, and it tells you when there is no solution (the equations contradict each other) or infinitely many.'),
      p('Non-linear ones, for example ', h('code', {}, 'x^2 + y^2 = 4'), ' and ', h('code', {}, 'y = x^2 - 1'), ', need as many equations as unknowns. They are solved numerically, starting from many points between −10 and 10 (widening to ±1000 if nothing is found), and every different solution found is listed. Solutions far away or very close together can be missed.'),
    ),
    section('Show on graph',
      p('Adds the equation (or, for a system in two unknowns, every equation and the solution points) to the Graph tab, so you can see the solutions as crossing points. Variables and functions you defined on the Graph tab can be used in all three modes.'),
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
