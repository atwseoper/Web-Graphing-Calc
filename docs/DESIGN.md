# Web Graphing Calculator – Design Document

**Status:** v0.7 – Phase 4 (polish and extras) in progress · **Updated:** 16 November 2026

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
| D35 | A share link carries the whole project (rows, view, angle and grid, Solve inputs, data sets and fits) as deflate-compressed JSON in the URL fragment (`#g=…`), so nothing is uploaded. Links over 8,000 characters are refused with a pointer to the project file. Opening a link or a project file replaces the current work as one undoable step and keeps the user's keypad setting and Calc history. | 16 Nov 2026 |
| D36 | “Save image” renders the current view at 2× (or the screen's pixel ratio, up to 4096 px) with a key underneath listing the visible graphs, data sets and fits (with their rounded equations) in their colours. On phones it opens the share sheet. | 16 Nov 2026 |
| D37 | Add to Home screen: the web app manifest and icons are generated on the page as data: URLs when it is served over http(s), so the file stays self-contained. There is no service worker, so the installed app needs a connection to start unless the browser has it cached. | 16 Nov 2026 |
| D38 | Pretty-printed input: under a Graph row, the parsed expression is drawn as maths (stacked fractions, powers, radicals, |x|, log bases, Σ/Π with limits, subscripts) whenever that shows something the typed text doesn't, so the user can check how it was read (`1/2x` = ½·x). Fractions inside exponents stay on one line. A setting hides it. The same layout gives one-line Unicode text (x², √x, a₁) for the key of exported images. | 16 Nov 2026 |
| D39 | Slider play button and step: ▷ moves a slider back and forth across its range (one crossing takes 4 s), snapping to the step. The step field (empty = automatic, about 1/200 of the range) also applies to dragging. Playing stops when the slider is dragged, the row stops being a slider, or the page is hidden. A whole play counts as one undo step. | 16 Nov 2026 |
| D40 | θ sweep: ▷ beside a polar (or parametric) row's range draws the curve as θ (or t) runs from the start of the range to the end over 4 s. The rest of the curve shows faintly; the current point is labelled with its θ or t, and for polar curves the radius from the origin is drawn. | 16 Nov 2026 |
| D41 | Implicit curves: any equation in x and y that isn't solved for one of them (`x^2 + y^2 = 9`, `y = x + sin(y)`, `sin(x) = cos(y)`) plots F(x, y) = left − right = 0 by marching squares on a 4 px grid (8 px while panning), with bisection on each crossing, the cell centre for saddles, and poles rejected when |F| at a segment's midpoint exceeds every corner. Implicit curves can be traced (snapped to the curve by Newton steps) but have no points of interest. | 16 Nov 2026 |
| D42 | Inequalities are whole Graph rows: `y < x^2`, `x >= sin(y)`, `x^2 + y^2 <= 4`, chains like `0 < y < x`. A lone y or x against an expression in the other variable is shaded exactly to the edge of the graph; anything else is tested on the grid, with each comparison's edge drawn only where the other comparisons hold. < and > edges are dashed, ≤ and ≥ solid. Comparisons are still only allowed in braces anywhere else, and inequalities can't be used in Calc or Solve. | 16 Nov 2026 |
| D43 | Slope fields: `y' = f(x, y)` or `dy/dx = f(x, y)` draws short marks on a 30 px grid fixed to the plane. “+ Solution curve” then a tap on the graph adds a starting point (up to 12 per row, kept in the row and removable as chips); each solution is integrated by RK4 both ways across the visible x range, stopping when it leaves the view by more than its height. | 16 Nov 2026 |

## 1. Purpose

A modern 2D graphing calculator delivered as one self-contained HTML file. It covers the everyday features of a handheld graphing calculator: multiple graphs, polar and parametric curves, analysis and an equation solver. It also does regression on real data far better than a handheld does. Phones in portrait are the main target, and the same page should work well on tablets and desktops.

## 2. Constraints and principles

- **One output file, zero runtime dependencies.** CSS and JS are inlined at build time, with no CDN links, so the page works fully offline.
- **Vanilla JavaScript (ES modules in source) + Canvas 2D.**
- **No `eval()` / `new Function` of user input.** A custom parser builds an AST, and the AST is compiled to closures.
- **Phone first.** Design for about 360–430 px portrait first. Touch targets are at least 44 px.
- **Ease of use over feature count.** Sensible defaults, instant feedback, and inline controls rather than modal menus.
- **Honest numerics.** Results show error estimates, and the app says when it may have missed something.

## 3. Feature catalogue

Priority: **P1** = MVP, **P2** = first full version, **P3** = optional extra.

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

### 3.5 Equation solver
| Feature | Pri | Difficulty | Method |
|---|---|---|---|
| One equation, one unknown – all real roots in a range | P2 | Moderate | Scan + Brent, Newton refinement |
| Solve a formula for any variable given the others | P2 | Moderate | Same numeric core |
| Polynomial – all roots including complex | P2 | Moderate | Aberth / Durand–Kerner |
| Linear systems n×n | P2 | Easy | Gaussian elimination with partial pivoting; flags singular systems |
| Show residual and iteration count | P2 | Easy | |
| Non-linear systems | P3 | Hard | Damped Newton |

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
    expr/               tokenizer, parser, compile, model, derive, print, polynomial, solve, format
    numerics/           special, roots, minimise, analysis, integrate, poly, linalg, qr, stats
    data/               number (decimal commas), csv, table
    fit/                models, run (linear fits, statistics), nonlinear (LM), cache
    plot/               viewport, grid, sample-cartesian, sample-polar, render, interact
    state/              store, persist, history
    ui/                 sheet, expr-list, graph-view, keypad, solve-panel, calc-panel, settings, data-panel, fit-panel, export
tests/                  node:test unit tests
build/
  bundle.mjs            zero-dependency ES-module bundler (restricted syntax subset)
  build.mjs             inlines CSS + bundled JS into dist/graphcalc.html (and dist/index.html for Pages)
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

## 7. Phased delivery plan
| Phase | Scope | Outcome |
|---|---|---|
| 0 – Skeleton ✅ | Repo, build, tests, CI/Pages, responsive shell, theme, static grid | Deployed empty shell, checked on a phone |
| 1 – Core graphing ✅ | Expression engine, Cartesian / parametric / polar plotting, pan/zoom, trace, table, keypad, calculator rows, auto-save | A usable graphing calculator |
| 2 – Analysis & Solve ✅ | Roots, intersections, extrema, integrals, polar area, sliders, derivatives, conditions, Σ/Π, solver tab | Parity with a handheld |
| 3 – Data & Fit ✅ | CSV import/paste, data table, linear and non-linear fits, statistics, bands, residuals, weights, export | Beyond a handheld |
| 4 – Polish & extras | Undo, sharing, PNG export, animated θ sweep, then optional P3 items | Release |

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

- Rows can be in any order. Duplicate and circular definitions are reported on every affected row.
- Precedence: `+ −` < `× ÷` and implicit multiplication < unary minus < `^` (right-associative) < `!`. So `-x^2` = −(x²) and `2^3^2` = 2⁹.
- Functions without brackets take the following product of non-function factors: `sin 2x` = sin(2x), `sin x cos x` = sin(x)·cos(x). `sin^2 x` = (sin x)², `sin^-1 x` = asin(x).
- `x2` and `2 3` are errors (missing operator), not 2x or 23.
- A negative base with a fractional exponent p/q (q odd) gives the real root: `(-8)^(1/3)` = −2, so `x^(1/3)` graphs for negative x.
- `sin(π)` shows as 0, and degree mode gives exact values at standard angles (`sin(30)` = 0.5).
- A run of undefined letters before brackets is reported as an unknown function: `set(x)` → "Unknown function 'set'". Defined letters still multiply: with a and b defined, `ab(4)` = a·b·4.
- Built-in functions: sin cos tan sec csc cot asin acos atan (also arcsin…), sinh cosh tanh asinh acosh atanh, exp ln log (log(x, b) for base b), sqrt cbrt abs floor ceil round (round(x, n)), sign min max mod gamma nCr nPr, and postfix `!`. Constants: π (`pi`), e.

## 9. Open questions
1. ~~CSV files with decimal commas~~ – supported (D25).
2. ~~Which P3 extras to keep~~ – all of them (D33).
3. ~~Slider animation (play button) and a step setting~~ – yes, in Phase 4 (D33).
