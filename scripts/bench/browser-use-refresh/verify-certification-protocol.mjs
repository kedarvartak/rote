import { readFile } from 'node:fs/promises';

const protocol = JSON.parse(await readFile(new URL('./certification-protocol.json', import.meta.url), 'utf8'));
const tasks = JSON.parse(await readFile(new URL('../headhead/tasks.json', import.meta.url), 'utf8'));
const task = tasks.tasks.find((candidate) => candidate.id === protocol.task_id);
if (!task) throw new Error(`missing canonical task ${protocol.task_id}`);
for (const [label, actual, expected] of [
  ['provider', tasks.provider, protocol.provider],
  ['model', tasks.model, protocol.model],
  ['viewport', JSON.stringify(tasks.viewport), JSON.stringify(protocol.viewport)],
  ['fixture path', task.path, protocol.fixture_path],
  ['task prompt', task.prompt, protocol.task_prompt],
  ['verification oracle', task.verify_text, protocol.verify_text],
]) {
  if (actual !== expected) throw new Error(`${label} differs from the frozen Browser Use 0.13.7 certification protocol`);
}
if (protocol.repetitions < protocol.min_successful_runs || protocol.min_successful_runs < 15) {
  throw new Error('certification requires at least 15 successful runs per harness');
}
if (protocol.order.join(',') !== 'rote,browser-use' || protocol.rote_mode !== 'cold-agent') {
  throw new Error('paired order or Rote execution mode changed');
}
console.log(`protocol ${protocol.protocol_id} matches canonical B2`);
