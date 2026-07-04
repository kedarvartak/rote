import { main } from './cli.js';

main(process.argv.slice(2))
  .then((output) => {
    console.log(output);
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
