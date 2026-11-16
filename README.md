# Web Graphing Calculator

A modern 2D graphing calculator that ships as **one self-contained HTML file**. It works offline, with no dependencies, and is designed for portrait phones first, then landscape tablets and desktops.

**Live:** https://atwseoper.github.io/Web-Graphing-Calc/

Status: Phase 2 complete – graphing (Cartesian, x = g(y), polar, parametric, points, variables, functions, sliders, conditions, Σ/Π), graph analysis (roots, extrema, intersections, derivatives, tangents, integrals, polar area) and the Solve tab (equations, polynomials, linear systems). Next: Phase 3, data import and regression. See [docs/DESIGN.md](docs/DESIGN.md) for the full design, feature list and roadmap.

## Features

- Multiple y = f(x), x = g(y), parametric and polar graphs with pan, pinch-zoom and trace
- Variables, functions and sliders; piecewise conditions `{x < 0: -x, x}`; `f'(x)`; Σ and Π
- Graph analysis: tap a curve to see its roots, extrema, intercepts and intersections; derivative, tangent, integrals with error estimates, polar area
- Equation solver: single equations, solve-for-any-variable, polynomials (complex roots), linear systems

## Planned

- Data import (CSV file or paste) and regression: linear, polynomial and custom models, with full non-linear least squares, parameter standard errors, confidence bands and residuals

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
