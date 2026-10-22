import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { auditClaims, findLiterals, stripCampaignResults, stripComments } from './verify-claims.mjs';

const PAPER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = resolve(PAPER_DIR, '..');

async function realInputs() {
  const ledger = JSON.parse(await readFile(join(PAPER_DIR, 'claims.json'), 'utf8'));
  const tex = await readFile(join(PAPER_DIR, 'rote.tex'), 'utf8');
  const sources = new Map();
  for (const claim of ledger.claims) {
    if (sources.has(claim.source)) continue;
    sources.set(claim.source, await readFile(join(REPO_DIR, claim.source), 'utf8'));
  }
  return { ledger, tex, sources };
}

const codes = (report) => report.problems.map((problem) => problem.code);

test('the real paper agrees with the repository on every measured number', async () => {
  const { ledger, tex, sources } = await realInputs();
  const report = auditClaims(tex, ledger, sources);

  assert.deepEqual(report.problems, []);
  assert.ok(report.checked_claims > 0);
  assert.ok(report.literals_found > 0);
});

test('a number changed in the paper is caught', async () => {
  const { ledger, tex, sources } = await realInputs();
  const report = auditClaims(tex.replace('\\textbf{83.1\\%}', '\\textbf{91.4\\%}'), ledger, sources);

  // The ledger row no longer matches the paper, and the invented number is unevidenced.
  assert.ok(codes(report).includes('paper_missing'));
  assert.ok(report.problems.some((problem) => problem.code === 'unevidenced_literal' && problem.claim === '91.4\\%'));
});

test('evidence that moved under the paper is caught', async () => {
  const { ledger, tex, sources } = await realInputs();
  const moved = new Map(sources);
  const [path] = [...sources.keys()];
  moved.set(path, 'the certification record was rewritten');

  assert.ok(codes(auditClaims(tex, ledger, moved)).includes('source_changed'));
});

test('a source of record that disappeared is caught', async () => {
  const { ledger, tex, sources } = await realInputs();
  const gone = new Map(sources);
  gone.set([...sources.keys()][0], null);

  assert.ok(codes(auditClaims(tex, ledger, gone)).includes('source_missing'));
});

test('a brand-new percentage typed into the paper fails until it is evidenced', async () => {
  const { ledger, tex, sources } = await realInputs();
  const report = auditClaims(tex.replace('\\section{Conclusion}', 'Rote also wins 77.7\\% of the time.\n\\section{Conclusion}'), ledger, sources);

  assert.ok(report.problems.some((problem) => problem.code === 'unevidenced_literal' && problem.claim === '77.7\\%'));
});

test('a ledger row for a number the paper dropped is caught', async () => {
  const { ledger, tex, sources } = await realInputs();
  const withGhost = {
    ...ledger,
    claims: [...ledger.claims, {
      id: 'ghost',
      statement: 'a claim the paper no longer makes',
      paper_anchor: '\\textbf{83.1\\%} [82.1--83.9\\%]',
      literals: ['12.5\\%'],
      source: ledger.claims[0].source,
      source_excerpt: ledger.claims[0].source_excerpt,
    }],
  };

  assert.ok(codes(auditClaims(tex, withGhost, sources)).includes('stale_literal'));
});

test('an exemption for a number the paper no longer states is caught', async () => {
  const { ledger, tex, sources } = await realInputs();
  const withGhost = { ...ledger, exempt: [...ledger.exempt, { literal: '33.3\\%', reason: 'no longer stated' }] };

  assert.ok(codes(auditClaims(tex, withGhost, sources)).includes('stale_exemption'));
});

test('commented-out and campaign-pending numbers are not scanned as claims', async () => {
  const { ledger, tex, sources } = await realInputs();
  const draft = tex.replace(
    '\\section{Conclusion}',
    '% a number parked in a comment: 44.4\\%\n\\campaignresult{the campaign will report 55.5\\%}\n\\section{Conclusion}',
  );
  const report = auditClaims(draft, ledger, sources);

  assert.deepEqual(report.problems, []);
  // The placeholder count is reported so it cannot quietly drop to zero.
  assert.equal(report.campaign_placeholders_pending, auditClaims(tex, ledger, sources).campaign_placeholders_pending + 1);
});

test('a literal is a percentage, a dollar amount or a separated count — not a threshold or a year', () => {
  const found = findLiterals('Rote wins 83.1\\% at $\\geq 0.9$ over 1{,}520 steps for \\$0.0038 in 2027, up 4--9\\%.')
    .map((literal) => literal.literal)
    .sort();

  assert.deepEqual(found, ['1{,}520', '4--', '83.1\\%', '9\\%', '\\$0.0038']);
});

test('stripping is line-local and respects an escaped percent sign', () => {
  assert.equal(stripComments('a 5\\% claim % and a comment\nnext line'), 'a 5\\% claim \nnext line');
  assert.equal(stripCampaignResults('before \\campaignresult{a {nested} body} after').text, 'before  after');
});
