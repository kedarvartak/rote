#!/usr/bin/env node
// Enforces the monorepo dependency rules CLAUDE.md states but nothing checked:
// "Dependency direction: everything may depend on core; core depends on nothing
// internal; cli may depend on all. No cycles — CI enforces."
//
// The eslint `no-restricted-imports` rule bans deep paths across packages; it
// says nothing about *which* package may import *which*, and nothing about
// cycles. This closes that gap. Pure functions take the graph as data so the
// rules are testable without a filesystem; only `main` reads the repo.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Packages allowed to import an internal package without declaring it as a
 * runtime dependency, with the reason. `@rotehq/cli` is bundled by esbuild
 * (`packages/cli/build.mjs`) into a self-contained `dist/`, so declaring the
 * workspace packages would publish unresolvable dependencies — the published
 * tarball installs from an empty directory with no @rote/* on the registry
 * (docs/testing/T28-registry-provider-quickstart.md).
 */
export const UNDECLARED_IMPORT_EXEMPTIONS = {
  '@rotehq/cli': 'bundled into dist/ by esbuild; T28 proves the tarball installs standalone',
};

/** Packages nothing else may import: the CLI is the composition root, never a library. */
export const SINK_PACKAGES = ['@rotehq/cli'];

/** The package that must remain free of internal dependencies (CLAUDE.md: "core depends on nothing internal"). */
export const ROOT_PACKAGE = '@rote/core';

const INTERNAL_SCOPES = ['@rote/', '@rotehq/'];

const isInternal = (specifier) => INTERNAL_SCOPES.some((scope) => specifier.startsWith(scope));

/**
 * Extracts internal package specifiers from TypeScript source text.
 *
 * Deliberately regex-based rather than AST-based: the repo has no parser
 * dependency, and CLAUDE.md forbids adding one without justification. The
 * patterns cover every import form the codebase actually uses (static,
 * `import type`, re-export, dynamic `import()`); a form that slips past is a
 * missed edge, never a false failure, and the declared-dependency cross-check
 * catches the common case from the other side.
 */
export function findInternalImports(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const found = new Set();
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of withoutComments.matchAll(pattern)) {
      const specifier = match[1];
      if (!isInternal(specifier)) continue;
      // A deep path is eslint's problem; for the graph, attribute it to its package.
      const parts = specifier.split('/');
      found.add(`${parts[0]}/${parts[1]}`);
    }
  }
  return [...found].sort();
}

/**
 * Finds every dependency cycle in the import graph.
 *
 * Iterative DFS with an explicit path so the report names the cycle a human has
 * to break (`a -> b -> c -> a`), not merely that one exists. Cycles are
 * canonicalised by their smallest member so the same loop is reported once.
 */
export function findCycles(graph) {
  const cycles = new Map();
  const state = new Map();
  const walk = (node, path) => {
    state.set(node, 'visiting');
    for (const next of graph[node] ?? []) {
      if (!(next in graph)) continue;
      if (state.get(next) === 'visiting') {
        const cycle = path.slice(path.indexOf(next));
        const rotation = cycle.indexOf([...cycle].sort()[0]);
        const canonical = [...cycle.slice(rotation), ...cycle.slice(0, rotation)];
        cycles.set(canonical.join(' -> '), [...canonical, canonical[0]]);
        continue;
      }
      if (state.get(next) === 'done') continue;
      walk(next, [...path, next]);
    }
    state.set(node, 'done');
  };
  for (const node of Object.keys(graph).sort()) {
    if (!state.has(node)) walk(node, [node]);
  }
  return [...cycles.values()];
}

/**
 * Audits one package graph against the CLAUDE.md dependency rules.
 *
 * @param packages - one entry per workspace: `{ name, imports, declared }`,
 *   where `imports` is what `src/` actually imports and `declared` is what
 *   package.json lists (runtime + dev).
 * @returns problems, each with a `code` a reader can map back to a rule:
 *   `cycle` | `core_depends_internally` | `sink_imported` | `undeclared_dependency`
 *   | `unknown_package` | `stale_exemption`
 */
