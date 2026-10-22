#!/usr/bin/env node
/**
 * Binds every measured number in the paper to its source of record in this
 * repository, and fails when the two disagree.
 *
 * The paper's numbers were transcribed by hand from frozen certification
 * documents. Nothing stopped the paper and the repository from drifting apart
 * in either direction: a corrected T-document leaves a stale number in the
 * paper, and a number added to the paper has no evidence behind it at all.
 * Both are the reviewer's problem to find, which is exactly the wrong place.
 *
 * The ledger lives in `paper/claims.json`. This script checks three things:
 *
 *   1. every ledgered claim's text still appears in `rote.tex`     (dead ledger row)
 *   2. every ledgered claim's excerpt still appears in its source  (evidence moved)
 *   3. every measurement literal in `rote.tex` is ledgered         (unevidenced claim)
 *
 * Check 3 is the one that matters: a new percentage typed into the paper fails
 * the build until someone names where it came from.
 *
 * Usage: node paper/scripts/verify-claims.mjs [--json <out>]
 * Exits 1 on any problem.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAPER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = resolve(PAPER_DIR, '..');

/**
 * Numbers in the paper that assert a measurement. Deliberately narrow: a
 * literal counts only when it is a percentage, a dollar amount, or a
 * thousands-separated count, because those are the forms this paper uses to
 * state a result. Model names, step indices and thresholds are prose.
 */
const LITERAL_PATTERNS = [
  { kind: 'percent', re: /(\d+(?:\.\d+)?)\\%/g, render: (m) => `${m[1]}\\%` },
  { kind: 'interval_lower', re: /(\d+(?:\.\d+)?)--(?:\d+(?:\.\d+)?)\\%/g, render: (m) => `${m[1]}--` },
  { kind: 'dollars', re: /\\\$(\d+(?:\.\d+)?)/g, render: (m) => `\\$${m[1]}` },
  { kind: 'count', re: /(\d{1,3})\{,\}(\d{3})/g, render: (m) => `${m[1]}{,}${m[2]}` },
];

/** Strips LaTeX comments so a commented-out draft number is not treated as a claim. */
export function stripComments(tex) {
  return tex
    .split('\n')
    .map((line) => {
      let out = '';
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] === '%' && line[i - 1] !== '\\') break;
        out += line[i];
      }
      return out;
    })
    .join('\n');
}

/**
 * Removes `\campaignresult{...}` bodies. The macro renders nothing until the
 * billed campaign runs, so a number parked inside it is not yet a claim — but
 * it must not be scanned as one either. Returns the stripped text and the
 * number of pending calls, which is reported so the count cannot quietly drop.
 */
export function stripCampaignResults(tex) {
  let out = '';
  let pending = 0;
  for (let i = 0; i < tex.length; ) {
    const at = tex.indexOf('\\campaignresult{', i);
    if (at === -1) { out += tex.slice(i); break; }
    out += tex.slice(i, at);
    pending += 1;
    let depth = 0;
    let j = at + '\\campaignresult'.length;
    for (; j < tex.length; j += 1) {
      if (tex[j] === '{' && tex[j - 1] !== '\\') depth += 1;
      else if (tex[j] === '}' && tex[j - 1] !== '\\') {
        depth -= 1;
        if (depth === 0) { j += 1; break; }
      }
    }
    i = j;
  }
  return { text: out, pending };
}

/** Every measurement literal in the scannable body, with the line it sits on. */
export function findLiterals(text) {
  const found = new Map();
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (index) => {
    let lo = 0; let hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= index) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };

  for (const pattern of LITERAL_PATTERNS) {
    pattern.re.lastIndex = 0;
    for (let match = pattern.re.exec(text); match; match = pattern.re.exec(text)) {
      const literal = pattern.render(match);
      const entry = found.get(literal) ?? { literal, kind: pattern.kind, lines: [] };
      entry.lines.push(lineOf(match.index));
      found.set(literal, entry);
    }
  }
  return [...found.values()].sort((a, b) => a.literal.localeCompare(b.literal));
}

