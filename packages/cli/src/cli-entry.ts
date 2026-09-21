import { main } from './cli.js';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

async function interactive(): Promise<void> {
  const terminal = createInterface({ input: stdin, output: stdout });
  const abort = new AbortController();
  const stop = (): void => abort.abort();
  process.once('SIGINT', stop);
  console.log('\nRote browser agent\nEnter a page and task. Use Ctrl+C or leave the URL blank to quit.');
  try {
    while (true) {
      const url = (await terminal.question('\nStarting URL (or blank to quit): ', { signal: abort.signal })).trim();
      if (!url) return;
      const task = (await terminal.question('What should the browser do? ', { signal: abort.signal })).trim();
      if (!task) {
        console.log('Please enter a task.');
        continue;
      }
      const verification = (await terminal.question('What visible text should confirm success? ', { signal: abort.signal })).trim();
      if (!verification) {
        console.log('A completion check is required; this task was not run.');
        continue;
      }
      console.log('\nRunning…\n');
      try {
        const output = await main(['run', task, '--url', url, '--verify-text', verification]);
        console.log(output);
      } catch (err: unknown) {
        console.error(err instanceof Error ? err.message : err);
      }
    }
  } catch (err: unknown) {
    if (!abort.signal.aborted) throw err;
  } finally {
    process.removeListener('SIGINT', stop);
    terminal.close();
  }
}

if (process.argv.length === 2 && stdin.isTTY && stdout.isTTY) {
  await interactive();
} else {
  main(process.argv.slice(2))
    .then((output) => {
      console.log(output);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
