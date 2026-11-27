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
    section('Lists',
      table(
        ex('L = [1, 2, 3]', 'a list. Names are single letters, like every variable'),
        ex('[1...10]', 'the whole numbers from 1 to 10; [0, 0.5...5] counts in steps of 0.5'),
        ex('y = L·x', 'one curve for each element of L, in shades of the row\'s colour'),
        ex('(L, M)', 'points from two lists: (L₁, M₁), (L₂, M₂) …'),
        ex('L[2]', 'the second element. L[2...4] gives several; L[[1, 3]] picks the 1st and 3rd'),
        ex('L^2 + 1', 'arithmetic and functions work on each element'),
        ex('length(L)  sum(L)  prod(L)', 'how many elements, their total and their product'),
        ex('mean(L)  median(L)  stdev(L)', 'the mean, median and standard deviation (stdev uses n − 1; stdevp uses n). min(L) and max(L) work too'),
        ex('D_1.x   D_1.y', 'the columns of data set 1 (Data tab) as lists, such as mean(D_1.y) or (D_1.x, D_1.y^2). With only one data set, D.x works too'),
      ),
      ul(
        'Two lists in one row pair up element by element: y = a·x + b with a = [1, 2, 3] and b = [0, 1, 2] draws 3 curves. If their lengths differ, the shorter length is used, with a warning.',
        'A list can have up to 10,000 elements, and a row draws at most 50 curves (the first 50, with a warning).',
        'Tracing a curve of a family shows which element it is, such as a = 2. Roots and other points of interest are only shown for single curves.',
        'A long list shows its first and last few elements under the row; Show all lists every one.',
        ['Positions count from 1 (L[1] is the first element). Settings can make them count from 0 instead. That setting belongs to your device: a project made with the other setting has its positions converted when you open it.'],
        'Lists work in y = …, x = …, r = …, parametric curves, points and calculations, but not yet in implicit curves, inequalities or slope fields.',
      ),
    ),
    section('Sequences',
      table(
        ex('u(n) = 2u(n - 1) + 1', 'a recursive sequence: each term from the one before. It needs a starting value too:'),
        ex('u(0) = 1', 'the starting value. The sequence starts at the lowest n given one (u(1) = 1 starts it at n = 1)'),
        ex('F(n) = F(n-1) + F(n-2)', 'terms further back need more starting values: F(0) = 0 and F(1) = 1'),
        ex('u(50)', 'a term, here or in the Calc tab; u([0...10]) gives a list of terms'),
      ),
      ul(
        'A sequence is drawn as points (n, u(n)) at whole numbers. Tap one to trace it.',
        ['For a rule that uses a parameter, pick a letter such as a, with a slider: ', h('code', {}, 'u(n) = a u(n-1)(1 - u(n-1))'), '. r, θ and t are kept for polar and parametric graphs.'],
        [b('Plot as sequence'), ' under a y = … row, or a function such as v(n) = 1/n, draws it as points at whole numbers too.'],
        ['When each term depends only on the one before, such as u(n) = a u(n−1)(1 − u(n−1)), ', b('Cobweb diagram'), ' draws y = g(x), the line y = x and the staircase from u(0) between them. Set the number of steps; ▷ draws it a step at a time.'],
        'Terms are worked out up to n = 100,000. A term that would need a later one, such as u(n) = u(n + 1), is undefined.',
      ),
    ),
    section('Sliders and animation',
      ul(
        ['Drag a slider, or type its ', b('min'), ' and ', b('max'), '. ', b('Step'), ' sets how far each move goes (leave it empty for small steps).'],
        [b('▷ Play'), ' moves the slider back and forth across its range, so every graph that uses it moves too. Tap again to pause.'],
        ['A point that uses sliders, such as ', b('(h, k)'), ' or ', b('(a, f(a))'), ', gets a ringed handle: drag it and the sliders follow. A point with one slider slides along its path. Going past a slider\'s max or min widens it. Undo puts the whole drag back.'],
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
        ['Also in Analyse: a ', b('Riemann sum'), ' (left, right, midpoint or trapezium) over the integral\'s range, drawn as rectangles and compared with the exact integral; a ', b('Taylor polynomial'), ' up to degree 30, drawn dashed, with exact fractions wherever the coefficients are certainly rational (x³/6, not 0.1666666667) and a table of every coefficient; ', b('Add to graph'), ' turns it into a row; and ', b('Secant → tangent'), ', whose ▷ shrinks h so the secant turns into the tangent.'],
        [b('Table'), ': a table of values, with a start and step you can change (for a sequence it starts at its first term).'],
        [b('×'), ' deletes the row.'],
      ),
    ),
    section('Undo and redo',
      p('The arrows at the top left undo and redo changes to your rows, data, fits and Solve inputs (Ctrl+Z and Ctrl+Shift+Z on a keyboard). Moving the graph around isn\'t undone.'),
    ),
    section('Share and save',
      ul(
        [b('Share a link'), ': the link holds your whole project (graphs, data and fits), so whoever opens it gets their own copy. Nothing is uploaded. Very large data sets don\'t fit in a link: save a project file instead.'],
        ['Opening a shared link first asks ', b('Open a shared project?'), ', with a count of what it holds. Only open links from people you trust. Cancel keeps your own work; Open replaces it, and you can undo that.'],
        [b('Save image'), ': a PNG of the graph as it is on screen, with a key of what\'s drawn.'],
        [b('Save project file'), ' and ', b('Open project file'), ': everything as a .json file. Opening one replaces what\'s here, and you can undo it. You can also drop a project file onto the page.'],
        ['To keep the calculator on your phone\'s home screen, or as an app on a computer, open it from its web address and use your browser\'s ', b('Add to Home screen'), ' or ', b('Install app'), '. The installed app starts with no connection. When a new version is out, a ', b('New version · Reload'), ' message appears: tap Reload to switch (your work is kept).'],
      ),
    ),
    section('Log axes',
      ul(
        ['In Settings, the ', b('x axis'), ' and ', b('y axis'), ' can each be ', b('Linear'), ' or ', b('Log'), ': one log axis gives a semi-log graph, both give log-log. Each decade (1 to 10, 10 to 100…) takes the same space.'],
        'On log-log axes a power law y = a·xⁿ is a straight line of gradient n; with only y on a log scale, an exponential y = a·bˣ is a straight line.',
        'Nothing at zero or below can be shown on a log axis, so those parts of graphs and data points are left out. Zooming and panning multiply rather than add.',
        'Everything else works as usual: data, fits and bands, inequalities, implicit curves and slope fields (whose marks show the slope as it looks on the log axes). The polar grid isn\'t available with log axes.',
      ),
    ),
    section('Settings (gear)',
      p('Degrees or radians, a Cartesian or polar grid, linear or log axes, when the on-screen keypad appears, whether list positions start at 1 or 0, and clearing all expressions.'),
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
        [b('From a photo'), ': read points off a photo or screenshot of a graph (see below). On a computer you can also drop an image on the page, or paste a screenshot with Ctrl+V on the Data tab.'],
      ),
      p('The preview shows how the data was read. Values can be separated by commas, semicolons, tabs or spaces, and decimals can use a point (1.5) or a comma (1,5): both are worked out for you, and you can change them if the guess is wrong. Pick the columns for x, y and, optionally, σy (the uncertainty of each y value).'),
      p('Cells that aren\'t numbers are listed in the preview and left blank, so you can fix them in the table afterwards.'),
    ),
    section('Points from a photo',
      p('First calibrate: tell the app how the photo maps to x and y. Choose one of three ways (', b('How to use this'), ' in the digitiser goes through each one step by step):'),
      ul(
        [b('Axes'), ' (most graphs): tap two points on the x axis and two on the y axis whose values you know, such as labelled tick marks, and type their values. x₁ and y₁ can both be the origin. All four go on the axis lines themselves, not on the curve: the curve\'s points come after ', b('Next'), '. Each axis can be linear or log. A tilted or skewed photo is fine; if the axes come out far from a right angle, a warning asks you to check the markers.'],
        [b('Known length'), ' (real objects, no axes): tap an origin, then a point a known length away along the +x direction, and type the length. +y is a quarter turn anticlockwise from +x.'],
        [b('4 points'), ' (a photo taken at an angle): tap four points whose x and y you know, such as the corners of a rectangle of known size or four grid crossings, and type their values. This undoes the perspective.'],
      ),
      p('Once the calibration works, a grid of the calibrated axes is drawn over the photo: check it lines up, then tap ', b('Next'), ' and tap each point you want. ', b('Add points'), ' makes a new data set, ready for fitting.'),
      ul(
        'Tap to place. Press and hold to aim with the magnifier, which also shows the value; let go to place.',
        'Drag a marker or point to fine-tune it: it moves with your finger, a little way off, so you can see it. Pinch or use + and − to zoom; drag the photo to move around.',
        'Values are rounded to what one pixel of the photo can show, so there are no false digits.',
        ['On a computer: click to place, drag to move, the mouse wheel zooms, arrow keys nudge the selected marker (Shift for ×10), Delete removes a point, Ctrl+Z undoes.'],
        'The photo itself is never saved, in the project or anywhere else: only the points you add are kept.',
      ),
    ),
    section('Data in expressions',
      ul(
        ['Each data set\'s columns are lists you can use in the Graph and Calc tabs: ', h('code', {}, 'D_1.x'), ' and ', h('code', {}, 'D_1.y'), ' for data set 1 (shown D₁.x). The number is on the data set\'s card. With only one data set, ', h('code', {}, 'D.x'), ' and ', h('code', {}, 'D.y'), ' work too.'],
        ['For example ', h('code', {}, 'mean(D_1.y)'), ', ', h('code', {}, 'y = D_1.y[1]·x'), ', or ', h('code', {}, '(D_1.x, D_1.y - f(D_1.x))'), ' for residuals from your own function.'],
        'Points left out in the table are left out of the lists too, as they are of fits, and so are rows missing an x or a y. Editing the table updates every expression that uses it.',
      ),
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
    section('Statistics, histograms and box plots',
      ul(
        [b('Show as'), ': ', b('Points'), ' (a scatter plot), a ', b('Histogram'), ' of one column, or a ', b('Box plot'), ' of one column. Fits are drawn with the points only.'],
        ['The histogram\'s ', b('bin width'), ' is chosen for you (the Freedman–Diaconis rule, rounded to 1, 2 or 5 × a power of ten); type your own to change it. Bins start at whole multiples of the width, and a value on an edge goes in the bin above it. Tap a bar to see its range and count.'],
        ['Box plots sit near the top of the graph and follow the x axis. The whiskers reach the furthest values within 1.5 × IQR of the box; values beyond that are drawn as rings. Tap the box to read the five numbers.'],
        [b('Statistics'), ' (tap to open) lists n, the mean, median, both standard deviations (s for a sample, σ for a whole population), the quartiles, IQR, minimum, maximum and sum of each column, and the correlation r of the pairs. Points left out of fits are left out here too. A single column of values (pasted on its own) works.'],
        [b('Quartiles'), ': TI-84 takes the medians of the lower and upper halves (leaving out the middle value when n is odd); Interpolated works between values as Excel\'s QUARTILE.INC and R do. They can differ a little. The choice is saved with the project.'],
      ),
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
        ['Lists work here too: ', h('code', {}, '[1...10]^2'), ' gives a list (long ones show their first and last few elements, with Show all), and ', h('code', {}, 'mean(L)'), ' gives a number.'],
        'Variables and functions from the Graph tab work here too.',
        'Trig functions follow the degrees/radians setting.',
      ),
    ),
    section('Probability distributions',
      p('These work everywhere: in calculations, in graphs and in other functions. The argument order is the TI-84\'s.'),
      table(
        ex('normalpdf(x, μ, σ)', 'normal density; μ = 0 and σ = 1 if left out'),
        ex('normalcdf(a, b, μ, σ)', 'P(a ≤ X ≤ b); normalcdf(x) alone is P(Z ≤ x)'),
        ex('invnorm(p, μ, σ)', 'the x with P(X ≤ x) = p'),
        ex('tpdf(x, ν)   tcdf(a, b, ν)', 'Student\'s t with ν degrees of freedom; tcdf(x, ν) is P(T ≤ x)'),
        ex('invt(p, ν)', 'the t with P(T ≤ t) = p'),
        ex('chi2pdf(x, k)   chi2cdf(a, b, k)', 'χ² with k degrees of freedom; chi2cdf(x, k) is P(X ≤ x)'),
        ex('binompdf(n, p, x)', 'P(X = x) for n trials with probability p'),
        ex('binomcdf(n, p, x)', 'P(X ≤ x); binomcdf(n, p, a, b) is P(a ≤ X ≤ b)'),
        ex('poissonpdf(μ, x)', 'P(X = x) for a Poisson mean μ'),
        ex('poissoncdf(μ, x)', 'P(X ≤ x); poissoncdf(μ, a, b) is P(a ≤ X ≤ b)'),
      ),
      ul(
        ['On a graph, ', h('code', {}, 'y = normalpdf(x)'), ' with a shaded integral (Analyse, ∫ from … to …) shows a probability as an area.'],
        [h('code', {}, 'y = binompdf(10, 0.3, x)'), ' and other discrete distributions are drawn as stems at whole numbers. Their Analyse panel adds them up instead: Σ from a to b, with those stems shaded.'],
        'For "less than x" with the normal distribution, use a very low first limit, as on a TI-84: normalcdf(-1e99, x, μ, σ).',
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
      p('Type three dots, ', h('code', {}, '...'), ', for the … in a range such as [1...10].'),
      p('Other names work as words: ', h('code', {}, 'sqrt(x)'), ', ', h('code', {}, 'sum(…)'), ' for Σ, ', h('code', {}, 'prod(…)'), ' for Π, ', h('code', {}, 'asin(x)'), ' for sin⁻¹. Use ^ for powers and * or a space between letters if you like (2x, 2*x and 2 x are the same).'),
      p('On a computer, the keyboard button next to the "?" shows the on-screen keypad as well.'),
    ),
    section('The on-screen keypad',
      ul(
        [b('xʸ'), ': numbers, x, y, θ, powers, roots and brackets.'],
        [b('f(x)'), ': trig, logs, eˣ, Σ, Π and more functions.'],
        [b('{}'), ': conditions (braces, < > ≤ ≥), f′ for derivatives, floor, ceiling, list brackets [ ], … for ranges, and Ans.'],
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