/**
 * The whole audit as one pure function: given the paper's source, the ledger,
 * and a way to read a source-of-record file, report every disagreement. No
 * paths, no process, no exit code — so the failure modes are testable without
 * mutating the real paper.
 *
 * @param sources Map of the ledger's `source` paths to their contents; a path
 *   absent from the map is reported as `source_missing`.
 */
export function auditClaims(tex, ledger, sources) {
  if (ledger.schema_version !== 1) throw new Error(`unsupported claims.json schema_version ${ledger.schema_version}`);
  const problems = [];
  const { text: scannable, pending } = stripCampaignResults(stripComments(tex));

  for (const claim of ledger.claims) {
    if (!scannable.includes(claim.paper_anchor)) {
      problems.push({ code: 'paper_missing', claim: claim.id, detail: `paper no longer contains ${JSON.stringify(claim.paper_anchor)}` });
    }
    // A literal a claim says it evidences but the paper no longer states is a
    // row that would silently excuse that number if it were reintroduced.
    for (const literal of claim.literals) {
      if (!scannable.includes(literal)) {
        problems.push({ code: 'stale_literal', claim: claim.id, detail: `claims to evidence ${literal}, which the paper no longer states` });
      }
    }
    const source = sources.get(claim.source);
    if (source === undefined || source === null) {
      problems.push({ code: 'source_missing', claim: claim.id, detail: `${claim.source} could not be read` });
    } else if (!source.includes(claim.source_excerpt)) {
      problems.push({ code: 'source_changed', claim: claim.id, detail: `${claim.source} no longer contains ${JSON.stringify(claim.source_excerpt)}` });
    }
  }

  const exempt = new Map(ledger.exempt.map((entry) => [entry.literal, entry]));
  const literals = findLiterals(scannable);
  for (const literal of literals) {
    if (exempt.has(literal.literal)) continue;
    if (ledger.claims.some((claim) => claim.literals.includes(literal.literal))) continue;
    problems.push({
      code: 'unevidenced_literal',
      claim: literal.literal,
      detail: `line(s) ${[...new Set(literal.lines)].join(', ')} state ${literal.literal} with no claims.json entry`,
    });
  }

  // An exemption for a literal the paper no longer uses is dead weight that
  // would silently excuse the number if it came back.
  for (const entry of exempt.values()) {
    if (!literals.some((literal) => literal.literal === entry.literal)) {
      problems.push({ code: 'stale_exemption', claim: entry.literal, detail: 'exempted but no longer present in the paper' });
    }
  }

  return {
    checked_claims: ledger.claims.length,
    exemptions: ledger.exempt.length,
    literals_found: literals.length,
    campaign_placeholders_pending: pending,
    problems,
  };
}

async function main() {
  const ledger = JSON.parse(await readFile(join(PAPER_DIR, 'claims.json'), 'utf8'));
  const tex = await readFile(join(PAPER_DIR, 'rote.tex'), 'utf8');
  const sources = new Map();
  for (const claim of ledger.claims) {
    if (sources.has(claim.source)) continue;
    sources.set(claim.source, await readFile(join(REPO_DIR, claim.source), 'utf8').catch(() => null));
  }

  const report = auditClaims(tex, ledger, sources);

  const jsonIndex = process.argv.indexOf('--json');
  if (jsonIndex !== -1 && process.argv[jsonIndex + 1]) {
    await writeFile(process.argv[jsonIndex + 1], `${JSON.stringify(report, null, 2)}\n`);
  }

  process.stdout.write(`${report.checked_claims} claims, ${report.exemptions} exemptions, ${report.literals_found} measurement literals, ${report.campaign_placeholders_pending} campaign placeholders pending\n`);
  if (report.problems.length === 0) {
    process.stdout.write('paper and repository agree on every measured number\n');
    return;
  }
  for (const problem of report.problems) process.stdout.write(`  ${problem.code}: ${problem.claim} — ${problem.detail}\n`);
  process.stdout.write(`\n${report.problems.length} problem(s)\n`);
  process.exitCode = 1;
}

// Only the CLI entry point touches the filesystem; the tests import the pure audit.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
