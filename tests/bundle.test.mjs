import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { bundle } from '../build/bundle.mjs';

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-test-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function run(code) {
  const out = [];
  vm.runInNewContext(code, { log: (v) => out.push(v) });
  return out;
}

test('bundles named imports, aliases, namespaces and export lists', () => {
  const dir = project({
    'main.js': `import { add, PI as pi } from './lib/math.js';\nimport * as str from './lib/str.js';\nlog(add(2, 3));\nlog(pi);\nlog(str.shout('hi'));\n`,
    'lib/math.js': `export const PI = 3.14;\nexport function add(a, b) { return a + b; }\n`,
    'lib/str.js': `import { add } from './math.js';\nfunction shout(s) { return s.toUpperCase() + add(1, 1); }\nexport { shout };\n`,
  });
  assert.deepEqual(run(bundle(join(dir, 'main.js'))), [5, 3.14, 'HI2']);
});

test('each module is evaluated once even when imported twice', () => {
  const dir = project({
    'main.js': `import { a } from './a.js';\nimport { b } from './b.js';\nlog(a + b);\n`,
    'a.js': `import { n } from './shared.js';\nexport const a = n;\n`,
    'b.js': `import { n } from './shared.js';\nexport const b = n;\n`,
    'shared.js': `log('shared');\nexport const n = 1;\n`,
  });
  assert.deepEqual(run(bundle(join(dir, 'main.js'))), ['shared', 2]);
});

test('rejects unsupported syntax and cycles', () => {
  const cases = {
    'export default 1;\n': /default exports/,
    "import x from './y.js';\n": /default import/,
    "export { a } from './y.js';\n": /re-exports/,
    "import { a } from 'pkg';\n": /only relative imports/,
  };
  for (const [src, err] of Object.entries(cases)) {
    const dir = project({ 'main.js': src, 'y.js': 'export const a = 1;\n' });
    assert.throws(() => bundle(join(dir, 'main.js')), err);
  }
  const dir = project({
    'main.js': `import { a } from './a.js';\n`,
    'a.js': `import { b } from './b.js';\nexport const a = 1;\n`,
    'b.js': `import { a } from './a.js';\nexport const b = 2;\n`,
  });
  assert.throws(() => bundle(join(dir, 'main.js')), /cycle/);
});
