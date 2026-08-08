import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const data = join(root, 'docs/testing/data');

const readText = (name) => readFile(join(data, name), 'utf8');
const readJson = async (name) => JSON.parse(await readText(name));
const assert = (condition, message) => {
  if (!condition) throw new Error(`T28 audit failed: ${message}`);
};
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

const [protocol, manifest, trajectoryText, stdout, stderr, registry, distTags, packRows, tarballSha] = await Promise.all([
  readJson('T28-registry-smoke-protocol.json'),
  readJson('T28-registry-smoke-manifest.json'),
  readText('T28-registry-smoke-trajectory.jsonl'),
  readText('T28-registry-smoke-stdout.txt'),
  readText('T28-registry-smoke-stderr.txt'),
  readJson('T28-registry-metadata.json'),
  readJson('T28-registry-dist-tags.json'),
  readJson('T28-registry-pack.json'),
  readText('T28-registry-tarball-sha256.txt'),
]);

assert(protocol.protocol_id === 'p1-registry-provider-quickstart-v1', 'unexpected protocol');
assert(protocol.record_kind === 'release_smoke', 'record must not be certification evidence');
assert(protocol.environment.initial_working_directory_entries === 0, 'working directory was not empty');
assert(protocol.environment.source_checkout_present === false, 'source checkout contaminated the smoke');
assert(protocol.environment.package_manifest_present === false, 'local package metadata contaminated npx resolution');
assert(protocol.command.argv.slice(0, 3).join(' ') === 'npx --yes @rotehq/cli@0.1.0', 'command was not version-pinned registry npx');
assert(protocol.expected.verification.kind === 'visible_text', 'unexpected independent verifier');

assert(registry.name === protocol.package.name, 'registry package name mismatch');
assert(registry.version === protocol.package.version, 'registry package version mismatch');
assert(registry['dist.integrity'] === protocol.package.expected_integrity, 'registry integrity mismatch');
assert(distTags.latest === protocol.package.version, 'latest dist-tag mismatch');
assert(tarballSha.trim() === protocol.package.tarball_sha256, 'downloaded registry tarball SHA-256 mismatch');
assert(packRows.length === 1, 'registry pack must contain one package record');
const pack = packRows[0];
assert(pack.name === protocol.package.name && pack.version === protocol.package.version, 'packed identity mismatch');
assert(pack.integrity === registry['dist.integrity'], 'pack and registry integrity differ');
assert(pack.shasum === registry['dist.shasum'], 'pack and registry shasum differ');
assert(pack.size === 106253 && pack.entryCount === 7, 'registry package shape changed');
assert(pack.files.some((file) => file.path === 'bin/rote.js' && file.mode === 493), 'executable bin missing');

assert(manifest.run_id === '1f321e8a-a21b-42b7-9bbc-dfe80d5d2ed6', 'manifest run id changed');
assert(manifest.task_spec === protocol.command.argv[4], 'manifest task differs from command');
assert(manifest.outcome === protocol.expected.outcome, 'manifest did not report verified success');
assert(manifest.token_usage.length === 1, 'manifest must contain exactly one usage record');
const manifestUsage = manifest.token_usage[0];
assert(manifestUsage.source === 'planner', 'usage call is not planner-tagged');
assert(manifestUsage.input_tokens === 366 && manifestUsage.output_tokens === 26, 'manifest usage changed');
assert(manifestUsage.cache_read_tokens === 0 && manifestUsage.cache_write_tokens === 0, 'cache usage changed');

const trajectoryLines = trajectoryText.trim().split('\n');
assert(trajectoryLines.length === protocol.expected.steps, 'trajectory step count mismatch');
const event = JSON.parse(trajectoryLines[0]);
assert(event.run_id === manifest.run_id && event.seq === 0, 'trajectory lineage mismatch');
assert(event.tool === 'browser.done' && event.args?.success === true, 'harness did not conclude success');
const result = event.result_ref?.kind === 'inline' ? event.result_ref.value : undefined;
assert(result, 'provider evidence was not retained inline');
assert(JSON.stringify(result.planner_usage) === JSON.stringify(manifestUsage), 'trajectory and manifest usage differ');
assert(result.provider_receipts.length === protocol.expected.complete_raw_receipts, 'raw receipt count mismatch');
const receipt = result.provider_receipts[0];
assert(receipt.provider === protocol.expected.provider && receipt.model === protocol.expected.model, 'provider/model mismatch');
assert(receipt.usage.input_tokens === manifestUsage.input_tokens, 'raw input usage does not reconcile');
assert(receipt.usage.output_tokens === manifestUsage.output_tokens, 'raw output usage does not reconcile');
assert(receipt.usage.total_tokens === manifestUsage.input_tokens + manifestUsage.output_tokens, 'raw total usage does not reconcile');

const expectedStdout = [
  'success: task verification passed',
  `run: ${manifest.run_id}`,
  'phase: cold',
  `steps: ${protocol.expected.steps}`,
  `tokens: ${manifestUsage.input_tokens} input + ${manifestUsage.output_tokens} output`,
  '',
].join('\n');
assert(stdout === expectedStdout, 'CLI output changed or verification line is missing');
assert(stderr === '', 'CLI wrote stderr');

const frozenHashes = {
  'T28-registry-smoke-stdout.txt': '4b48f0665b7a8fd575adf6a0c559db6de780cea9c44c5f4490403a2a35775b33',
  'T28-registry-smoke-stderr.txt': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'T28-registry-smoke-manifest.json': '31d686ce85a476ca8051671198bab0ea6ca8fae4f2e6078ac131c41123b0fd31',
  'T28-registry-smoke-trajectory.jsonl': '848e8a332ee0f929e89f1ce31280ca1eea0516f87a443e2ef268949c11ec24c6',
  'T28-registry-metadata.json': 'b924a3f4060e7def5c5629e708bb5c7b5a46fe4fec710f098b5a66ccb2b08c60',
  'T28-registry-dist-tags.json': 'be0968c4f6fec5d0d56620840cd744258b5d157b12301c4bc27bfc7157eb87e0',
  'T28-registry-pack.json': '43ce703e0a1dec8ff45feacf8009c82806e6aa3228093721f8ad971051e4061c',
};
for (const [name, expected] of Object.entries(frozenHashes)) {
  assert(sha256(await readText(name)) === expected, `${name} digest mismatch`);
}

const allEvidence = [JSON.stringify(protocol), JSON.stringify(manifest), trajectoryText, stdout, stderr, JSON.stringify(registry), JSON.stringify(packRows)].join('\n');
assert(!/(?:sk-[A-Za-z0-9_-]{12,}|api[_-]?key\s*[=:]\s*[^;\s"]+)/i.test(allEvidence), 'evidence appears to contain a credential');

console.log('T28 reproduction passed: registry identity, tarball integrity, exact verifier output, manifest, trajectory, and raw receipt reconcile');
