# Project notes for Claude

- The single deliverable is `dist/graphcalc.html`, built from `src/` by `npm run build`. It must stay fully self-contained: no CDN links, fonts or network requests at runtime.
- No npm dependencies (runtime or dev). Use Node built-ins only (`node:test`, `node:assert`, `node:fs`, ...).
- Source JS is ES modules, but the bundler supports only the subset documented at the top of `build/bundle.mjs`: named imports/exports, relative paths, no default exports, no re-exports, no import cycles, no reassigning exported `let`s.
- Keep maths and parsing modules (`src/js/expr`, `numerics`, `fit`, `data`, `plot/viewport.js`) free of DOM access so they can be unit-tested in Node. Add tests in `tests/` for every such module.
- Never `eval` / `new Function` user input. Expressions go through the project's own parser.
- Design target: portrait phone first (~360–430 px wide), touch targets ≥ 44 px. Landscape ≥ 720 px wide switches to a side panel.
- Before committing: `npm test && npm run build`.
- Design decisions and scope live in `docs/DESIGN.md`. Update its decisions log when scope changes.
- Licence is PolyForm Noncommercial 1.0.0; keep the `Required Notice:` line in README.md and in the built HTML.
