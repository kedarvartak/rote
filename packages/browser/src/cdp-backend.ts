import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { BrowserCaptureBackend, CapturedPage } from './types.js';
import { CdpPage } from './cdp-page.js';

export interface CdpBrowserBackendOptions {
  /** Existing CDP HTTP endpoint, e.g. http://127.0.0.1:9222. */
  endpoint: string;
}

export interface LaunchingCdpBrowserBackendOptions {
  chromePath?: string;
  headless?: boolean;
  /** Deterministic outer window size in CSS pixels. */
  windowSize?: { width: number; height: number };
  /**
   * How long to wait for Chrome's DevTools endpoint per launch attempt (ms).
   * Default 30000: a cold CI runner's first Chrome start regularly exceeds the
   * old 10 s bound, which made the whole job flake.
   */
  startTimeoutMs?: number;
  /**
   * Launch attempts before giving up (default 2). A launch that times out or
   * exits early is killed and retried once with a fresh profile dir — bounded,
   * so a genuinely broken Chrome still fails fast and loudly.
   */
  launchAttempts?: number;
}

/** Captures live pages from an existing Chrome DevTools Protocol endpoint. */
export class CdpBrowserBackend implements BrowserCaptureBackend {
  constructor(private readonly options: CdpBrowserBackendOptions) {}

  async capture(url: string): Promise<CapturedPage> {
    const page = await CdpPage.open({ endpoint: this.options.endpoint });
    try {
      await page.navigate(url);
      return await page.capture();
    } finally {
      page.close();
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
    const page = await this.openPage();
    try {
      await page.navigate(url);
      return await page.capture();
    } finally {
      page.close();
    }
  }

  /** Opens a stateful page session for browser-agent actions. */
  async openPage(): Promise<CdpPage> {
    await this.ensureStarted();
    if (!this.endpoint) throw new Error('Chrome did not start with a CDP endpoint');
    return CdpPage.open({ endpoint: this.endpoint });
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (child) await stopChrome(child);
    // Chrome can hold profile files briefly after SIGTERM; waiting for process exit
    // prevents cleanup from racing those final writes on Node 20 CI.
    if (this.userDataDir) await rm(this.userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    this.userDataDir = undefined;
    this.endpoint = undefined;
  }

  private async ensureStarted(): Promise<void> {
    if (this.endpoint) return;
    const chromePath = this.options.chromePath ?? findChromeExecutable();
    if (!chromePath) throw new Error('Chrome/Chromium executable not found; pass chromePath');
    const windowSize = this.options.windowSize;
    if (windowSize && (!Number.isInteger(windowSize.width) || !Number.isInteger(windowSize.height) || windowSize.width < 1 || windowSize.height < 1)) {
      throw new Error('windowSize width and height must be positive integers');
    }
    const attempts = this.options.launchAttempts ?? 2;
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      // fresh profile per attempt: a half-initialized profile from a timed-out
      // launch must not poison the retry
      this.userDataDir = await mkdtemp(join(tmpdir(), 'rote-chrome-'));
      this.child = spawn(chromePath, [
        '--remote-debugging-port=0',
        `--user-data-dir=${this.userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        ...(windowSize ? [`--window-size=${windowSize.width},${windowSize.height}`] : []),
        ...(this.options.headless === false ? [] : ['--headless=new']),
        'about:blank',
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      try {
        this.endpoint = await waitForDevtoolsEndpoint(this.child, this.options.startTimeoutMs ?? 30_000);
        return;
      } catch (error) {
        lastError = error as Error;
        await stopChrome(this.child);
        this.child = undefined;
      }
    }
    throw new Error(`Chrome failed to expose a DevTools endpoint after ${attempts} attempts: ${lastError?.message ?? 'unknown error'}`);
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

export function waitForDevtoolsEndpoint(child: ChildProcess, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const stderr = child.stderr;
    if (!stderr) {
      reject(new Error('Chrome stderr is not available'));
      return;
    }
    // Accumulate across chunks: the "DevTools listening" line can be split at
    // any byte boundary, and a per-chunk regex would then never match. The
    // buffer also gives the timeout error something diagnosable to carry.
    let buffered = '';
    const timeout = setTimeout(() => {
      const tail = buffered.slice(-400).trim();
      reject(new Error(`timed out waiting for Chrome DevTools endpoint after ${timeoutMs} ms${tail ? `; stderr tail: ${tail}` : ''}`));
    }, timeoutMs);
    stderr.setEncoding('utf8');
    stderr.on('data', (chunk) => {
      buffered += String(chunk);
      const match = /DevTools listening on ws:\/\/([^/]+)\//.exec(buffered);
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

async function stopChrome(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
  child.kill('SIGTERM');
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 2000)),
  ]);
  if (graceful) return;
  child.kill('SIGKILL');
  await exited;
}

function firstPresent(paths: readonly string[]): string | undefined {
  return paths.find((path) => existsSync(path));
}
