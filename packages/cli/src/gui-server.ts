import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

type RunTask = (argv: string[]) => Promise<string>;

export interface GuiServerOptions {
  port?: number;
  openBrowser?: boolean;
  host?: string;
}

export interface GuiServer {
  url: string;
  close: () => Promise<void>;
  server: Server;
}

const providers = new Set(['codex', 'claude-code', 'openai', 'anthropic']);
const assetRoot = new URL('./gui/', import.meta.url);
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > 64 * 1024) throw new Error('Request is too large.');
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function textField(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  if (value.length > max) throw new Error(`${name} is too long.`);
  return value.trim();
}

function runArguments(input: unknown): { argv: string[]; provider: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid request.');
  const data = input as Record<string, unknown>;
  const task = textField(data['task'], 'Task', 8_000);
  const url = textField(data['url'], 'Starting URL', 4_096);
  const verify = textField(data['verify'], 'Success text', 2_000);
  const provider = textField(data['provider'], 'Provider', 40);
  if (!providers.has(provider)) throw new Error('Unknown provider.');
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); } catch { throw new Error('Starting URL must be complete.'); }
  if (!['http:', 'https:', 'data:'].includes(parsedUrl.protocol)) throw new Error('Starting URL must use http, https, or data.');
  const steps = Number(data['steps']);
  if (!Number.isSafeInteger(steps) || steps < 1 || steps > 500) throw new Error('Steps must be between 1 and 500.');
  const model = typeof data['model'] === 'string' ? data['model'].trim() : '';
  if (model.length > 200) throw new Error('Model name is too long.');
  return {
    provider,
    argv: ['run', task, '--url', url, '--verify-text', verify, '--max-steps', String(steps), ...(model ? ['--model', model] : [])],
  };
}

function open(url: string): void {
  let command: string;
  let args: string[];
  if (platform() === 'darwin') { command = 'open'; args = [url]; }
  else if (platform() === 'win32') { command = 'cmd'; args = ['/c', 'start', '', url]; }
  else { command = 'xdg-open'; args = [url]; }
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

export async function createGuiServer(runTask: RunTask, options: GuiServerOptions = {}): Promise<GuiServer> {
  const host = options.host ?? '127.0.0.1';
  let running = false;
  let expectedHosts = new Set<string>();
  const server = createServer(async (request, response) => {
    response.setHeader('content-security-policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader('referrer-policy', 'no-referrer');
    if (!expectedHosts.has(request.headers.host ?? '')) { response.writeHead(403); response.end('Forbidden'); return; }
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host}`);
    const asset = assets.get(requestUrl.pathname);
    if (request.method === 'GET' && asset) {
      try {
        const content = await readFile(new URL(asset[0]!, assetRoot));
        response.writeHead(200, { 'content-type': asset[1]!, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        response.end(content);
      } catch { response.writeHead(500); response.end('GUI assets are unavailable.'); }
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/status') {
      json(response, 200, { running, providers: [...providers] });
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/run') {
      if (!request.headers['content-type']?.startsWith('application/json') || request.headers['x-rote-client'] !== 'gui') {
        json(response, 415, { ok: false, error: 'Unsupported request.' }); return;
      }
      if (running) { json(response, 409, { ok: false, error: 'A task is already running.' }); return; }
      running = true;
      const previous = process.env['ROTE_LLM_PROVIDER'];
      try {
        const parsed = runArguments(await body(request));
        process.env['ROTE_LLM_PROVIDER'] = parsed.provider;
        const output = await runTask(parsed.argv);
        json(response, 200, { ok: true, output });
      } catch (error) {
        json(response, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
      } finally {
        if (previous === undefined) delete process.env['ROTE_LLM_PROVIDER'];
        else process.env['ROTE_LLM_PROVIDER'] = previous;
        running = false;
      }
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine GUI address.');
  expectedHosts = new Set([`${host}:${address.port}`, `localhost:${address.port}`]);
  const url = `http://${host}:${address.port}`;
  if (options.openBrowser !== false) open(url);
  return { url, server, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

export async function startGui(runTask: RunTask, argv: string[]): Promise<void> {
  let port = 0;
  let openBrowser = true;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--no-open') openBrowser = false;
    else if (arg === '--port') {
      port = Number(argv[++index]);
      if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error('--port must be between 0 and 65535.');
    } else throw new Error(`unknown GUI option: ${arg}`);
  }
  const gui = await createGuiServer(runTask, { port, openBrowser });
  console.log(`Rote GUI: ${gui.url}\nPress Ctrl+C to stop.`);
  await new Promise<void>((resolve) => {
    const stop = (): void => { process.removeListener('SIGINT', stop); void gui.close().then(resolve); };
    process.once('SIGINT', stop);
  });
}
