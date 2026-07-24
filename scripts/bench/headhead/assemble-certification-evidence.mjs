import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'bench-out/g2-certification');
const evidence = resolve(root, 'evidence');
await mkdir(evidence, { recursive: true });

const roteRaw = JSON.parse(await readFile(resolve(root, 'rote/raw-runs.json'), 'utf8'));
const browserRaw = JSON.parse(await readFile(resolve(root, 'browser-use/raw-runs.json'), 'utf8'));
const runRoot = resolve(root, 'rote/.rote/runs');
const manifests = [];
const trajectories = [];
for (const runId of (await readdir(runRoot)).sort()) {
  manifests.push(JSON.parse(await readFile(resolve(runRoot, runId, 'manifest.json'), 'utf8')));
  trajectories.push((await readFile(resolve(runRoot, runId, 'trajectory.jsonl'), 'utf8')).trim());
}
const dumps = [];
for (const filename of (await readdir(resolve(root, 'browser-use/raw'))).filter((name) => name.endsWith('.json')).sort()) {
  dumps.push(JSON.parse(await readFile(resolve(root, 'browser-use/raw', filename), 'utf8')));
}
if (manifests.length !== roteRaw.length || dumps.length !== browserRaw.length) {
  throw new Error(`evidence count mismatch: rote=${roteRaw.length}/${manifests.length}, browser-use=${browserRaw.length}/${dumps.length}`);
}
await Promise.all([
  writeFile(resolve(evidence, 'rote-manifests.json'), `${JSON.stringify(manifests, null, 2)}\n`),
  writeFile(resolve(evidence, 'rote-trajectories.jsonl'), `${trajectories.join('\n')}\n`),
  writeFile(resolve(evidence, 'browser-use-dumps.json'), `${JSON.stringify(dumps, null, 2)}\n`),
]);
console.log(`assembled ${manifests.length + dumps.length} raw attempts in ${evidence}`);
