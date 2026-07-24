import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const configPath = fileURLToPath(new URL('../bench/headhead/tasks.json', import.meta.url));
const config = JSON.parse(await readFile(configPath, 'utf8'));
const task = config.tasks?.find((candidate) => candidate.id === 'B1');
if (!task || typeof task.prompt !== 'string') throw new Error('canonical B1 task is unavailable');
const match = /username "([^"]+)" and password "([^"]+)"/.exec(task.prompt);
if (!match) throw new Error('canonical B1 prompt no longer exposes fixture slot values');
if (process.argv[2] === 'task') console.log(task.prompt);
else if (process.argv[2] === 'params') console.log(JSON.stringify({ username: match[1], password: match[2] }));
else throw new Error('usage: node read-b1-config.mjs <task|params>');