export function auditPackageGraph(packages) {
  const problems = [];
  const names = new Set(packages.map((p) => p.name));
  const graph = Object.fromEntries(packages.map((p) => [p.name, p.imports]));

  for (const cycle of findCycles(graph)) {
    problems.push({ code: 'cycle', packages: cycle, detail: cycle.join(' -> ') });
  }

  for (const pkg of packages) {
    for (const imported of pkg.imports) {
      if (!names.has(imported)) {
        problems.push({ code: 'unknown_package', package: pkg.name, detail: `imports ${imported}, which is not a workspace package` });
        continue;
      }
      if (imported === pkg.name) continue;
      if (pkg.name === ROOT_PACKAGE) {
        problems.push({ code: 'core_depends_internally', package: pkg.name, detail: `imports ${imported}; core must depend on nothing internal` });
      }
      if (SINK_PACKAGES.includes(imported)) {
        problems.push({ code: 'sink_imported', package: pkg.name, detail: `imports ${imported}, which is a composition root and must never be a library` });
      }
      if (!pkg.declared.includes(imported) && !(pkg.name in UNDECLARED_IMPORT_EXEMPTIONS)) {
        problems.push({ code: 'undeclared_dependency', package: pkg.name, detail: `imports ${imported} without declaring it in package.json` });
      }
    }
  }

  for (const [name, reason] of Object.entries(UNDECLARED_IMPORT_EXEMPTIONS)) {
    // Only an exempted package that is *present* can be stale: auditing a
    // subgraph (as the unit tests do) must not fail merely for omitting it.
    // `main` audits the whole workspace, where absence is caught by the
    // real-workspace assertion instead.
    const pkg = packages.find((p) => p.name === name);
    if (!pkg) continue;
    const undeclared = pkg.imports.filter((i) => names.has(i) && !pkg.declared.includes(i));
    if (undeclared.length === 0) {
      problems.push({ code: 'stale_exemption', package: name, detail: `exempted from declaring its imports (${reason}) but declares all of them; drop the exemption` });
    }
  }

  return {
    packages: packages.length,
    edges: packages.reduce((n, p) => n + p.imports.filter((i) => names.has(i)).length, 0),
    problems,
  };
}

/** Renders an audit as the byte-stable report CI prints. */
export function renderAudit(audit) {
  const lines = [`${audit.packages} workspace packages, ${audit.edges} internal edges`];
  if (audit.problems.length === 0) {
    lines.push('dependency graph is acyclic and every edge is declared and legal');
    return lines.join('\n');
  }
  lines.push(`${audit.problems.length} problem(s):`);
  for (const problem of audit.problems) {
    lines.push(`  [${problem.code}] ${problem.package ?? problem.packages?.[0]}: ${problem.detail}`);
  }
  return lines.join('\n');
}

async function collectSources(dir) {
  const files = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectSources(path));
    else if (/\.(ts|mts|js|mjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

async function readPackage(dir) {
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const declared = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ].filter(isInternal);
  const imports = new Set();
  for (const file of await collectSources(join(dir, 'src'))) {
    for (const specifier of findInternalImports(await readFile(file, 'utf8'))) imports.add(specifier);
  }
  return { name: manifest.name, imports: [...imports].sort(), declared: declared.sort() };
}

async function main() {
  const root = resolve(fileURLToPath(import.meta.url), '../../..');
  const packagesDir = join(root, 'packages');
  const dirs = [];
  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    try {
      await stat(join(dir, 'package.json'));
      dirs.push(dir);
    } catch { /* not a workspace package */ }
  }
  const audit = auditPackageGraph(await Promise.all(dirs.map(readPackage)));
  console.log(renderAudit(audit));
  if (audit.problems.length > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
