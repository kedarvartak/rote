import { cp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve(process.argv[2] ?? '');
const target = resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) throw new Error('usage: node prepare-drift.mjs <source> <target>');
await cp(source, target, { recursive: true });
const path = resolve(target, 'b1-report.html');
let html = await readFile(path, 'utf8');
for (const [before, after] of [
  ['login-form', 'login-panel-v2'],
  ['username', 'analyst-name-v2'],
  ['password', 'access-code-v2'],
  ['login-submit', 'sign-in-v2'],
  ['latest-report-download', 'report-download-v2'],
]) {
  if (!html.includes(before)) throw new Error(`cannot prepare drift: ${before} is absent`);
  html = html.replaceAll(before, after);
}
await writeFile(path, html, 'utf8');
console.log(`prepared deterministic B1 selector drift at ${path}`);
