import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'rote-cli-package-'));

try {
  const packed = await exec('npm', ['pack', join(root, 'packages/cli'), '--pack-destination', temporary, '--json'], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  });
  const metadata = JSON.parse(packed.stdout);
  const filename = metadata[0]?.filename;
  if (typeof filename !== 'string') throw new Error('npm pack did not return a tarball filename');
  const tarball = join(temporary, filename);
  await exec('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', tarball], {
    cwd: temporary,
    maxBuffer: 10 * 1024 * 1024,
  });
  const bin = join(temporary, 'node_modules/.bin', process.platform === 'win32' ? 'rote.cmd' : 'rote');
  const result = await exec(bin, ['runs', 'ls'], { cwd: temporary });
  if (result.stdout.trim() !== 'No runs found.') {
    throw new Error(`unexpected packaged CLI output: ${JSON.stringify(result.stdout)}`);
  }
  const packageJson = JSON.parse(await readFile(join(temporary, 'node_modules/@rote/cli/package.json'), 'utf8'));
  if (packageJson.version !== '0.1.0' || packageJson.private === true || packageJson.license !== 'MIT') {
    throw new Error('installed CLI package does not carry public 0.1.0 metadata');
  }
  if (Object.keys(packageJson.dependencies ?? {}).some((name) => name.startsWith('@rote/'))) {
    throw new Error('published CLI cannot depend on unpublished @rote workspaces');
  }
  const bundle = await readFile(join(temporary, 'node_modules/@rote/cli/dist/cli-entry.js'), 'utf8');
  if (bundle.includes('@rote/')) throw new Error('published bundle retained an internal workspace import');
  console.log(`packaged CLI smoke passed (${metadata[0].size} bytes)`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
