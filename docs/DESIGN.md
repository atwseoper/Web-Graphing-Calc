# Web Graphing Calculator – Design Document

**Status:** v0.4 – Phase 1 (core graphing) complete · **Updated:** 15 November 2026

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
| D14 | Calc and Solve are full-page tabs (no graph). Graph and Data keep the graph visible, because Data's fitted curves need it. Solve will get a "Show on graph" action in Phase 2. | 15 Nov 2026 |

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
| Sliders for free parameters | P2 | Easy | Created automatically for undefined names |
| Piecewise / conditional expressions | P2 | Moderate | |
| Symbolic differentiation on the AST | P2 | Moderate | Exact f′ for plotting, extrema, Newton's method and Levenberg–Marquardt Jacobians |
| Factorial/gamma, nCr/nPr, Σ, Π | P2 | Easy | |
| Lightweight pretty-printing of input | P3 | Moderate | Custom renderer; no MathJax |

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
| Export PNG (share sheet where available) | P2 | Easy | |
| Inequalities with shading | P3 | Moderate | |
| Implicit curves f(x, y) = 0 | P3 | Moderate | Marching squares |
| Slope fields / ODE curves | P3 | Easy–Moderate | RK4 |

### 3.3 Polar mode
| Feature | Pri | Difficulty |
|---|---|---|
| r = f(θ) with θ range and step | P1 | Easy |
| Polar grid with degree/π labels | P1 | Easy |
| Polar trace (r, θ and x, y) | P1 | Easy |
| Animated θ sweep; negative-r handling | P2 | Easy |
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
| Undo/redo | P2 | Easy | |
| Share via URL fragment; import/export JSON project | P2 | Easy | Large data sets go in JSON only |
| Help panel with function reference | P2 | Easy | |
| Add to Home screen (web app manifest) | P3 | Easy | Possible now that the app is hosted on Pages; the manifest can be inlined as a data URL |

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
    expr/               tokenizer, parser, ast, compile, derive, format
    numerics/           roots, poly, integrate, minimise, linalg (LU, QR), stats (t, F quantiles)
    data/               csv, table
    fit/                linear, nonlinear (LM), models, report
    plot/               viewport, grid, sample-cartesian, sample-polar, render, interact
    state/              store, persist, history
    ui/                 sheet, expr-list, keypad, solver-panel, data-panel, fit-panel, calc-panel
tests/                  node:test unit tests
build/
  bundle.mjs            zero-dependency ES-module bundler (restricted syntax subset)
  build.mjs             inlines CSS + bundled JS into dist/graphcalc.html (and dist/index.html for Pages)
  serve.mjs             static dev server
.github/workflows/pages.yml   test → build → deploy to GitHub Pages
```

**Testing:** pure modules have no DOM access and are unit-tested in Node. The build test checks that the output really is self-contained. Regression code is validated against NIST StRD certified values.

**Size estimate:** P1 ≈ 2,500–3,500 lines; P1 + P2 ≈ 7,000–9,000 lines. Built file roughly 200–300 KB unminified.

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
| 2 – Analysis & Solve | Roots, intersections, extrema, integrals, sliders, derivatives, solver tab | Parity with a handheld |
| 3 – Data & Fit | CSV import/paste, data table, linear and non-linear fits, statistics, bands, residuals, weights, export | Beyond a handheld |
| 4 – Polish & extras | Undo, sharing, help, PNG export, then optional P3 items | Release |

## 8. Expression syntax (as implemented)

| Input | Meaning |
|---|---|
| `y = f(x)`, or just `f(x)` | Graph of y against x |
| `x = g(y)` | Graph of x against y (sideways curves, vertical lines) |
| `r = f(θ)` | Polar graph; type `theta` or use the θ key |
| `(f(t), g(t))` | Parametric curve |
| `(a, b)` | Point |
| `a = 3`, `b = 2a` | Variables, usable in every row and in the Calc tab |
| `f(x) = x^2` | Function; plotted when its parameter is x. Multi-parameter functions such as `g(u, v) = …` also work |
| `3 + 4`, `f(2)` | Evaluated in place: `= 7` |

- Rows can be in any order. Duplicate and circular definitions are reported on every affected row.
- Precedence: `+ −` < `× ÷` and implicit multiplication < unary minus < `^` (right-associative) < `!`. So `-x^2` = −(x²) and `2^3^2` = 2⁹.
- Functions without brackets take the following product of non-function factors: `sin 2x` = sin(2x), `sin x cos x` = sin(x)·cos(x). `sin^2 x` = (sin x)², `sin^-1 x` = asin(x).
- `x2` and `2 3` are errors (missing operator), not 2x or 23.
- A negative base with a fractional exponent p/q (q odd) gives the real root: `(-8)^(1/3)` = −2, so `x^(1/3)` graphs for negative x.
- `sin(π)` shows as 0, and degree mode gives exact values at standard angles (`sin(30)` = 0.5).
- Built-in functions: sin cos tan sec csc cot asin acos atan (also arcsin…), sinh cosh tanh asinh acosh atanh, exp ln log (log(x, b) for base b), sqrt cbrt abs floor ceil round (round(x, n)), sign min max mod gamma nCr nPr, and postfix `!`. Constants: π (`pi`), e.

## 9. Open questions
1. CSV files with decimal commas (common in European exports): support now, or only if needed?
2. Which P3 extras (inequalities, implicit curves, slope fields, non-linear systems, home-screen install) to keep?
