import { createServer, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export interface FixtureSiteServerOptions {
  /** Directory containing static fixture pages. */
  rootDir: string;
}

/** Serves a directory of static fixture pages on localhost for deterministic browser tests. */
export class FixtureSiteServer {
  private server?: Server;
  private origin?: string;
  private readonly rootDir: string;

  constructor(options: FixtureSiteServerOptions) {
    this.rootDir = resolve(options.rootDir);
  }

  /** Starts the server on a random local TCP port. */
  async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer((req, res) => {
      void this.respond(req.url ?? '/', res);
    });
    await new Promise<void>((resolveListen) => this.server?.listen(0, '127.0.0.1', () => resolveListen()));
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('fixture server did not bind to a TCP port');
    this.origin = `http://127.0.0.1:${address.port}`;
  }

  /** Returns an absolute URL for a fixture path after the server has started. */
  url(path: string): string {
    if (!this.origin) throw new Error('fixture server is not started');
    return `${this.origin}/${path.replace(/^\/+/, '')}`;
  }

  /** Stops the server; safe to call more than once. */
  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.origin = undefined;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }

  private async respond(url: string, res: ServerResponse): Promise<void> {
    const path = decodeURIComponent(url.split('?')[0] ?? '/').replace(/^\/+/, '');
    const filePath = resolve(this.rootDir, path || 'index.html');
    if (!filePath.startsWith(`${this.rootDir}${sep}`)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': contentType(filePath) }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  }
}

function contentType(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}
