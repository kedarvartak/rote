import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  auditPackageGraph,
  findCycles,
  findInternalImports,
  renderAudit,
  UNDECLARED_IMPORT_EXEMPTIONS,
} from './check-package-graph.mjs';

const pkg = (name, imports, declared = imports) => ({ name, imports, declared });
const codes = (audit) => audit.problems.map((p) => p.code).sort();

test('a legal graph reports no problems', () => {
  const audit = auditPackageGraph([
    pkg('@rote/core', []),
    pkg('@rote/browser', ['@rote/core']),
    // the cli declares none of its imports on purpose — it is bundled
    { name: '@rotehq/cli', imports: ['@rote/core', '@rote/browser'], declared: [] },
  ]);
  assert.deepEqual(audit.problems, []);
  assert.equal(audit.edges, 3);
});

test('names the cycle a human has to break, not merely that one exists', () => {
  const audit = auditPackageGraph([
    pkg('@rote/core', []),
    pkg('@rote/a', ['@rote/b']),
    pkg('@rote/b', ['@rote/c']),
    pkg('@rote/c', ['@rote/a']),
  ]);
  const cycle = audit.problems.find((p) => p.code === 'cycle');
  assert.ok(cycle, 'expected a cycle problem');
  assert.equal(cycle.detail, '@rote/a -> @rote/b -> @rote/c -> @rote/a');
  assert.deepEqual(cycle.packages, ['@rote/a', '@rote/b', '@rote/c', '@rote/a']);
});

test('reports a two-package cycle once, not once per direction', () => {
  const cycles = findCycles({ '@rote/a': ['@rote/b'], '@rote/b': ['@rote/a'] });
  assert.equal(cycles.length, 1);
});

test('core may depend on nothing internal', () => {
  const audit = auditPackageGraph([pkg('@rote/core', ['@rote/browser']), pkg('@rote/browser', [])]);
  assert.ok(codes(audit).includes('core_depends_internally'));
});

test('the cli is a sink: importing it is a problem even though it is a workspace package', () => {
  const audit = auditPackageGraph([
    pkg('@rote/core', []),
    pkg('@rotehq/cli', ['@rote/core']),
    pkg('@rote/bench', ['@rotehq/cli'], ['@rotehq/cli']),
  ]);
  assert.ok(codes(audit).includes('sink_imported'));
});

test('an import with no matching declaration fails — the executor/action defect this check was written for', () => {
  const audit = auditPackageGraph([
    pkg('@rote/action', []),
    { name: '@rote/executor', imports: ['@rote/action'], declared: [] },
  ]);
  const problem = audit.problems.find((p) => p.code === 'undeclared_dependency');
  assert.ok(problem);
  assert.match(problem.detail, /imports @rote\/action without declaring it/);
});

test('the bundled cli is exempt from declaring its imports', () => {
  const audit = auditPackageGraph([
    pkg('@rote/core', []),
    { name: '@rotehq/cli', imports: ['@rote/core'], declared: [] },
  ]);
  assert.deepEqual(audit.problems, []);
});

test('the exemption goes stale when the exempted package declares everything anyway', () => {
  const audit = auditPackageGraph([
    pkg('@rote/core', []),
    { name: '@rotehq/cli', imports: ['@rote/core'], declared: ['@rote/core'] },
  ]);
  assert.deepEqual(codes(audit), ['stale_exemption']);
});

test('an import of a package that does not exist is reported rather than silently skipped', () => {
  const audit = auditPackageGraph([{ name: '@rote/core', imports: ['@rote/ghost'], declared: ['@rote/ghost'] }]);
  assert.deepEqual(codes(audit), ['unknown_package']);
});

test('finds every import form the codebase uses and attributes deep paths to their package', () => {
  const source = [
    "import { a } from '@rote/core';",
    "import type { B } from '@rote/browser';",
    "export * from '@rote/recorder';",
    "const m = await import('@rote/llm');",
    "import { deep } from '@rote/action/dist/inner.js';",
    "import fs from 'node:fs';",
    "import { z } from 'zod';",
  ].join('\n');
  assert.deepEqual(findInternalImports(source), [
    '@rote/action', '@rote/browser', '@rote/core', '@rote/llm', '@rote/recorder',
  ]);
});

test('ignores imports inside comments so a documented example is not an edge', () => {
  const source = [
    "// import { x } from '@rote/matcher';",
    "/* from '@rote/distiller' */",
    "import { y } from '@rote/core';",
  ].join('\n');
  assert.deepEqual(findInternalImports(source), ['@rote/core']);
});

test('renders a byte-stable report in both outcomes', () => {
  const clean = renderAudit(auditPackageGraph([pkg('@rote/core', [])]));
  assert.equal(clean, '1 workspace packages, 0 internal edges\ndependency graph is acyclic and every edge is declared and legal');
  const dirty = renderAudit(auditPackageGraph([pkg('@rote/core', ['@rote/browser']), pkg('@rote/browser', [])]));
  assert.match(dirty, /1 problem\(s\):\n {2}\[core_depends_internally\] @rote\/core: /);
});

test('the real workspace obeys every rule', async () => {
  const root = resolve(fileURLToPath(import.meta.url), '../../..');
  const packagesDir = join(root, 'packages');
  const packages = [];
  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    try { await stat(join(dir, 'package.json')); } catch { continue; }
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    const declared = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]
      .filter((d) => d.startsWith('@rote/') || d.startsWith('@rotehq/'));
    const imports = new Set();
    const walk = async (d) => {
      for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
        const p = join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (/\.(ts|mts|js|mjs)$/.test(e.name)) {
          for (const s of findInternalImports(await readFile(p, 'utf8'))) imports.add(s);
        }
      }
    };
    await walk(join(dir, 'src'));
    packages.push({ name: manifest.name, imports: [...imports].sort(), declared: declared.sort() });
  }
  const audit = auditPackageGraph(packages);
  assert.deepEqual(audit.problems, [], renderAudit(audit));
  assert.ok(audit.packages >= 15);
  // An exemption naming a package that no longer exists would silently exempt
  // nothing; the pure audit cannot see that, so the real workspace asserts it.
  for (const name of Object.keys(UNDECLARED_IMPORT_EXEMPTIONS)) {
    assert.ok(packages.some((p) => p.name === name), `exemption for ${name} names no workspace package`);
  }
});
