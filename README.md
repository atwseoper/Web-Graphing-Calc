# Web Graphing Calculator

A modern 2D graphing calculator that ships as **one self-contained HTML file**. It works offline, with no dependencies, and is designed for portrait phones first, then landscape tablets and desktops.

**Live:** https://atwseoper.github.io/Web-Graphing-Calc/

Status: version 1.0. All four planned phases are complete: graphing, analysis and solving, data and curve fitting, and polish and extras. See [docs/DESIGN.md](docs/DESIGN.md) for the full design, feature list and roadmap.

## Features

- Multiple y = f(x), x = g(y), parametric and polar graphs with pan, pinch-zoom and trace; animated θ/t sweep
- Implicit curves (x² + y² = 9), shaded inequalities (y < x², 0 < y < x), slope fields with solution curves (y′ = x − y)
- Expressions shown as written maths (fractions, powers, roots, Σ) under each row
- Variables, functions and sliders (with a play button and step); piecewise conditions `{x < 0: -x, x}`; `f'(x)`; Σ and Π
- Graph analysis: tap a curve to see its roots, extrema, intercepts and intersections; derivative, tangent, integrals with error estimates, polar area
- Equation solver: single equations, solve-for-any-variable, polynomials (complex roots), linear systems and non-linear systems
- Data: open CSV files or paste spreadsheet cells, with automatic detection of separators, decimal commas (1,5) and headers; several data sets; an editable table; σy error bars
- Curve fitting: line, polynomial, exponential, power, logarithmic, logistic, sinusoidal, Gaussian and custom models; exact QR for models linear in their parameters, Levenberg–Marquardt for the rest; standard errors, 95% intervals, R², χ² for weighted fits, confidence and prediction bands, residual plots; export of data and results. Validated against the NIST StRD certified values.
- Undo and redo; share a whole project (graphs, data and fits) as a link, with nothing uploaded; save and open project files; save the graph as a PNG with a key; add it to your phone's home screen

## Development

Requires Node.js 20 or later. There are no npm dependencies.

```sh
npm run dev       # serve src/ unbundled at http://localhost:5173
npm test          # run unit tests (Node's built-in test runner)
npm run build     # produce dist/graphcalc.html (single self-contained file)
npm run preview   # build, then serve dist/
```

Every push to `main` runs the tests, builds the file and deploys it to GitHub Pages (see `.github/workflows/pages.yml`).

### Source layout

```
src/            index.html shell, styles/, js/ (ES modules)
tests/          unit tests for pure (DOM-free) modules
build/          zero-dependency bundler, build script and dev server
docs/           design document
```

The build uses a small in-house bundler (`build/bundle.mjs`) that supports only a restricted subset of ES module syntax. The rules are listed at the top of that file.

## Licence

[PolyForm Noncommercial License 1.0.0](LICENSE.md). It is free for personal, hobby, educational and other non-commercial use. Commercial use is not permitted without separate permission from the author.

Required Notice: Copyright (c) 2026 atwseoper (https://github.com/atwseoper)
