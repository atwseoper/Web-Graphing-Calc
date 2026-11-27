# Web Graphing Calculator – Design Document

**Status:** v1.0 – Phase 9 (lists, curve families, data columns and sequences) complete; Phase 10 planned · **Updated:** 27 November 2026

Earlier drafts (v0.1, v0.2) are kept as Google Docs in the Drive folder *Projects / Web Graphing Calculator*. This file is now the source of truth.

## 0. Decisions log

| # | Decision | Date |
|---|----------|------|
| D1 | 2D graphs only. No 3D, complex-plane plots, CAS, programming mode or arbitrary precision. | 15 Nov 2026 |
| D2 | "Optimiser" means regression: fitting an equation to a data set, with error statistics. Data can be loaded from CSV. | 15 Nov 2026 |
| D3 | Primary target is a portrait phone. Landscape tablet and desktop are supported through a responsive layout. | 15 Nov 2026 |
| D4 | Modern, clean app look focused on ease of use. No emulation of a physical calculator. | 15 Nov 2026 |
| D5 | Separate source files, built into one self-contained HTML file. | 15 Nov 2026 |
| D6 | Non-linear models (exponential, power, custom) get a proper Levenberg–Marquardt least-squares fit, with uncertainties from that fit. Log-linearised fits are used only as starting guesses. | 15 Nov 2026 |
| D7 | Source is in the public GitHub repo `atwseoper/web-graphing-calc`. It is deployed to GitHub Pages by GitHub Actions on every push to `main`. | 15 Nov 2026 |
| D8 | Licence: PolyForm Noncommercial 1.0.0. Free for personal and non-commercial use; commercial use is not permitted. | 15 Nov 2026 |
| D9 | No npm dependencies at all, including dev tooling. A small in-house bundler (`build/bundle.mjs`) replaces esbuild, and tests use Node's built-in runner. | 15 Nov 2026 |
| D10 | User variables and functions have single-letter names (optionally subscripted, `a_1`). This makes implicit multiplication unambiguous: `xy` = x·y, `sinx` = sin(x). | 15 Nov 2026 |
| D11 | Implicit multiplication has the same precedence as `*` and `/`, evaluated left to right, so `1/2x` = (1/2)·x. | 15 Nov 2026 |
| D12 | Errors in the row being typed are shown only after a short pause, so half-typed expressions don't flash warnings. Graphs update on every keystroke. | 15 Nov 2026 |
| D13 | Polar θ and parametric t ranges default to 0…2π (0…360 in degree mode). Each row can set its own range. | 15 Nov 2026 |
| D14 | Calc and Solve are full-page tabs (no graph). Graph and Data keep the graph visible, because Data's fitted curves need it. Solve has a "Show on graph" action. | 15 Nov 2026 |
| D15 | Conditions use braces: `{x < 0: -x, x}` (piecewise) and `x^2{0 < x < 2}` (restriction: undefined outside). Comparisons are only allowed inside braces; plain inequalities stay P3. | 16 Nov 2026 |
| D16 | Derivatives are written `f'(x)`, `f''(x)` on user functions. `y = …` rows get their derivative from the analysis panel. Symbolic where possible; gamma, nCr, ! and similar fall back to a numeric derivative. | 16 Nov 2026 |
| D17 | Σ and Π are `sum(expr, k, from, to)` and `prod(…)` (the TI-89 order). The counting letter is local to the sum. `sum` and `prod` are now reserved words. | 16 Nov 2026 |
| D18 | Graph analysis has no menus: tapping a curve (or focusing its row) selects it and shows its roots, extrema, y-intercept and intersections as tappable dots, for the visible range only. A per-row analysis panel adds the derivative, value/gradient/tangent at x, a definite integral (shaded) and, for polar rows, the area ½∫r² dθ. | 16 Nov 2026 |
| D19 | Sliders: any `a = number` row gets a slider (default range −10…10, widened to include the value; min and max editable). Undefined letters in a row are offered as "Add slider" chips. | 16 Nov 2026 |
| D20 | The Solve tab has three modes: Equation (any one unknown, others given values, numeric search over a range that widens automatically from ±10 to ±10⁶), Polynomial (all roots including complex, with multiplicities) and System (linear, any size up to 12 unknowns, reporting no / infinitely many solutions). | 16 Nov 2026 |
| D21 | Animated θ sweep for polar graphs moves to Phase 4 (polish), as it isn't needed for parity with a handheld. | 16 Nov 2026 |
| D22 | Help is a "?" button in the tab bar, opening a dialog on the page for the current screen (Graph, Data, Solve, Calc, plus Typing). Solve also shows a one-line description of each mode under the mode buttons. Moved forward from Phase 4. | 16 Nov 2026 |
| D23 | Symbols on a computer keyboard: typing theta, pi, <= and >= turns them into θ, π, ≤, ≥ as you type. A keypad button in the tab bar (hidden on touch-first devices) switches the on-screen keypad on or off. | 16 Nov 2026 |
| D24 | The keypad's {} page swaps sec (still typeable) for an Ans key. A capital R, Y or X where the graph letter was meant gets a specific error ("use a lowercase r"); names stay case-sensitive. | 16 Nov 2026 |
| D25 | Decimal commas are supported in data, not in expressions. CSV/paste import detects the decimal separator (and thousands separators) with a manual override, and data-table cells accept `3,14` as well as `3.14`. Expressions keep the dot, because the comma separates arguments. | 16 Nov 2026 |
| D26 | The Data tab holds several named data sets, each with its own colour and show/hide, and each can carry any number of fits drawn together for comparison. Visible data sets and fits are drawn on the graph in every tab that shows it. | 16 Nov 2026 |
| D27 | Built-in models: line, polynomial (degree 2–6), exponential a·e^(bx), power a·x^b, logarithmic a + b·ln x, logistic c / (1 + a·e^(−bx)), sinusoidal a·sin(bx + c) + d, Gaussian a·e^(−(x−b)²/(2c²)), plus custom models. In a custom model the parameters are the letters not defined in the Graph tab (defined ones are fixed constants). A model that is linear in its parameters (checked symbolically) is solved exactly by QR; any other model by Levenberg–Marquardt. | 16 Nov 2026 |
| D28 | Imported cells that aren't numbers are listed in the import preview and kept as blank table cells for the user to fix; rows with a blank x or y are left out of fits. | 16 Nov 2026 |
| D29 | Phase 3 is delivered as three pull requests (data import and table; linear fits and statistics; non-linear fits, bands, residuals, weights and export), each merged once tests and the build pass. | 16 Nov 2026 |
| D30 | Weighted fits treat σy as absolute errors: Cov = (JᵀWJ)⁻¹ and 95% intervals use the normal quantile. The card reports χ², χ²/dof and P(χ²) and says when χ² disagrees with σy. Prediction bands are drawn for unweighted fits only. | 16 Nov 2026 |
| D31 | In a custom model, a parameter letter followed by brackets multiplies: `a(1 − e^(−b x))` = a·(1 − e^(−b x)), and `a(x + 1)^2` = a·(x + 1)². (In Graph rows an undefined letter before brackets is still an unknown function.) | 16 Nov 2026 |
| D32 | Custom models are fitted after a short pause in typing, and non-linear fits have a time budget (about 0.4 s) spread over several starts; a fit that stops early says so and offers starting values. | 16 Nov 2026 |
| D33 | Phase 4 takes all the optional extras: shaded inequalities, implicit curves, slope fields with ODE solution curves, a slider play button with a step setting, Add to Home screen, pretty-printed input and non-linear systems, plus undo, sharing, PNG export and the θ sweep. It is delivered as four pull requests (4a polish; 4b motion and display; 4c new graph types; 4d non-linear systems). | 16 Nov 2026 |
| D34 | Undo covers rows, data sets and fits, Solve inputs, and the angle and grid settings, but not pan/zoom, the open tab, the keypad setting or the Calc history. Rapid edits to one field (typing, dragging a slider) merge into one step; a pause of 1 s or moving to another field starts a new one. Buttons at the top left of the graph; Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y. The Calc line and the paste box keep the browser's own undo. | 16 Nov 2026 |
| D35 | A share link carries the whole project (rows, view, angle and grid, Solve inputs, data sets and fits) as deflate-compressed JSON in the URL fragment (`#g=…`), so nothing is uploaded. Links over 8,000 characters are refused with a pointer to the project file. Opening a link or a project file replaces the current work as one undoable step and keeps the user's keypad setting and Calc history. *(Links ask before opening from Phase 5: D47.)* | 16 Nov 2026 |
| D36 | “Save image” renders the current view at 2× (or the screen's pixel ratio, up to 4096 px) with a key underneath listing the visible graphs, data sets and fits (with their rounded equations) in their colours. On phones it opens the share sheet. | 16 Nov 2026 |
| D37 | Add to Home screen: the web app manifest and icons are generated on the page as data: URLs when it is served over http(s), so the file stays self-contained. There is no service worker, so the installed app needs a connection to start unless the browser has it cached. *(Offline start added by D45.)* | 16 Nov 2026 |
| D38 | Pretty-printed input: under a Graph row, the parsed expression is drawn as maths (stacked fractions, powers, radicals, |x|, log bases, Σ/Π with limits, subscripts) whenever that shows something the typed text doesn't, so the user can check how it was read (`1/2x` = ½·x). Fractions inside exponents stay on one line. A setting hides it. The same layout gives one-line Unicode text (x², √x, a₁) for the key of exported images. | 16 Nov 2026 |
| D39 | Slider play button and step: ▷ moves a slider back and forth across its range (one crossing takes 4 s), snapping to the step. The step field (empty = automatic, about 1/200 of the range) also applies to dragging. Playing stops when the slider is dragged, the row stops being a slider, or the page is hidden. A whole play counts as one undo step. | 16 Nov 2026 |
| D40 | θ sweep: ▷ beside a polar (or parametric) row's range draws the curve as θ (or t) runs from the start of the range to the end over 4 s. The rest of the curve shows faintly; the current point is labelled with its θ or t, and for polar curves the radius from the origin is drawn. | 16 Nov 2026 |
| D41 | Implicit curves: any equation in x and y that isn't solved for one of them (`x^2 + y^2 = 9`, `y = x + sin(y)`, `sin(x) = cos(y)`) plots F(x, y) = left − right = 0 by marching squares on a 4 px grid (8 px while panning), with bisection on each crossing, the cell centre for saddles, and poles rejected when |F| at a segment's midpoint exceeds every corner. Implicit curves can be traced (snapped to the curve by Newton steps) but have no points of interest. | 16 Nov 2026 |
| D42 | Inequalities are whole Graph rows: `y < x^2`, `x >= sin(y)`, `x^2 + y^2 <= 4`, chains like `0 < y < x`. A lone y or x against an expression in the other variable is shaded exactly to the edge of the graph; anything else is tested on the grid, with each comparison's edge drawn only where the other comparisons hold. < and > edges are dashed, ≤ and ≥ solid. Comparisons are still only allowed in braces anywhere else, and inequalities can't be used in Calc or Solve. | 16 Nov 2026 |
| D43 | Slope fields: `y' = f(x, y)` or `dy/dx = f(x, y)` draws short marks on a 30 px grid fixed to the plane. “+ Solution curve” then a tap on the graph adds a starting point (up to 12 per row, kept in the row and removable as chips); each solution is integrated by RK4 both ways across the visible x range, stopping when it leaves the view by more than its height. | 16 Nov 2026 |
| D44 | Non-linear systems in the Solve tab's System mode: when any equation isn't linear, the system must have as many equations as unknowns (at most 6). It is solved by damped Newton (Levenberg–Marquardt, with exact symbolic Jacobians where possible) from about 240 starting points spread over −10…10 for each unknown (a grid for up to 3 unknowns, a Halton sequence beyond), widening to ±1000 if nothing is found, within a time budget. Every different solution is listed with its residual, and the note says the search can miss solutions. With two unknowns, “Show on graph” adds each equation (as an implicit curve where needed) and the solution points. Linear systems are still solved exactly. | 16 Nov 2026 |
| D45 | Exception to D5 for the GitHub Pages site only: the build also writes `dist/sw.js`, a service worker, so the installed app (phone home screen, or Chrome/Edge on Windows) starts with no connection. Browsers only register a service worker from a real same-origin script URL (`data:` and `blob:` are refused), so it can't be inlined. `graphcalc.html` stays fully self-contained and skips registration when opened from disk. The worker caches only the page itself and fetches nothing else. Updates arrive in the background: launches always use the saved copy, the browser fetches a new `sw.js` (which changes with every build) and caches the new page, and the page then shows a “New version · Reload” toast. Tapping it saves the work, activates the new version and reloads. | 18 Nov 2026 |
| D46 | Version 2 roadmap, in this order: Phase 5 offline app and shared-link confirmation; Phase 6 draggable points and visual calculus; Phase 7 log axes and statistics; Phase 8 photo digitiser; Phase 9 lists, curve families and sequences; Phase 10 notes, folders and examples (section 7.1). Each phase is delivered as staged pull requests, merged once tests and the build pass, with its open questions (section 9) settled before coding starts. Notes rows were at first ruled out, because shared links could carry abusive text. They are back in because links will ask before opening (D47), notes are plain text only (no links or formatting), and free text could already arrive in data set names and unparsed rows. | 18 Nov 2026 |
| D47 | Shared links ask before opening. When the page opens with a `#g=…` link, or the link changes, the project is decoded and checked first; nothing replaces the current work until the user agrees. A dialog, “Open a shared project?”, says that the link holds graphs and data from someone else and should only be opened if the user trusts where it came from, and that it replaces what is on screen (undoable). It gives a factual summary (for example “4 graphs, 1 data set with 2 fits”), never text from the project itself. Open and Cancel buttons; Cancel has the focus, and Escape or tapping outside cancels. Cancel keeps the current work and clears the link from the address bar. Damaged links show the existing error with no dialog. Project files the user picks themselves, and the built-in examples (Phase 10), open without asking. The rule is to ask whenever a project could open without the user deliberately choosing it, so if the installed app ever opens project files directly (manifest file handling), those ask too. | 18 Nov 2026 |
| D48 | Version 2 open questions settled (section 9, Q4–Q22). Changes to the plan: points whose coordinates are linked through sliders, such as `(a, 2a)`, are draggable in 6a; the summary card offers a choice of quartile method; slope fields work on log axes too; perspective correction joins Phase 8, because a general calibration mapping is simpler to build once than to rework later. Hypothesis tests and confidence intervals, data-set columns in expressions, and opening project files directly in the installed app are kept for later (section 7.2). | 18 Nov 2026 |
| D49 | Phase 5a details. The worker's cache name is the build stamp plus a hash of the built page (`web-graphing-calc v1.0.0 abc1234 2026-11-18 <hash>`), so `sw.js` changes whenever the page does, even for two builds of one commit, and it only deletes caches with its own prefix (every github.io project shares one origin). It answers `./`, `./index.html` and `./graphcalc.html` (any query string) from the one saved copy. Besides the browser's own check on each launch, the page asks for an update when the app comes back to the foreground, at most hourly, so an app left open still hears about new versions. The “New version · Reload” toast is a lasting toast: it has no timer, and if a short toast (such as “Opened a shared graph · Undo”) takes its place, it comes back when that one goes. Closing it with × leaves the new version to start next time every window is closed. | 18 Nov 2026 |
| D50 | Phase 5b details. The dialog's summary is worked out by parsing the rows only, never evaluating them, so a hostile link can't stall the page before the user agrees. Rows count as graphs (y/x/r = …, slope fields, implicit curves, inequalities, f(x) = …, parametric curves, expressions in x or θ), points (pairs without t) or “other rows” (variables, other functions, calculations, rows with errors); then data sets with their fits, and “Solve inputs” if any are filled in. Only counts appear (“2 graphs and 1 data set with 2 fits”), and a test checks that text from the project never does. The link leaves the address bar as soon as it is read. Open merges the project with the work as it is at that moment. A link that is still being decoded when a newer one arrives is dropped. | 18 Nov 2026 |
| D51 | Phase 6a details. A point row gets a handle when its coordinates use one or two sliders and nothing else they use depends on those sliders (`c = 2a` then `(c, a)` isn't draggable, since only the coordinates are re-evaluated during a drag). `(a, 3)` and `(2, a)` follow the finger along their axis; any other one-slider point moves along its path, searched over the slider's range plus half its width each side (so one drag can carry it a little past the ends), staying on the nearby branch where the path crosses itself; two sliders are found by damped Newton steps measured on screen, and the point has no handle where the Jacobian's condition number is over 10⁶ (`(a + b, 2a + 2b)`). Values snap to each slider's step and are written as plain decimals (never `1e-7`, which would read as 1·e − 7). A drag past a bound the user typed moves that bound; empty bounds widen by themselves (D19). The undo history has explicit groups, so a whole drag is one step even when it changes two sliders and a bound. Handles are hit within 22 px on touch (12 px with a mouse), before points of interest, curves and panning; a second finger ends the drag and starts a pinch. Exported images draw plain points. | 18 Nov 2026 |
| D52 | Taylor polynomials are worked out by Taylor-mode differentiation (truncated power series pushed through the expression), not by repeated symbolic derivatives as first planned in 7.1. Repeated derivatives grow exponentially: the 10th derivative of 1/(1 + x²) has millions of terms and takes seconds, and √(1 + x) hits the nesting limit by the 8th. Power series are exact up to rounding, cost O(n²) per operation, and cover everything the parser accepts: arithmetic and powers, every built-in function (inverse functions by integrating their derivative), user functions and f′(x), piecewise functions (the branch that holds at x0, or both sides if they agree on a boundary), and Σ/Π with fixed bounds. Q8 is unchanged: gamma, nCr, nPr and ! have no polynomial (beyond degree 0), and the panel names the function; corners and jumps (|x| at 0, floor at a whole number) say the function isn't smooth there. | 18 Nov 2026 |
| D53 | Phase 6b details. Defaults: Riemann n = 10 (1–200), Taylor degree 3 (0–10) about the panel's x (At x, or 0), secant h = 1 at the panel's x (or 0). A Riemann sum uses the integral range and replaces its smooth shading with the rectangles or trapezia, with the sample points marked; the panel shows the sum, the Gauss–Kronrod value and the difference. The Taylor polynomial is drawn dashed with its centre marked; Add to graph inserts it below the row as `y = c0 + c1(x − x0) + …`, with 10 significant figures and no `e` notation (tiny coefficients are written ·10^(k)). The secant is drawn short-dashed through both points, with the tangent faint when At x is empty; ▷ shrinks h to a thousandth of its value over 4 s. The shrinking h is not saved or undoable, like the view; the row's own h is unchanged. The new row fields (riemann, riemannN, taylor, taylorN, taylorAt, secant, secantH) are saved, shared and undoable like the rest of the row. | 18 Nov 2026 |
| D54 | Fitted values that are only rounding noise are set to exactly zero, so an exact fit of y = x² to (1, 1)…(4, 16) gives `y = x^2`, not `-6.2e-15 + 1.8e-15x + 1x^2`. Polynomials: a coefficient is zeroed when it is within 2·ε·(1 + κ)·max\|rₖ\|·Σₖ\|Tⱼₖ\|, where r are the centred coefficients, κ the condition number of the centred problem and T the conversion to powers of x (tested on thousands of random exact polynomials: actual errors stay within this bound 99% of the time). Other models: when zeroing it changes the fitted values at the data points by at most 10⁻¹¹ of the size of the sum that produces them (largest Σ\|pⱼgⱼ(x)\| for models linear in their parameters, largest \|y\| otherwise). The same test stops “poorly determined” notes for parameters whose standard error is itself rounding noise. The fitted curve and standard errors are unchanged. Equations are rounded to the 12 printed significant figures before simplifying, so 1.0000000000000002x² prints as x². | 20 Nov 2026 |
| D55 | Phase 7a details. The view is kept in axis coordinates (u = log₁₀ x on a log axis), so pan and zoom are multiplicative there and the view saved with a project records which axes were log; switching an axis keeps the visible range where it can (a range reaching 0 shows three decades below its top) and otherwise goes to the log home range, 0.1 to 1000. Log axes and their view are part of saving, sharing and undo, like the angle and grid settings. Choosing a log axis switches the grid to Cartesian, and Polar is disabled while either axis is log. Ticks: labelled powers of ten with minor lines at 2–9 (from 60 px per decade), 1-2-5 labelled (from 250 px), linear-style steps once less than about a third of a decade shows (1500 px), and a labelled line every 2, 5, 10… decades when zoomed far out; labels are decimals between 10⁻³ and 10⁵ and powers of ten (10⁶, 2×10⁶) beyond. Solution curves of slope fields are integrated in axis coordinates, dv/du = f·(dx/du)/(dy/dv), which is the same ODE with steps evenly spaced on screen. On a log y axis, integrals, bands, error bars and Riemann rectangles are filled down to the bottom edge; points of interest are searched for evenly in log x, with no y-intercept on a log x axis. The residual plot puts x on a log scale when the graph's x axis is log. Labels the canvas edge would cut are no longer drawn (on linear axes too). | 20 Nov 2026 |
| D56 | Phase 7b details. Distribution functions take the TI-84's argument order, and a cdf takes either one limit, giving P(X ≤ x), or two, giving P(a ≤ X ≤ b): `normalpdf(x, μ, σ)`, `normalcdf(x)` or `normalcdf(a, b, μ, σ)`, `invnorm(p, μ, σ)`, `tpdf(x, ν)`, `tcdf(x, ν)` or `tcdf(a, b, ν)`, `invt(p, ν)`, `chi2pdf(x, k)`, `chi2cdf(x, k)` or `chi2cdf(a, b, k)`, `binompdf(n, p, x)`, `binomcdf(n, p, x)` or `binomcdf(n, p, a, b)`, `poissonpdf(μ, x)`, `poissoncdf(μ, x)` or `poissoncdf(μ, a, b)` (also written χ2pdf, χ2cdf; any case). Intervals are worked out in whichever tail keeps its digits. A discrete pdf is 0 between whole numbers and a discrete cdf is a step function. The continuous ones have exact derivatives and Taylor series (with constant parameters); inverse cdfs and discrete ones don't offer Taylor polynomials. A graph whose counting argument is x (`y = binompdf(10, 0.3, x)`, also through user functions) is drawn as stems at whole numbers: tracing snaps to them, it has no points of interest, and its Analyse integral becomes Σ over the whole numbers in the range, with those stems shaded. The functions aren't on the on-screen keypad (its pages and bar are full); they are typed. Data sets: “Show as” Points, Histogram or Box plot, of the x or y column (a single pasted column, which goes in y, defaults to y). Histogram bins start at whole multiples of the width and include their left edge; the automatic width is Freedman–Diaconis (Sturges' rule when the IQR is 0) rounded up to 1, 2 or 5 × 10ⁿ, at most 500 bins. Box plots are horizontal, in a band of fixed height near the top of the graph that follows the x axis, with Tukey's 1.5 × IQR fences. Fits are drawn with points only. The summary card (collapsible) gives both columns' statistics and r; points left out of fits are left out of statistics too, and each column counts its own values, so a single column works. The quartile method is a project setting (saved, shared and undoable, like the angle), chosen on the card. Fit (zoom) counts data sets in full rather than trimming them like sampled curves. | 20 Nov 2026 |
| D57 | Phase 6c: Taylor polynomials go up to degree 30 (Taylor-mode series stay accurate to full double precision well beyond that, D52; 30 covers classroom convergence demos with room to spare). Coefficients are shown as exact fractions wherever they are certainly rational, and never otherwise: a second pass repeats the series in BigInt fractions and gives up at the first value it can't be sure of, rather than guessing fractions from decimals (any decimal is close to some fraction). Exact are numbers as typed with at most 15 significant digits (0.1 is 1/10), sliders and variables through their definitions, + − × ÷, rational powers with exact roots, e^u, sin, cos, tan, atan, asin, sinh … where u is 0 at x0, ln u where u is 1, floor, abs, min/max, mod, piecewise branches, Σ/Π, nCr/nPr/gamma/! of whole numbers, and x0 fields such as `1/3`; derivative bodies (f′) trust only safe whole numbers, since derive folds decimals in floating point. Anything else (π, e, sin 1, √2, degrees mode, distributions) leaves the coefficients as 10-figure decimals, and the exact pass must agree with the decimal one. Exact fractions are never turned into decimals, whatever their size: denominators over a million that are exactly m! are written m! (x³⁰/30!), others in full. The panel shows all terms when there are up to 6 non-zero ones, otherwise the first 3 and last 2 with “Show all n coefficients”, which opens a scrolling table of k and cₖ (zeros included). Add to graph writes the exact fractions (`y = 1 + x + x^2/2 + … + x^30/30!`). A general “show results as fractions” feature was considered and dropped: other results come from numerical methods, so fractions there would be guesses. | 20 Nov 2026 |
| D58 | Phase 8a, the digitiser's mapping (`data/digitise.js`). Every calibration becomes one 3 × 3 homography from image pixels to axis coordinates (log₁₀ of the value on a log axis). *Axes*: the x value of a point is read along the x axis, moving parallel to the y axis and vice versa (the linear part maps x₂ − x₁ to (Δu, 0) and y₂ − y₁ to (0, Δv)), so a rotated or skewed image works and the reference points needn't be at 0 or where the axes cross; axes within about 3° of parallel are refused. *Known length* is always linear (a length in a photo has no meaning on a log axis); the origin's values default to (0, 0) and +y is a quarter turn anticlockwise from +x as seen. *Four points*: the 8 × 8 system is solved on normalised coordinates (centred, mean distance √2) so that pixel values in the thousands and values like 10⁻⁶ or 10⁷ stay well conditioned; three points in a line (on the photo or in their values) and point orders that would fold the photo over (w changing sign across the four points, usually two points' values swapped) are refused with a message naming the points. Image points beyond the photo's horizon map to nothing. Digitised values are rounded to one decimal place below the first significant digit of what one image pixel is worth at that point, so they carry no false precision, and the data set is sorted by x. A faint grid of the calibrated axes (1-2-5 per decade on log axes over three decades or fewer) is drawn over the photo so the calibration can be checked by eye. | 21 Nov 2026 |
| D59 | Phase 8b, the digitising view (`ui/digitiser.js`). “From a photo” is a fourth start option on the Data tab (an `image/*` picker, which offers the camera on phones); dropping an image on the page or pasting one (Ctrl+V on the Data tab) opens it too. The image is decoded with EXIF rotation applied, kept at most 4096 px on its longest side (canvas limits on phones), and only in a canvas that is emptied on closing; it never enters the state. The view is full screen, with the photo above and a panel below (beside it in landscape ≥ 720 px). Step 1, Calibrate: method, linear/log per axis (hidden for known length, which is linear), a row per reference point with its values, and messages from 8a naming the points at fault; a tap on a marker still to be placed places the active one there, so x₁ and y₁ can share the origin. The bar's main button is Next, enabled once the calibration works. Step 2, Tap points: the button becomes “Add N points”. Touch: tap places; press and hold (300 ms) shows a magnifier (4 × the current zoom, above the finger, with the value under the crosshair once calibrated) and places on release; dragging a marker moves it by the finger's movement rather than to the finger, so it is never hidden; one finger pans, two pinch-zoom. Mouse: click, drag, wheel. Keyboard: arrows nudge (Shift ×10), Delete, Ctrl+Z / Ctrl+Y, Escape. Above 3 × zoom pixels are drawn sharp, for aiming at their edges. Digitised points are drawn as rings so the photo's own marks show through. The view has its own undo for placing, moving and deleting markers (not the project's, which only gets the finished data set as one step). Closing with anything placed takes a second tap. At most 2,000 points per photo. | 21 Nov 2026 |
| D60 | Phase 8c, digitiser guidance. *Axes* calibrations whose two axis lines come out less than 60° apart on the photo (`WARN_AXES_ANGLE`) are still accepted, but with an amber warning in place of “Calibrated” giving the angle and asking whether x₁/x₂ and y₁/y₂ are on their axes rather than on the curve; under about 3° is still refused (D58). Real graphs, even photographed at a slant, rarely have axes under 60° apart, so a smaller angle almost always means markers on the curve (seen in testing: x₁ and y₂ placed on y = x², 10° apart). Known length and four points are unaffected. The calibrate step gains a collapsible “How to use this” guide for the chosen method (when to use it, numbered steps, a note): open when the view opens, closed automatically when the first marker is placed unless it has been toggled by hand. The axes hints now say “on the x axis itself (the horizontal axis line, not the curve)”, and the Data help page says the same. | 25 Nov 2026 |
| D61 | Phase 9 open questions settled (section 9, Q23–Q30), with one change to the plan: data-set columns in expressions move from “later” (7.2, Q12) into Phase 9a. *Indexing:* `L[2]` picks an element, counting from 1 by default (L = [10, 20, 30] gives 20); `L[2...3]` and `L[[1, 3]]` pick several. Settings can switch to counting from 0. That setting is the device's, like the keypad (not undoable, not taken from projects), but project files and share links record their creator's choice, and a project made with the other setting has every position in it shifted by one as it opens (`L[2]` → `L[1]`, `L[k]` → `L[k-1]`, ranges and lists of positions item by item), with the open toast saying so. A position beyond the end, or that isn't a whole number, gives undefined with a warning on the row. *Families:* two lists in one row pair up element by element (`y = a·x + b` with a = [1, 2, 3] and b = [0, 1, 2] draws 3 curves); lists of different lengths use the shorter length with a warning; a family over 50 curves draws the first 50 with a warning. *Data columns:* a data set's columns are lists written `D_1.x`, `D_1.y` (shown D₁.x), D with the data set's number; with only one data set, `D.x` works too. Points left out in the table are left out of the lists, as they are of fits; a row is used when every column that has numbers in it has a number in that row, so x and y stay paired. Columns are live: editing the table updates every expression that uses them. *Sequences:* a sequence starts at the lowest n given a starting value (`u(1) = 1` starts at n = 1; u(0) is then undefined). *Showing lists:* a long list shows its first 3 and last 2 elements and its length (`[1, 4, 9, …, 998001, 1000000]`, 1,000 elements), with “Show all” opening the full list, in Graph rows and the Calc tab alike. Phase 9 is three pull requests: 9a lists and curve families, 9a-2 data columns, 9b sequences. | 27 Nov 2026 |
| D62 | Phase 9a details (`expr/lists.js`). Lists are taken apart before compiling: an expression with lists becomes either one ordinary expression (where every list is used up, as in `mean(L)` or `L[2]`) or one expression per element, so each curve of a family is an ordinary row that compiles, differentiates and samples as before, and rows without lists are left exactly as they were (the same objects). Constant elements are folded as they are made, so arithmetic on a 10,000-element list doesn't compile 10,000 times. List variables must be constant (no x); a function whose body gives a list (`f(x) = L·x`) is inlined where it is used, and one that uses its list up (`g(x) = sum(L)·x`) stays an ordinary function with a derivative. A position that varies, such as a sum's counting letter (`sum(L[k]^2, k, 1, 4)`) or a function's parameter (`f(n) = L[n]`), becomes a lookup the compiler evaluates (undefined outside the list); a fixed position outside the list, or not a whole number, is undefined with a warning (D61). A range's ends and step must be fixed numbers; `[1...10]` counts in steps of 1 (−1 when the end is smaller), `[a, b...c]` in steps of b − a, stopping at the last value that doesn't pass c, with rounding noise removed (0.1·3 is 0.3); a range that never reaches its end, or a step of 0, is an error. List functions: `length`, `sum`, `prod`, `mean`, `median`, `stdev` (n − 1) and `stdevp` (n), each taking one list, plus `min(L)` and `max(L)`; with a single number they treat it as a one-element list; an empty list gives 0 for length and sum, 1 for prod, undefined otherwise. These names are now reserved words (like `sum`). Families are drawn for y = …, x = …, r = …, parametric curves and f(x) = … definitions, in shades of the row's colour from a little darker to a little lighter; a number among curves (`y = [x, 2]`) is a horizontal line; implicit curves, inequalities and slope fields with lists are refused for now, because their grid sampling is too slow fifty times over. Each curve can be traced and is labelled by the list variables that vary (`a = 2, b = 1`), or `2 of 5` for unnamed lists; families have no analysis panel or table. `(L, M)` with numbers draws up to 10,000 points like a data set's, traceable. A list's elements show under its row (not when typed as plain numbers), and Calc results that are lists show the same way; Calc history saves the elements of lists up to 500 long and only the summary of longer ones, so a few large results can't fill the browser's storage. Tapping a list result inserts it when it has at most 50 elements, otherwise its expression in brackets. The keypad's {} page swaps sign, Γ and nPr (still typeable) for [, ] and …; `...` can be typed for …. Settings has “List positions start at 1 / 0”, saved with the device's other settings; projects carry it as `settings.listIndex`, and opening converts positions in every expression field (rows and their boxes, Solve inputs, custom fit models and starting values) with the toast ending “· list positions now count from 1”. | 27 Nov 2026 |
| D63 | Phase 9a-2 details, data-set columns as lists. `D_1.x` is a column node (a dot straight after a name and before a letter); only `D` or `D_<number>` can have columns, and only `.x` and `.y` (σy isn't a column). The number is the data set's id, which never changes or gets reused, so deleting data set 2 can't quietly point `D_3.x` somewhere else; the set's card says “Use its columns in expressions as D₁.x and D₁.y (type D_1.x)”. `D.x` works while there is exactly one data set; with several, the error lists their names. A point is used when it isn't left out and has a number in every column that has any numbers (`data/summary.js` `expressionColumn`), so x and y stay paired, as in fits, and a set of one pasted column works. Column set names aren't variables: they never get “Add slider” chips. The analysis takes the data as a third argument and is worked out again when the data changes, but only if a row (or a custom fit model) mentions a column, so editing a table doesn't redo the Graph tab otherwise; custom fits whose model mentions a column are refitted on any data edit. | 27 Nov 2026 |
| D64 | Phase 9b details, recursive sequences. A one-variable function that calls itself, with starting-value rows `u(0) = …` (any name, any parameter letter, whole n ≥ 0), is a sequence. Its terms are worked out in order from the lowest starting n and remembered for the rest of that analysis, so `u(10^5)` costs one pass and redrawing costs nothing; the rule can call any earlier term (`F(n − 1) + F(n − 2)`), sliders, other functions and list positions (`L[n]`). Terms are defined for whole n from the lowest starting value to 10⁵ (`MAX_SEQUENCE_N`); a term that would need one not yet worked out (`u(n) = u(n + 1)`) is undefined rather than an endless loop. Errors say what is missing: a self-calling function without a starting value (“needs a starting value too, such as u(0) = 1”), a starting value without a self-calling rule, a starting value given twice, not at a whole n ≥ 0, or calling the sequence itself. r, θ and t can't appear in a rule, because they are graph letters (`r = 3` is a polar circle), so examples use a: `u(n) = a·u(n − 1)(1 − u(n − 1))`. Sequences evaluate anywhere, including `u([0...10])`; they have no symbolic derivative or Taylor polynomial. A sequence row is drawn as dots (n, u(n)) for whole n in view, smaller when crowded, traced at whole n, with a table of values starting at its first term and the status “Sequence from n = 0”. “Plot as sequence” (Q18) is a row setting (`sequence`) on y = … rows and one-variable functions (u(n) = 1/n is drawn only with it on); those rows keep their analysis panel when the variable is x, without points of interest. Cobweb diagrams are offered when the rule uses only u(n − 1) and constants, with one starting value: the row's “Cobweb diagram” (`cobweb`) replaces the dots with y = g(x), a dashed y = x and the staircase from (u₀, 0), for `cobwebN` steps (default 20, 1–500); ▷ draws it a step at a time (about 4 s in all, 0.15–0.7 s a step) with the term reached labelled, and zoom-to-fit frames the staircase with y = x at 45°. The bifurcation diagram (Q19) is left for a later pull request (7.2): it needs a separate long-run sampling mode and its own view, which didn't fit this phase. | 27 Nov 2026 |

## 1. Purpose

A modern 2D graphing calculator delivered as one self-contained HTML file. It covers the everyday features of a handheld graphing calculator: multiple graphs, polar and parametric curves, analysis and an equation solver. It also does regression on real data far better than a handheld does. Phones in portrait are the main target, and the same page should work well on tablets and desktops.

## 2. Constraints and principles

- **One output file, zero runtime dependencies.** CSS and JS are inlined at build time, with no CDN links, so the page works fully offline. The only extra file is the service worker that the Pages site serves beside it for offline start (D45).
- **Vanilla JavaScript (ES modules in source) + Canvas 2D.**
- **No `eval()` / `new Function` of user input.** A custom parser builds an AST, and the AST is compiled to closures.
- **Phone first.** Design for about 360–430 px portrait first. Touch targets are at least 44 px.
- **Ease of use over feature count.** Sensible defaults, instant feedback, and inline controls rather than modal menus.
- **Honest numerics.** Results show error estimates, and the app says when it may have missed something.

## 3. Feature catalogue

Priority: **P1** = MVP, **P2** = first full version, **P3** = optional extra, **v2** = version 2 roadmap (phase given in the notes; details in section 7.1).

### 3.1 Expression engine
| Feature | Pri | Difficulty | Notes |
|---|---|---|---|
| Tokeniser + Pratt parser → AST → compiled closure | P1 | Moderate | Precedence, unary minus, right-associative `^` |
| Implicit multiplication (`2x`, `3sin(x)`, `(x+1)(x-1)`) | P1 | Moderate | Documented rules plus visible parse feedback |
| Standard functions and constants; deg/rad toggle | P1 | Easy | |
| User variables and functions (`a = 3`, `f(x) = x^2+1`) | P1 | Moderate | Dependency graph and cycle detection |
| Sliders for free parameters | P2 | Easy | Created automatically for undefined names; play button and step (D39) |
| Piecewise / conditional expressions | P2 | Moderate | |
| Symbolic differentiation on the AST | P2 | Moderate | Exact f′ for plotting, extrema, Newton's method and Levenberg–Marquardt Jacobians |
| Factorial/gamma, nCr/nPr, Σ, Π | P2 | Easy | |
| Lightweight pretty-printing of input | P3 | Moderate | Done (D38): custom renderer, no MathJax |
| Probability distributions (normal, t, χ², binomial, Poisson: pdf, cdf, inverse) | v2 | Moderate | Phase 7b |
| Lists and ranges (`[1, 2, 3]`, `[1...10]`); a list in a row draws a family of curves | v2 | Hard | Done in Phase 9a (D61, D62): lists are expanded before compiling |
| Recursive sequences (`u(n) = a·u(n−1)(1 − u(n−1))`, `u(0) = 0.2`) | v2 | Moderate | Done in Phase 9b (D64) |

### 3.2 Cartesian graphing
| Feature | Pri | Difficulty | Notes |
|---|---|---|---|
| Multiple y = f(x), colours, show/hide | P1 | Easy | |
| Pan, pinch-zoom, wheel zoom, double-tap zoom, reset, zoom-to-fit | P1 | Moderate | |
| Adaptive grid and axis labels | P1 | Moderate | 1-2-5 tick spacing (started in Phase 0) |
| Adaptive sampling + discontinuity detection | P1 | Moderate–Hard | No false lines at asymptotes |
| Trace (tap-and-drag along a curve) | P1 | Easy | |
| Parametric x(t), y(t) | P1 | Easy | |
| Table of values | P1 | Easy | |
| x = g(y) curves | P2 | Easy | |
| Points / scatter plots | P2 | Easy | Shared with regression |
| Derivative overlay; shaded integral area | P2 | Easy | |
| Export PNG (share sheet where available) | P2 | Easy | Done in Phase 4 (D36) |
| Inequalities with shading | P3 | Moderate | Done (D42) |
| Implicit curves f(x, y) = 0 | P3 | Moderate | Done (D41): marching squares |
| Slope fields / ODE curves | P3 | Easy–Moderate | Done (D43): RK4 |
| Draggable points (coordinates tied to sliders; points that slide along a curve) | v2 | Moderate | Done in Phase 6a (D51) |
| Log and log-log axes | v2 | Moderate | Phase 7a: sampling, ticks and pan/zoom in log space |
| Histograms and box plots of a data column | v2 | Moderate | Phase 7b |
| Cobweb diagrams for first-order recurrences | v2 | Easy | Done in Phase 9b (D64) |

### 3.3 Polar mode
| Feature | Pri | Difficulty |
|---|---|---|
| r = f(θ) with θ range and step | P1 | Easy |
| Polar grid with degree/π labels | P1 | Easy |
| Polar trace (r, θ and x, y) | P1 | Easy |
| Negative-r handling | P2 | Easy |
| Animated θ sweep – done (D40), parametric curves too | P3 | Easy |
| Polar area ½∫r² dθ | P2 | Easy |

### 3.4 Graph analysis
| Feature | Pri | Difficulty | Method |
|---|---|---|---|
| Roots in visible range | P2 | Moderate | Sign-change scan + Brent; minima of \|f\| for double roots |
| Intersections | P2 | Moderate | Roots of f − g |
| Local maxima / minima | P2 | Moderate | Roots of symbolic f′, or the Brent minimiser |
| Value, gradient and tangent at x | P2 | Easy | |
| Definite integral with error estimate | P2 | Moderate | Adaptive Gauss–Kronrod 7/15 |
| Tappable points-of-interest markers | P2 | Easy | |
| Riemann sums (left, right, midpoint, trapezium) against the exact integral | v2 | Easy | Done in Phase 6b (D53): difference shown against the Gauss–Kronrod value |
| Taylor polynomials of degree n at a point | v2 | Easy–Moderate | Done in Phase 6b: Taylor-mode differentiation (D52); degree 30 with exact fractions and a coefficient table in 6c (D57) |
| Secant → tangent animation | v2 | Easy | Done in Phase 6b (D53) |

### 3.5 Equation solver
| Feature | Pri | Difficulty | Method |
|---|---|---|---|
| One equation, one unknown – all real roots in a range | P2 | Moderate | Scan + Brent, Newton refinement |
| Solve a formula for any variable given the others | P2 | Moderate | Same numeric core |
| Polynomial – all roots including complex | P2 | Moderate | Aberth / Durand–Kerner |
| Linear systems n×n | P2 | Easy | Gaussian elimination with partial pivoting; flags singular systems |
| Show residual and iteration count | P2 | Easy | |
| Non-linear systems | P3 | Hard | Done (D44): damped Newton from many starts |

### 3.6 Data and regression
| Feature | Pri | Difficulty | Notes |
|---|---|---|---|
| Load CSV from file (picker; drag-and-drop on desktop) | P2 | Easy | `<input type="file">` + FileReader, offline. Android picker can read from Drive and Downloads; iOS from Files. |
| Paste CSV / spreadsheet cells | P2 | Easy | Tab-separated data from Sheets or Excel |
| Robust CSV parsing | P2 | Moderate | Quotes, delimiter auto-detection (`,` `;` tab), header detection, BOM, CRLF. Bad cells are reported, not dropped. |
| Import preview and column picker (X, Y, optional σY) | P2 | Easy | |
| Editable data table; include/exclude points | P2 | Easy | |
| Straight line, polynomial (deg 2–6) | P2 | Easy | Linear least squares via Householder QR; x centred and scaled internally |
| Any model linear in its parameters (`a + b·sin x + c·cos x`) | P2 | Moderate | Same QR solver on user basis functions |
| **Non-linear fits: exponential, power, logarithmic, custom models** | **P2** | **Hard** | Levenberg–Marquardt with analytic Jacobian from symbolic derivatives. Starting guesses come from log-linearised fits or sliders. Multiple restarts; convergence diagnostics. |
| R², adjusted R², RMSE, n, degrees of freedom | P2 | Easy | |
| Parameter standard errors, 95% CIs, correlation matrix | P2 | Moderate | Covariance s²(JᵀJ)⁻¹ at the solution, with the Student-t quantile |
| Confidence and prediction bands on graph | P2 | Moderate | Delta method for non-linear models |
| Residual plot | P2 | Easy | |
| Weighted fits (σY), reduced χ², error bars | P2 | Moderate | Promoted from P3 with D6: needed for a proper treatment |
| Send fitted equation to the graph list | P2 | Easy | |
| Export data and results (CSV / clipboard) | P2 | Easy | |
| Validation against NIST StRD datasets | P2 | Moderate | Linear (Norris, Longley, Wampler) and non-linear (Misra1a, Thurber, MGH09 …) certified values in unit tests |
| Summary statistics card (mean, median, SD, quartiles, r) | v2 | Easy | Phase 7b |
| Data-set columns in expressions (`D_1.x`, `mean(D_1.y)`) | v2 | Easy | Done in Phase 9a-2 (D61, D63) |
| Digitise data from a photo or image (axis calibration, then tap points) | v2 | Moderate–Hard | Phase 8: axes, known length or four points (perspective); magnifier; image never stored |

### 3.7 Calculator and general UI
| Feature | Pri | Difficulty | Notes |
|---|---|---|---|
| Calculator rows with history and Ans | P1 | Easy | Rows without x or y evaluate inline |
| On-screen maths keypad | P1 | Easy | Swipeable pages: numbers / functions / letters |
| Live parse errors | P1 | Easy | |
| Light/dark theme (follows system) | P1 | Easy | Done in Phase 0 |
| Auto-save to localStorage | P1 | Easy | |
| Undo/redo | P2 | Easy | Done in Phase 4 (D34) |
| Share via URL fragment; import/export JSON project | P2 | Easy | Done in Phase 4 (D35) |
| Help panel with function reference | P2 | Easy | Done (D22) |
| Add to Home screen (web app manifest) | P3 | Easy | Done in Phase 4 (D37) |
| Offline start for the installed app, with background updates | v2 | Easy | Done in Phase 5a (D45, D49): service worker beside the page on Pages |
| Confirmation before opening a shared link | v2 | Easy | Done in Phase 5b (D47, D50) |
| Notes rows (plain text) and folders | v2 | Moderate | Phase 10a: needs row reordering, which doesn't exist yet |
| Gallery of built-in example projects | v2 | Easy | Phase 10b |

## 4. Layout and visual design

### 4.1 Portrait phone (primary)
- The graph fills the top of the screen, with floating controls at its edges (zoom-to-fit, home, Cartesian/polar, settings).
- A bottom sheet holds the expression list, with snap heights peek / half / full; the graph resizes live.
- The keypad slides up when a row is focused, and the sheet keeps the active row visible.
- Tabs: **Graph · Data · Solve · Calc**. Graph and Data show the graph above the sheet; Solve and Calc use the whole screen (D14). Tabs with the graph come first, so moving through them doesn't make the graph flick on and off.
- Results appear as tappable chips on the graph and as cards in the sheet.

### 4.2 Landscape tablet / desktop
- A side panel on the left (320–380 px) holds the same content as the sheet, with tabs at the top.
- The keypad is optional and hidden by default when a physical keyboard is in use.
- Keyboard shortcuts on desktop.
- Breakpoint: width ≥ 720 px **and** landscape orientation.

### 4.3 Visual style
- Clean and flat, with a system font stack, rounded cards and subtle shadows.
- A curve palette that stays distinguishable in both themes and for common colour-vision deficiencies.
- Restrained motion; respects `prefers-reduced-motion`.

## 5. Architecture

```
src/
  index.html            page shell (also runs unbundled in dev)
  styles/               theme.css, layout.css, ...
  js/
    main.js             entry point
    expr/               tokenizer, parser, compile, model, derive, print, polynomial, solve, format,
                        lists (Phase 9a)
    numerics/           special, roots, minimise, analysis, integrate, poly, linalg, qr, stats, listfns
    data/               number (decimal commas), csv, table
    fit/                models, run (linear fits, statistics), nonlinear (LM), cache
    plot/               viewport, grid, sample-cartesian, sample-polar, render, interact
    state/              store, persist, history
    ui/                 sheet, expr-list, graph-view, keypad, solve-panel, calc-panel, settings, data-panel, fit-panel, export
tests/                  node:test unit tests
build/
  bundle.mjs            zero-dependency ES-module bundler (restricted syntax subset)
  build.mjs             inlines CSS + bundled JS into dist/graphcalc.html (and dist/index.html for Pages);
                        from Phase 5 also writes dist/sw.js, stamped with the build info (D45)
  serve.mjs             static dev server
.github/workflows/pages.yml   test → build → deploy to GitHub Pages
```

**Testing:** pure modules have no DOM access and are unit-tested in Node. The build test checks that the output really is self-contained. Regression code is validated against NIST StRD certified values.

**Size estimate:** P1 ≈ 2,500–3,500 lines; P1 + P2 ≈ 7,000–9,000 lines. Built file roughly 200–450 KB unminified (Phase 2: 268 KB; Phase 3: 434 KB).

**Numerical methods (Phase 2):**
- Roots: sample the range (400 points on the graph, 2,000 in Solve), refine each sign change with Brent's method and polish with Newton steps on the symbolic derivative. A sign change where |f| doesn't fall towards zero is a pole or a jump, not a root. Touching roots (x² at 0) are found as minima of |f| that reach zero. Close pairs the scan stepped over are split at the dip.
- Extrema: strict extrema among the samples, refined as roots of f′ (or with Brent's minimiser), rejected if the refined value runs away from the samples (poles).
- Integrals: adaptive Gauss–Kronrod 7/15 with |K15 − G7| error estimates; undefined values are located and reported, divergence is reported rather than returned as a number.
- Polynomials: closed forms for degree ≤ 2 (cancellation-free quadratic), Aberth–Ehrlich otherwise, Newton polishing; repeated roots are grouped by an ε^(1/m) test and refined as simple roots of the (m−1)th derivative.
- Linear systems: Gaussian elimination with partial pivoting to reduced row echelon form; rank, consistency and free unknowns reported; near-singular systems flagged.

**Numerical methods (Phase 3):**
- CSV: RFC 4180 quoting; the delimiter is chosen by a consistent field count and the share of cells that read as numbers; the decimal separator by votes from cells that can only be read one way (3,14 or 3.14), with ambiguous cells (1,234) leaning to a comma in semicolon files.
- Linear models (detected symbolically: no ∂f/∂pⱼ mentions a parameter): Householder QR with column scaling and pivoting; lines and polynomials are fitted in centred, scaled x and converted back. Validated on NIST Norris, Longley and Wampler 1–4.
- Non-linear models: Levenberg–Marquardt with the symbolic Jacobian, steps from QR of [J; √λD], Marquardt scaling, Nielsen's λ rule; automatic guesses (log-linear fits, logit, periodogram, peak width) and several deterministic starts. Validated on 19 NIST problems from both NIST starting points, including the "higher difficulty" MGH09, MGH10, Thurber, Rat43, Eckerle4, BoxBOD and Bennett5.
- Statistics: s² = RSS/(n − p) and Cov = s²(JᵀJ)⁻¹ (unweighted) or (JᵀWJ)⁻¹ (weighted, D30); Student t quantiles from the incomplete beta function; bands by the delta method, g(x)ᵀ·Cov·g(x).

## 6. Hard parts and risks
- **Plot quality at asymptotes:** adaptive subdivision and jump detection.
- **Missed roots** (tangential or closely spaced): show the searched range and never claim completeness.
- **Phone ergonomics:** prototype the sheet and keypad early, on a real phone.
- **Implicit-multiplication ambiguity:** clear rules and parse feedback.
- **Messy CSVs:** the import preview must make problems visible.
- **Ill-conditioned fits:** use QR rather than normal equations, and scale x internally.
- **Levenberg–Marquardt robustness:** poor starting values can converge to a local minimum or diverge. Mitigate with automatic initial guesses, multiple restarts, parameter scaling, clear convergence reporting, and sliders for manual starting values.
- **Stale installed app (Phase 5):** a broken worker could pin users to an old version. Keep the worker minimal, never cache anything but the page, and keep a plain update path (the browser always re-checks `sw.js` itself).
- **Touch conflicts (Phase 6a, Phase 8):** dragging a handle against panning, and placing points precisely with a finger. Use generous hit targets and a magnifier, and test on a real phone.
- **Abusive text in shared projects (Phases 5b, 10a):** a link could carry offensive or misleading text in notes, folder or data set names, or rows that don't parse. Mitigations: the confirmation dialog (D47), text shown only as plain text with no links, and length caps.
- **List performance (Phase 9a):** a 50-curve family samples 50 curves on every keystroke. Cap the counts and reuse the sampler's adaptive budget.

## 7. Phased delivery plan
| Phase | Scope | Outcome |
|---|---|---|
| 0 – Skeleton ✅ | Repo, build, tests, CI/Pages, responsive shell, theme, static grid | Deployed empty shell, checked on a phone |
| 1 – Core graphing ✅ | Expression engine, Cartesian / parametric / polar plotting, pan/zoom, trace, table, keypad, calculator rows, auto-save | A usable graphing calculator |
| 2 – Analysis & Solve ✅ | Roots, intersections, extrema, integrals, polar area, sliders, derivatives, conditions, Σ/Π, solver tab | Parity with a handheld |
| 3 – Data & Fit ✅ | CSV import/paste, data table, linear and non-linear fits, statistics, bands, residuals, weights, export | Beyond a handheld |
| 4 – Polish & extras ✅ | Undo, sharing, project files, PNG export, home-screen install, θ sweep, slider play, pretty-printing, inequalities, implicit curves, slope fields, non-linear systems | Release |
| 5 – Offline app & safe sharing ✅ | 5a service worker for offline start, background updates with a “New version · Reload” toast; 5b confirmation before opening a shared link | Installed app works with no signal; links can't silently replace work |
| 6 – Drag & calculus ✅ | 6a draggable points; 6b Riemann sums, Taylor polynomials, secant → tangent | Hands-on exploration and teaching |
| 7 – Axes & statistics ✅ | 7a log and log-log axes; 7b summary statistics, histograms, box plots, distribution functions | Parity with a handheld's statistics |
| 8 – Photo digitiser ✅ | Image import, axis calibration, tapping points into a data set | Real-world data straight into fitting |
| 9 – Lists & sequences ✅ | 9a lists, ranges and curve families; 9a-2 data-set columns as lists (D61, D63); 9b recursive sequences, term plots, cobweb diagrams (D64) | Richer expressions |
| 10 – Notes & examples | 10a notes rows, folders and row reordering; 10b built-in examples gallery | Version 2.0 |

Phases 5–10 make up the version 2 roadmap (D46). The order puts the small, self-contained work first: Phase 5 means every later release reaches installed apps through the update toast, and the shared-link confirmation is in place well before notes arrive. Phase 6 builds on code that already exists (sliders, the play mechanics, `derive.js`, the analysis panel). Log axes (7a) come before the digitiser, so calibrating a log-scaled image can reuse the same mapping. Lists (Phase 9) come late because they change the expression engine everywhere. Notes and examples (Phase 10) come last, so the examples can show off everything version 2 adds.

### 7.1 Version 2 phases in detail

**Phase 5 – Offline app and safe sharing (two PRs) ✅**

*5a Offline app*
- `build.mjs` writes `dist/sw.js` from the template `src/sw.js`, with the build info and a hash of the page as the cache name (D49), so every deploy changes the file's bytes. `graphcalc.html` and `index.html` are otherwise unchanged and still self-contained.
- The page registers `./sw.js` only when it is served over https by a built page. The dev server and files opened from disk skip it, and a failed registration (a copy hosted elsewhere without `sw.js`) is silent.
- The worker caches only the page in its scope. On install it saves `./`; it answers requests for pages in its scope from the cache, ignoring query strings (the `#g=` fragment never reaches it); any other request goes straight to the network.
- Updates: the browser fetches a changed `sw.js` and installs it; the new worker caches the new page and waits. The page sees the waiting worker and shows a lasting toast, “New version · Reload”. Tapping it saves the current state, tells the worker to take over and reloads once it has. Nothing reloads without the tap.
- Tests: the build test checks that `sw.js` exists and carries the build stamp, and that `graphcalc.html` still passes the self-contained check; `tests/sw.test.mjs` runs the built worker against fake caches and fetch to check that it saves only the page, answers only page requests in its scope and deletes only its own old caches. Manual check: install on Android and on Windows (Chrome or Edge), go offline, launch; deploy a change and see the toast.
- When running installed (`display-mode: standalone`) and storage isn't already persistent, the page calls `navigator.storage.persist()` once, silently, so neither the saved page nor the auto-saved work is cleared when the device runs short of space. Chrome, Edge and Safari decide this without a prompt; the call isn't made in a browser tab, where Firefox would prompt (Q4).
- CLAUDE.md is updated to match D45.

*5b Shared-link confirmation (D47)*
- `openFromHash` in `main.js` decodes and checks the project as now, then shows the dialog instead of applying it straight away. Open applies it as one undoable step with the existing “Opened a shared graph” toast and Undo. Cancel leaves everything as it was.
- The summary line comes from a pure function in `state/share.js`, `projectSummary` (counts of graphs, points, other rows, data sets and fits; Solve inputs mentioned only if present), so it is unit-tested. It never includes text from the project, and it parses rows without evaluating them (D50).
- The dialog (`ui/share-confirm.js`) reuses the help dialog's modal pattern: focus trapped, Cancel focused first, Escape and the backdrop cancel, 44 px buttons, and it works with the keypad closed.
- A second link arriving while the dialog is open replaces the first in the dialog.

**Phase 6 – Draggable points and visual calculus (two PRs) ✅**
- *6a Draggable points.* A point row whose coordinates are slider variables, such as `(h, k)`, gets a larger handle that can be dragged. Dragging updates the sliders, snaps to their steps and counts as one undo step (as D39 does for play). If both coordinates depend on just one slider, as in `(a, f(a))` or `(a, 2a)`, the point moves along the path it traces as that slider changes, to the place nearest the finger (found by sampling the slider's range, then refining). If they depend on two sliders in a mixed way, as in `(a + b, a − b)`, both are solved for together by Newton steps from their current values, wherever that is well conditioned; otherwise the point isn't draggable. A drag past a slider's min or max widens its range, as typing a value does (D19, Q6). Handles take priority over panning within a 44 px touch target. Deciding which coordinates can be dragged is a pure function of the parsed row, so it is unit-tested.
- *6b Visual calculus*, in the analysis panel of `y = f(x)` rows:
  - Riemann sums over the existing integral range: left, right, midpoint or trapezium (not Simpson's rule, Q9), with n from 1 to 200. Rectangles or trapezia are shaded, and the sum is shown next to the Gauss–Kronrod value with the difference between them.
  - A Taylor polynomial of degree n (0–10, raised to 30 in 6c, D57) about a point (default: the panel's x), drawn dashed in the curve's colour, built by Taylor-mode differentiation (D52; repeated symbolic derivatives were the first plan). It can be added to the graph as a new row. Functions without a full symbolic derivative (gamma, nCr, !) don't offer it, and the panel says why (Q8).
  - Secant → tangent: a secant through x and x + h, with a play button that shrinks h towards 0 and shows the secant gradient approaching f′(x).
  - The new row settings are covered by saving, sharing and undo.

**Phase 7 – Log axes and statistics (two PRs) ✅**
- *7a Log axes.* Each axis can be linear or log, set independently in Settings (giving semi-log and log-log). Ticks are 1-2-5 within each decade, with powers-of-ten labels over wide ranges. Curves are sampled evenly in log x, values ≤ 0 aren't drawn, and pan and zoom are multiplicative. Data points, fits, bands and residuals all follow the axes. Implicit curves and inequalities work as before, since they are computed on a screen grid. Slope fields work too: marks sit on a grid fixed in screen space and point along the slope as it appears on the transformed axes, d(log y)/d(log x) = (x/y)·f on log-log for example, and solution curves are integrated in data space and drawn through the mapping (Q13). Anything at x ≤ 0 or y ≤ 0 on a log axis is not drawn. The polar grid is not offered with log axes. The mapping lives in `plot/viewport.js` and is unit-tested.
- *7b Statistics.*
  - A summary card for each data set: n, mean, median, sample and population SD, min, max, quartiles, IQR, and the correlation r. Quartiles use the TI-84 method (medians of the lower and upper halves) by default, with linear interpolation (as Excel's QUARTILE.INC and R) as the alternative; the choice is on the card, named there, and saved with the project like the angle setting (Q10).
  - A data set can be shown as a scatter plot (as now), a histogram of a chosen column (automatic bin width, editable) or a box plot.
  - New functions, reserved as words like `sum`: `normalpdf`, `normalcdf`, `invnorm`, `tpdf`, `tcdf`, `invt`, `chi2pdf`, `chi2cdf`, `binompdf`, `binomcdf`, `poissonpdf`, `poissoncdf`, with standard defaults (μ = 0, σ = 1). Probabilities show as shaded areas through the existing integral shading. Discrete distributions are drawn as stems at whole numbers.
  - The numerics go in a new pure module, `numerics/distributions.js`. It builds on what `numerics/stats.js` already has for fits (`normalQuantile`, `tCdf`, `tQuantile`, `betaInc`, `gammaP`/`gammaQ`, `lnGamma`) and adds the densities and the discrete distributions. It is tested against published reference values.

**Phase 8 – Photo digitiser (two PRs: 8a the mapping, 8b the digitising view; 8c guidance, D60) ✅**
- “From photo” in the Data tab opens an image (on phones the picker offers the camera) in a full-screen digitising view with pinch-zoom and a magnifier under the finger.
- Calibration, three ways:
  - *Axes*: place two reference points on each axis and type their values. Each axis is linear or log. The mapping is affine, built from the two axis lines, so it allows for a rotated or slightly skewed image.
  - *Known length* (Q15), for real objects with no axes: place an origin and a second point a known distance away, with the axis direction taken from that line; square pixels are assumed.
  - *Four known points* (Q16), for photos taken at an angle: place four points with known coordinates (the corners of a rectangle of known size, or four grid crossings on a photographed graph). The mapping is a perspective transform (homography), found by solving an 8×8 linear system with the existing `linalg.js`.
  - All three are one general mapping (affine being a special case of perspective), so log axes apply to each.
- Then tap to add points; points can be dragged and deleted. “Done” makes a new data set (x, y), ready for fitting.
- The image itself is never stored, in project files or anywhere else; only the points are kept (Q14). The mapping is a pure module, `data/digitise.js`, and is unit-tested.

**Phase 9 – Lists, curve families and sequences (three PRs: 9a, 9a-2, 9b; decisions in D61, details in D62–D64) ✅**
- *9a Lists.*
  - Square-bracket lists `[1, 2, 3]` and ranges `[1...10]` and `[0, 0.5...5]`; list variables `L = […]` (single letters, as D10 requires).
  - Arithmetic and functions apply to each element. A row that uses a list draws one curve per element, in shades of the row's colour. `(L, M)` plots the pairs as points.
  - List functions: `length`, `mean`, `median`, `stdev`, plus the existing `min` and `max`. `sum(L)` with one argument totals a list; with four it is still Σ (D17, Q17).
  - Limits: 10,000 elements per list and 50 curves per family. Analysis points are shown only for single curves.
  - Indexing `L[2]` (from 1, or from 0 by a device setting), slices `L[2...3]`; pairing, length mismatches and the curve cap as D61.
- *9a-2 Data columns (D61, moved here from 7.2).* `D_1.x`, `D_1.y` (or `D.x` with one data set) are lists of a data set's columns, without the points left out of fits; they update as the table is edited.
- *9b Sequences.*
  - A function that refers to itself at n − 1 (or n − 2 …) together with starting-value rows such as `u(0) = 0.2` is a recursive sequence, not a circular definition. It is evaluated with memoisation for whole n ≥ 0, up to n = 10⁵.
  - A per-row “Plot as sequence” toggle draws terms as points (n, u(n)) instead of a curve; it is switched on automatically for recursive rows, and explicit sequences such as `u(n) = 1/n` can use it too (Q18). Sequences evaluate in the Calc tab (`u(50)`).
  - First-order recurrences u(n) = g(u(n − 1)) offer a cobweb diagram: y = g(x), y = x and the staircase, with a play button that adds one step at a time.
  - If 9b has room (Q19), a bifurcation diagram: for a recurrence with a slider, the long-run values plotted against that slider's range (the logistic map's period-doubling route to chaos). Otherwise it moves to a later PR. *It moved (D64, 7.2).*

**Phase 10 – Notes, folders and examples (two PRs)**
- *10a Notes, folders and row reordering.*
  - The add button offers Expression, Note and Folder. Notes and folders are new row kinds in the state, so saving, sharing and undo cover them.
  - A note is plain text, at most 500 characters. It is always shown as text: no HTML, no formatting, and web addresses aren't turned into links. Typing `"` at the start of an empty row turns it into a note (Q20). Notes aren't evaluated, and they're left out of the key on exported images (Q21).
  - A folder is a named row (at most 40 characters, plain text) that groups the rows under it, one level deep. It can collapse, and it can hide or show everything in it in one tap.
  - Rows get a drag handle for reordering; on touch the drag starts after a short press so it doesn't fight scrolling. Dropping a row under a folder puts it in that folder. Row order is otherwise meaningless (section 8), so reordering only changes the display.
- *10b Examples gallery.*
  - An “Examples” section in the help dialog, and a link to it in the empty-list hint, opens a list of about 8–12 built-in projects with a one-line description each.
  - Candidate examples: projectile with a draggable launch angle; Newton's law of cooling fitted to data; Lissajous curves; predator–prey slope field; the logistic map's cobweb diagram; Riemann sums converging; normal-distribution probabilities; a digitised arch fitted with a parabola. The final set is chosen once Phases 6–9 are built (Q22).
  - The examples are project JSON files in `src/examples/`, inlined by the build. Opening one replaces the current work as one undoable step, with no trust dialog (D47). A unit test opens every example and checks that it parses with no errors, so they keep working as the app changes.

### 7.2 Later (not scheduled)
- Hypothesis tests and confidence intervals (z, t, χ²) on data sets (Q11).
- Bifurcation diagrams for recurrences with a slider (Q19, D64).
- Lists in implicit curves, inequalities and slope fields (D62), if a faster grid sampler makes 50 of them practical.
- Opening `.json` project files directly in the installed app (manifest file handling); these would ask first, under D47.

## 8. Expression syntax (as implemented)

| Input | Meaning |
|---|---|
| `y = f(x)`, or just `f(x)` | Graph of y against x |
| `x = g(y)` | Graph of x against y (sideways curves, vertical lines) |
| `r = f(θ)` | Polar graph; type `theta` or use the θ key |
| `(f(t), g(t))` | Parametric curve |
| `(a, b)` | Point |
| `x^2 + y^2 = 9` | Implicit curve: any equation in x and y not solved for one of them (D41) |
| `y < x^2`, `x^2 + y^2 <= 4`, `0 < y < x` | Shaded region; dashed edge for < and >, solid for ≤ and ≥ (D42) |
| `y' = x - y`, `dy/dx = x - y` | Slope field, with solution curves through tapped points (D43) |
| `a = 3`, `b = 2a` | Variables, usable in every row and in the Calc tab |
| `f(x) = x^2` | Function; plotted when its parameter is x. Multi-parameter functions such as `g(u, v) = …` also work |
| `3 + 4`, `f(2)` | Evaluated in place: `= 7` |
| `f'(x)`, `f''(2)` | Derivatives of a user function (D16) |
| `{x < 0: -x, x}` | Piecewise: the first true condition wins, the last item is "otherwise" |
| `x^2{0 < x < 2}` | Restriction: undefined where the condition fails. Comparisons: `< > <= >= ≤ ≥`, chainable |
| `sum(k^2, k, 1, n)`, `prod(k, k, 1, 5)` | Σ and Π (also typed as Σ, Π). Limits are rounded to whole numbers; at most 10⁶ terms |
| `L = [1, 2, 3]`, `[1...10]`, `[0, 0.5...5]` | Lists and ranges (Phase 9a, D62); at most 10,000 elements |
| `y = L·x`, `(L, M)`, `L^2 + 1` | A family of curves, points from two lists, arithmetic on each element |
| `L[2]`, `L[2...4]`, `L[[1, 3]]` | Elements, counting from 1 (or 0, by the device setting, D61) |
| `length(L)`, `sum(L)`, `prod(L)`, `mean(L)`, `median(L)`, `stdev(L)`, `stdevp(L)`, `min(L)`, `max(L)` | Functions of a whole list |
| `D_1.x`, `D_1.y` (or `D.x` with one data set) | A data set's columns as lists, without left-out points (D63) |
| `u(n) = 2u(n - 1) + 1` with `u(0) = 1` | A recursive sequence, drawn as points; `u(5)`, `u([0...10])` (D64) |

- Rows can be in any order. Duplicate and circular definitions are reported on every affected row. A one-variable function that calls itself is a sequence and needs starting values (D64).
- Precedence: `+ −` < `× ÷` and implicit multiplication < unary minus < `^` (right-associative) < `!`. So `-x^2` = −(x²) and `2^3^2` = 2⁹.
- Functions without brackets take the following product of non-function factors: `sin 2x` = sin(2x), `sin x cos x` = sin(x)·cos(x). `sin^2 x` = (sin x)², `sin^-1 x` = asin(x).
- `x2` and `2 3` are errors (missing operator), not 2x or 23.
- A negative base with a fractional exponent p/q (q odd) gives the real root: `(-8)^(1/3)` = −2, so `x^(1/3)` graphs for negative x.
- `sin(π)` shows as 0, and degree mode gives exact values at standard angles (`sin(30)` = 0.5).
- A run of undefined letters before brackets is reported as an unknown function: `set(x)` → "Unknown function 'set'". Defined letters still multiply: with a and b defined, `ab(4)` = a·b·4.
- Built-in functions: sin cos tan sec csc cot asin acos atan (also arcsin…), sinh cosh tanh asinh acosh atanh, exp ln log (log(x, b) for base b), sqrt cbrt abs floor ceil round (round(x, n)), sign min max mod gamma nCr nPr, and postfix `!`. List functions (D62): length sum prod mean median stdev stdevp. Probability distributions (D56): normalpdf normalcdf invnorm tpdf tcdf invt chi2pdf chi2cdf binompdf binomcdf poissonpdf poissoncdf. Constants: π (`pi`), e.

## 9. Open questions
1. ~~CSV files with decimal commas~~ – supported (D25).
2. ~~Which P3 extras to keep~~ – all of them (D33).
3. ~~Slider animation (play button) and a step setting~~ – yes, in Phase 4 (D33).

Version 2 questions, all settled on 18 November 2026 (D48):

*Phase 5*
4. ~~Ask for persistent storage?~~ – yes, silently and only when running installed (7.1, 5a).
5. ~~Should project files also show the shared-project dialog?~~ – no, because they are opened deliberately. Anything that can open with one tap asks (D47).

*Phase 6*
6. ~~Dragging a point past a slider's min or max~~ – widens the range, as typing does (D19).
7. ~~Points with linked coordinates such as `(a, 2a)`~~ – draggable in 6a, along their path or by solving for two sliders.
8. ~~Taylor polynomials without a full symbolic derivative~~ – not offered; the panel says why.
9. ~~Simpson's rule among the Riemann methods~~ – no.

*Phase 7*
10. ~~Quartile method~~ – TI-84 by default, linear interpolation as a choice on the card, saved with the project.
11. ~~Hypothesis tests and confidence intervals~~ – later, if wanted (7.2).
12. ~~Data-set columns in expressions~~ – after Phase 9, as lists (7.2). *Brought forward into Phase 9a: Q28, D61.*
13. ~~Slope fields and implicit curves on log axes~~ – everything works, including slope fields.

*Phase 8*
14. ~~Keep the photo?~~ – never stored; only the points.
15. ~~“Known length” calibration~~ – yes, as a second option.
16. ~~Perspective correction~~ – yes, in Phase 8, as a third calibration option (four known points). It was asked for in a follow-up phase unless simpler in Phase 8, and it is simpler: one general mapping.

*Phase 9*
17. ~~Totalling a list~~ – `sum(L)`, told apart from Σ by the number of arguments.
18. ~~Plotting a row as a sequence~~ – a per-row toggle, on automatically for recursive rows.
19. ~~Bifurcation diagram~~ – yes, if 9b has room; otherwise a later PR.

Further Phase 9 questions, settled on 27 November 2026 (D61):

23. ~~Picking one element of a list~~ – `L[2]`, counting from 1, with a setting to count from 0.
24. ~~Where the counting setting lives~~ – on the device; project files record their creator's choice and positions are converted on opening.
25. ~~Two lists in one row~~ – paired element by element.
26. ~~Lists of different lengths~~ – the shorter length, with a warning.
27. ~~More than 50 curves in a family~~ – the first 50, with a warning.
28. ~~Data-set columns in expressions~~ – in Phase 9a (9a-2), written `D_1.x`, left-out points excluded (this replaces Q12's “later”).
29. ~~Where a sequence starts~~ – at the lowest n given a starting value.
30. ~~Showing long lists~~ – first 3 and last 2 elements with the length, expandable.

*Phase 10*
20. ~~`"` at the start of a row makes a note~~ – yes.
21. ~~Notes in the exported image key~~ – no.
22. ~~Which examples~~ – the candidates in 7.1, revisited once Phases 6–9 are built.
