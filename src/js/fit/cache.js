// Remembers fit results until their inputs change. Pure module – no DOM access.
//
// A fit is run again only when its settings, its data set's points or σy setting, or the
// angle unit change, or (for custom models, which may use Graph-tab definitions) the text
// of a definition the model uses. Editing other rows, or moving a slider the model
// doesn't use, keeps the result.
import { analyse } from '../expr/model.js';
import { runFit } from './run.js';
import { customText } from './models.js';

export function createFitCache(run = runFit) {
  const cache = new Map(); // fit id -> { key, points, deps, result }
  const plain = new Map(); // angle -> analysis with no definitions

  function analysisFor(fit, analysis) {
    if (fit.model === 'custom') return analysis;
    const angle = analysis.angle === 'deg' ? 'deg' : 'rad';
    if (!plain.has(angle)) plain.set(angle, analyse([], { angle }));
    return plain.get(angle);
  }

  function result(set, fit, analysis) {
    const an = analysisFor(fit, analysis);
    const key = JSON.stringify([fit.model, fit.degree, fit.custom, fit.weighted, fit.start, set.hasSigma]);
    const deps = fit.model === 'custom' ? analysis.dependencyKey(customText(fit.custom)) : an.angle;
    const c = cache.get(fit.id);
    if (c && c.key === key && c.points === set.points && c.deps === deps) return c.result;
    let r;
    try {
      r = run(an, set, fit);
    } catch (e) {
      r = { error: { message: `The fit failed: ${e && e.message ? e.message : e}`, start: -1, end: -1 } };
    }
    cache.set(fit.id, { key, points: set.points, deps, result: r });
    return r;
  }

  // Every fit of every set: [{ set, fit, result }]. Drops results of deleted fits.
  function all(state, analysis) {
    const out = [];
    const live = new Set();
    for (const set of state.data.sets) {
      for (const fit of set.fits) {
        live.add(fit.id);
        out.push({ set, fit, result: result(set, fit, analysis) });
      }
    }
    for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id);
    return out;
  }

  return { result, all };
}
