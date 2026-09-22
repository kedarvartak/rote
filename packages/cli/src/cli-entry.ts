import { main } from './cli.js';
import { stdin, stdout } from 'node:process';
import { startTui } from './tui.js';

const startsTui = process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === 'tui');

if (startsTui && stdin.isTTY && stdout.isTTY) {
  await startTui((argv) => main(argv));
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
