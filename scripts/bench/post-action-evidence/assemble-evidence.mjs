import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'bench-out/post-action-evidence-qualification');
const source = resolve(root, 'rote');
const evidence = resolve(root, 'evidence');
await mkdir(evidence, { recursive: true });
const rawRuns = JSON.parse(await readFile(resolve(source, 'raw-runs.json'), 'utf8'));
const runRoot = resolve(source, '.rote/runs');
const manifests = [];
const trajectories = [];
for (const runId of (await readdir(runRoot)).sort()) {
  manifests.push(JSON.parse(await readFile(resolve(runRoot, runId, 'manifest.json'), 'utf8')));
  trajectories.push((await readFile(resolve(runRoot, runId, 'trajectory.jsonl'), 'utf8')).trim());
}
if (rawRuns.length !== manifests.length || trajectories.some((value) => !value)) {
  throw new Error(`evidence count mismatch: raw=${rawRuns.length}, manifests=${manifests.length}, trajectories=${trajectories.length}`);
}
await Promise.all([
  writeFile(resolve(evidence, 'raw-runs.json'), `${JSON.stringify(rawRuns, null, 2)}\n`),
  writeFile(resolve(evidence, 'manifests.json'), `${JSON.stringify(manifests, null, 2)}\n`),
  writeFile(resolve(evidence, 'trajectories.jsonl'), `${trajectories.join('\n')}\n`),
]);
console.log(`assembled ${manifests.length} Rote qualification attempts in ${evidence}`);
