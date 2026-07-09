import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { captureStaticHtml } from './static-backend.js';
import type { BrowserCaptureBackend, CapturedPage } from './types.js';
import { CdpClient, createCdpTarget } from './cdp-client.js';

export interface CdpBrowserBackendOptions {
  /** Existing CDP HTTP endpoint, e.g. http://127.0.0.1:9222. */
  endpoint: string;
}

export interface LaunchingCdpBrowserBackendOptions {
  chromePath?: string;
  headless?: boolean;
}

interface RuntimeEvaluateResult {
  result: { value?: unknown };
}

/** Captures live pages from an existing Chrome DevTools Protocol endpoint. */
export class CdpBrowserBackend implements BrowserCaptureBackend {
  constructor(private readonly options: CdpBrowserBackendOptions) {}

  async capture(url: string): Promise<CapturedPage> {
    const target = await createCdpTarget(this.options.endpoint);
    if (!target.webSocketDebuggerUrl) throw new Error('CDP endpoint did not create a page target');
    const client = await CdpClient.connect({ webSocketDebuggerUrl: target.webSocketDebuggerUrl });
    try {
      await client.send('Page.enable');
      const loaded = client.waitForEvent('Page.loadEventFired');
      await client.send('Page.navigate', { url });
      await loaded;
      const html = await evaluateString(client, 'document.documentElement.outerHTML');
      const capturedUrl = await evaluateString(client, 'location.href');
      return captureStaticHtml(capturedUrl, html);
    } finally {
      client.close();
    }
  }
}

/** Launches a local Chromium/Chrome process with CDP enabled, then captures through it. */
export class LaunchingCdpBrowserBackend implements BrowserCaptureBackend {
  private child?: ChildProcess;
  private userDataDir?: string;
  private endpoint?: string;

  constructor(private readonly options: LaunchingCdpBrowserBackendOptions = {}) {}

  async capture(url: string): Promise<CapturedPage> {
    await this.ensureStarted();
    if (!this.endpoint) throw new Error('Chrome did not start with a CDP endpoint');
    return new CdpBrowserBackend({ endpoint: this.endpoint }).capture(url);
  }

  async close(): Promise<void> {
    this.child?.kill('SIGTERM');
    this.child = undefined;
    if (this.userDataDir) await rm(this.userDataDir, { recursive: true, force: true });
    this.userDataDir = undefined;
    this.endpoint = undefined;
  }

  private async ensureStarted(): Promise<void> {
    if (this.endpoint) return;
    const chromePath = this.options.chromePath ?? findChromeExecutable();
    if (!chromePath) throw new Error('Chrome/Chromium executable not found; pass chromePath');
    this.userDataDir = await mkdtemp(join(tmpdir(), 'rote-chrome-'));
    this.child = spawn(chromePath, [
      '--remote-debugging-port=0',
      `--user-data-dir=${this.userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(this.options.headless === false ? [] : ['--headless=new']),
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    this.endpoint = await waitForDevtoolsEndpoint(this.child);
  }
}

export function findChromeExecutable(): string | undefined {
  return process.env['CHROME_PATH']
    ?? firstPresent([
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]);
}

async function evaluateString(client: CdpClient, expression: string): Promise<string> {
  const result = await client.send<RuntimeEvaluateResult>('Runtime.evaluate', { expression, returnByValue: true });
  if (typeof result.result.value !== 'string') throw new Error(`CDP expression did not return a string: ${expression}`);
  return result.result.value;
}

function waitForDevtoolsEndpoint(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const stderr = child.stderr;
    if (!stderr) {
      reject(new Error('Chrome stderr is not available'));
      return;
    }
    const timeout = setTimeout(() => reject(new Error('timed out waiting for Chrome DevTools endpoint')), 10000);
    stderr.setEncoding('utf8');
    stderr.on('data', (chunk) => {
      const match = /DevTools listening on ws:\/\/([^/]+)\//.exec(String(chunk));
      if (!match?.[1]) return;
      clearTimeout(timeout);
      resolve(`http://${match[1]}`);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before DevTools endpoint was ready: ${String(code)}`));
    });
  });
}

function firstPresent(paths: readonly string[]): string | undefined {
  return paths.find((path) => existsSync(path));
}
