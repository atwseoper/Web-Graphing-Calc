// Zero-dependency ES-module bundler for this project.
//
// It supports a deliberately small subset of module syntax, which all source
// files must stick to:
//   import { a, b as c } from './x.js';
//   import * as ns from './x.js';
//   import './x.js';                       (side effects only)
//   export function f() {}   export async function f() {}   export function* g() {}
//   export class C {}
//   export const x = ...;  export let y = ...;  (one name per statement)
//   export { a, b as c };
// Not supported (the bundler throws): default imports/exports, re-exports
// ("export ... from"), bare/package specifiers, dynamic import(), import cycles.
// Exported bindings are snapshotted at module end, so do not reassign an
// exported `let` after the module has loaded.

import { readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const IMPORT_RE = /^[ \t]*import\s+(?:(\{[^}]*\})|\*\s+as\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*))?\s*(?:from\s*)?(['"])([^'"]+)\4\s*;?[ \t]*$/gm;
const EXPORT_DECL_RE = /^([ \t]*)export\s+(async\s+function\s*\*?|function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /^[ \t]*export\s*\{([^}]*)\}\s*(from\s*['"][^'"]+['"])?\s*;?[ \t]*$/gm;
const EXPORT_DEFAULT_RE = /^[ \t]*export\s+default\b/m;
const EXPORT_STAR_RE = /^[ \t]*export\s*\*/m;

function parseSpecList(braced) {
  // "{ a, b as c }" -> [{ imported: 'a', local: 'a' }, { imported: 'b', local: 'c' }]
  return braced
    .replace(/[{}]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!m) throw new Error(`Cannot parse import/export specifier "${s}"`);
      return { imported: m[1], local: m[2] || m[1] };
    });
}

export function bundle(entryPath, { root = dirname(entryPath) } = {}) {
  const modules = new Map(); // absPath -> { id, code }
  const visiting = new Set();
  const order = [];

  function load(absPath, from) {
    if (modules.has(absPath)) return modules.get(absPath);
    if (visiting.has(absPath)) {
      throw new Error(`Import cycle detected involving ${relative(root, absPath)} (imported from ${relative(root, from)})`);
    }
    visiting.add(absPath);
    let src;
    try {
      src = readFileSync(absPath, 'utf8');
    } catch {
      throw new Error(`Cannot read module ${relative(root, absPath)}${from ? ` (imported from ${relative(root, from)})` : ''}`);
    }
    const rel = relative(root, absPath);
    if (EXPORT_DEFAULT_RE.test(src)) throw new Error(`${rel}: default exports are not supported`);
    if (EXPORT_STAR_RE.test(src)) throw new Error(`${rel}: "export *" is not supported`);
    if (/\bimport\s*\(/.test(src)) throw new Error(`${rel}: dynamic import() is not supported`);

    // Imports
    const deps = [];
    let code = src.replace(IMPORT_RE, (_all, braced, ns, def, _q, spec) => {
      if (def) throw new Error(`${rel}: default import "${def}" is not supported`);
      if (!spec.startsWith('.')) throw new Error(`${rel}: only relative imports are supported ("${spec}")`);
      const depPath = resolve(dirname(absPath), spec);
      deps.push(depPath);
      const dep = load(depPath, absPath);
      if (braced) {
        const parts = parseSpecList(braced).map(({ imported, local }) =>
          imported === local ? local : `${imported}: ${local}`);
        return `const { ${parts.join(', ')} } = ${dep.id};`;
      }
      if (ns) return `const ${ns} = ${dep.id};`;
      return `/* side-effect import ${spec} */`;
    });

    // Exports
    const exported = []; // { exported, local }
    code = code.replace(EXPORT_LIST_RE, (_all, list, from) => {
      if (from) throw new Error(`${rel}: re-exports ("export ... from") are not supported`);
      for (const { imported, local } of parseSpecList(`{${list}}`)) {
        exported.push({ exported: local, local: imported });
      }
      return '';
    });
    code = code.replace(EXPORT_DECL_RE, (_all, indent, kind, name) => {
      exported.push({ exported: name, local: name });
      return `${indent}${kind} ${name}`;
    });
    if (/^[ \t]*export\b/m.test(code)) {
      throw new Error(`${rel}: unsupported export form near "${code.match(/^[ \t]*export\b.*$/m)[0].trim()}"`);
    }

    const id = `__m${modules.size}_${rel.replace(/[^\w]/g, '_')}`;
    const ret = exported.map((e) => (e.exported === e.local ? e.local : `${e.exported}: ${e.local}`));
    const wrapped =
      `// ---- ${rel} ----\n` +
      `const ${id} = (() => {\n${code.trimEnd()}\nreturn Object.freeze({ ${ret.join(', ')} });\n})();\n`;
    const mod = { id, code: wrapped, deps };
    visiting.delete(absPath);
    modules.set(absPath, mod);
    order.push(mod);
    return mod;
  }

  load(resolve(entryPath), null);
  return `(() => {\n"use strict";\n${order.map((m) => m.code).join('\n')}})();\n`;
}
