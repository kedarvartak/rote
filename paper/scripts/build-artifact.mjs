// Builds the anonymized artifact the paper's reproducibility statement promises:
// the code, fixtures, frozen test records, and raw data a reviewer needs to
// re-run and disagree with the claims — with nothing that identifies the authors.
//
// Usage: node paper/scripts/build-artifact.mjs [--out <dir>] [--allow-identifying]
//
// Anonymity is enforced, not assumed. Identifying strings a double-blind
// submission must not carry (author name and email, the GitHub org/repo, session
// URLs) are redacted **in the staged copy only** — the repository is never
// modified — and the staged tree is then re-scanned. Any surviving hit fails the
// build rather than shipping a bundle that would be desk-rejected.
// `--allow-identifying` reports instead of failing, for a non-blind bundle.
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const OUT = resolve(outIndex >= 0 ? args[outIndex + 1] : join(ROOT, 'paper', 'artifact'));
const ALLOW = args.includes('--allow-identifying');

/** What a reviewer needs: the system, what it is measured on, and every frozen record. */
const INCLUDE = [
  'packages',
  'fixtures',
  'scripts/bench',
  'scripts/demo',
  'docs/testing',
  'docs/02-architecture.md',
  'docs/03-benchmark.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
];

/** Never shipped: build output, dependencies, VCS, and the paper itself. */
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.turbo', 'artifact']);

/**
 * Patterns that would break double-blind review. Kept literal and narrow so the
 * scan is explainable: each hit names the file and the rule it broke.
 */
const IDENTIFYING = [
  // Order matters: the repo URL contains the author name, so it is redacted first.
  { id: 'repo_url', pattern: /github\.com\/kedarvartak\/[A-Za-z0-9._-]*/gi, replacement: 'example.invalid/anonymous/rote' },
  { id: 'author_email', pattern: /kedarvartak01@gmail\.com/gi, replacement: 'anonymous@example.invalid' },
  { id: 'author_name', pattern: /kedar\s*vartak/gi, replacement: 'Anonymous Author' },
  { id: 'session_url', pattern: /claude\.ai\/code\/session_[A-Za-z0-9]+/gi, replacement: 'example.invalid/session' },
];

const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.yaml', '.yml', '.html', '.css', '.txt', '.jsonl', '.tex', '.bib']);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

async function copyInclude(source, destination) {
  await cp(source, destination, {
    recursive: true,
    filter: (path) => !path.split(/[\\/]/).some((segment) => EXCLUDE_DIRS.has(segment)),
  });
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const entry of INCLUDE) {
  const source = join(ROOT, entry);
  try {
    await stat(source);
  } catch {
    console.warn(`skipped missing ${entry}`);
    continue;
  }
  await copyInclude(source, join(OUT, entry));
}

// Redact then scan, both against the staged copy: what ships is what matters,
// and the repository must never be touched by a paper build.
const redactions = [];
for await (const path of walk(OUT)) {
  const relativePath = relative(OUT, path);
  const extension = relativePath.slice(relativePath.lastIndexOf('.'));
  if (!TEXT_EXTENSIONS.has(extension)) continue;
  const original = await readFile(path, 'utf8');
  let text = original;
  for (const rule of IDENTIFYING) {
    rule.pattern.lastIndex = 0;
    const found = text.match(rule.pattern);
    if (!found) continue;
    text = text.replace(rule.pattern, rule.replacement);
    redactions.push({ path: relativePath, rule: rule.id, occurrences: found.length });
  }
  if (text !== original) await writeFile(path, text, 'utf8');
}

const hits = [];
const manifest = [];
for await (const path of walk(OUT)) {
  const relativePath = relative(OUT, path);
  const contents = await readFile(path);
  manifest.push({ path: relativePath, bytes: contents.byteLength, sha256: createHash('sha256').update(contents).digest('hex') });
  const extension = relativePath.slice(relativePath.lastIndexOf('.'));
  if (!TEXT_EXTENSIONS.has(extension)) continue;
  const text = contents.toString('utf8');
  for (const rule of IDENTIFYING) {
    rule.pattern.lastIndex = 0;
    const found = text.match(rule.pattern);
    if (found) hits.push({ path: relativePath, rule: rule.id, occurrences: found.length });
  }
}

manifest.sort((left, right) => left.path.localeCompare(right.path));
const digest = createHash('sha256').update(manifest.map((file) => `${file.sha256} ${file.path}`).join('\n')).digest('hex');
await writeFile(join(OUT, 'MANIFEST.json'), `${JSON.stringify({
  files: manifest.length,
  bytes: manifest.reduce((total, file) => total + file.bytes, 0),
  artifact_sha256: digest,
  anonymity: {
    rules: IDENTIFYING.map((rule) => rule.id),
    redactions_applied: redactions.reduce((total, entry) => total + entry.occurrences, 0),
    files_redacted: new Set(redactions.map((entry) => entry.path)).size,
    surviving_hits: hits,
  },
}, null, 2)}\n`, 'utf8');

console.log(`staged ${manifest.length} files (${(manifest.reduce((total, file) => total + file.bytes, 0) / 1e6).toFixed(1)} MB) → ${relative(ROOT, OUT)}`);
console.log(`artifact digest ${digest}`);
console.log(`redacted ${redactions.reduce((total, entry) => total + entry.occurrences, 0)} identifying reference(s) across ${new Set(redactions.map((entry) => entry.path)).size} file(s) in the staged copy`);

if (hits.length > 0) {
  const summary = hits.slice(0, 20).map((hit) => `  ${hit.rule}: ${hit.path} (${hit.occurrences})`).join('\n');
  console.log(`\nanonymity scan found ${hits.length} reference(s) redaction did not remove:\n${summary}${hits.length > 20 ? `\n  … and ${hits.length - 20} more` : ''}`);
  if (!ALLOW) {
    console.log('\nrefusing to call this artifact anonymous. Extend the redaction rules, or re-run with --allow-identifying for a non-blind bundle.');
    process.exit(1);
  }
}
console.log('\nanonymity scan clean.');
