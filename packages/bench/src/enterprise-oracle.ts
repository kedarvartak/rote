import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { z } from 'zod';

const EnterpriseEventSchema = z.object({
  event_id: z.string().regex(/^[a-z0-9-]+$/),
  task_id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum([
    'grid_activated',
    'frame_activated',
    'shadow_activated',
    'hover_selected',
    'chord_committed',
    'upload_committed',
    'drag_dropped',
    'download_requested',
    'spa_transition',
    'continuation_checkpoint',
  ]),
  target_key: z.string().regex(/^[a-z0-9-]+$/),
  payload: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

const EnterpriseOracleEventSchema = EnterpriseEventSchema.omit({ payload: true }).extend({
  payload_sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
/** Wire shape of `/api/oracle` responses; exported so E7.4 evidence adapters can parse them. */
export const EnterpriseOracleSnapshotSchema = z.object({
  generation: z.number().int().nonnegative(),
  task_id: z.string().min(1),
  events: z.array(EnterpriseOracleEventSchema),
  spa_transition_count: z.number().int().nonnegative(),
});

/** One synthetic authoritative event retained outside the fixture DOM. */
export type EnterpriseOracleEvent = z.infer<typeof EnterpriseOracleEventSchema>;

/** Exact server-side oracle state for one task in the current reset generation. */
export type EnterpriseOracleSnapshot = z.infer<typeof EnterpriseOracleSnapshotSchema>;

/** Local-only state server for E7 fixtures; it is test instrumentation, not the E7.4 product adapter. */
export class EnterpriseFixtureServer {
  private primary?: Server;
  private crossOrigin?: Server;
  private primaryOrigin?: string;
  private crossOriginOrigin?: string;
  private generation = 0;
  private events: EnterpriseOracleEvent[] = [];

  constructor(private readonly rootDir: string) {}

  /** Starts primary and cross-origin fixture servers on random loopback ports. */
  async start(): Promise<void> {
    if (this.primary || this.crossOrigin) return;
    this.crossOrigin = createServer((request, response) => void this.respond(request, response));
    await listen(this.crossOrigin);
    this.crossOriginOrigin = serverOrigin(this.crossOrigin);
    this.primary = createServer((request, response) => void this.respond(request, response));
    await listen(this.primary);
    this.primaryOrigin = serverOrigin(this.primary);
  }

  /** Returns a primary-origin fixture URL after start. */
  url(path: string): string {
    if (!this.primaryOrigin) throw new Error('enterprise fixture server is not started');
    return `${this.primaryOrigin}/${path.replace(/^\/+/, '')}`;
  }

  /** Returns a cross-origin fixture URL after start. */
  crossOriginUrl(path: string): string {
    if (!this.crossOriginOrigin) throw new Error('enterprise fixture server is not started');
    return `${this.crossOriginOrigin}/${path.replace(/^\/+/, '')}`;
  }

  /** Resets all authoritative events and advances the freshness generation. */
  reset(): EnterpriseOracleSnapshot {
    this.generation += 1;
    this.events = [];
    return this.snapshot('reset');
  }

  /** Returns exact authoritative state filtered to one task. */
  snapshot(taskId: string): EnterpriseOracleSnapshot {
    const events = this.events.filter((event) => event.task_id === taskId);
    return EnterpriseOracleSnapshotSchema.parse({
      generation: this.generation,
      task_id: taskId,
      events,
      spa_transition_count: events.filter((event) => event.kind === 'spa_transition').length,
    });
  }

  /** Stops both origins and drops in-memory fixture state. */
  async close(): Promise<void> {
    await Promise.all([close(this.primary), close(this.crossOrigin)]);
    this.primary = undefined;
    this.crossOrigin = undefined;
    this.primaryOrigin = undefined;
    this.crossOriginOrigin = undefined;
    this.events = [];
  }

  private async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', 'content-type');
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    const url = new URL(request.url ?? '/', this.primaryOrigin ?? 'http://127.0.0.1');
    if (url.pathname === '/api/reset') {
      if (request.method !== 'POST') return json(response, 405, { error: 'reset_requires_post' });
      return json(response, 200, this.reset());
    }
    if (url.pathname === '/api/events') {
      if (request.method !== 'POST') return json(response, 405, { error: 'events_require_post' });
      try {
        const parsed = EnterpriseEventSchema.parse(JSON.parse(await readBody(request)));
        if (this.events.some((event) => event.event_id === parsed.event_id)) {
          return json(response, 409, { error: 'duplicate_event_id' });
        }
        // INVARIANT: exact effects remain comparable without retaining dispatched values.
        const event = EnterpriseOracleEventSchema.parse({
          event_id: parsed.event_id,
          task_id: parsed.task_id,
          kind: parsed.kind,
          target_key: parsed.target_key,
          payload_sha256: digestPayload(parsed.payload),
        });
        this.events.push(event);
        return json(response, 201, { generation: this.generation, event });
      } catch {
        return json(response, 400, { error: 'invalid_event' });
      }
    }
    if (url.pathname === '/api/oracle') {
      if (request.method !== 'GET') return json(response, 405, { error: 'oracle_requires_get' });
      const taskId = url.searchParams.get('task_id');
      if (!taskId || !/^[a-z0-9-]+$/.test(taskId)) return json(response, 400, { error: 'task_id_required' });
      const requestedGeneration = url.searchParams.get('generation');
      if (requestedGeneration !== null && Number(requestedGeneration) !== this.generation) {
        return json(response, 409, { error: 'stale_generation', expected: this.generation, received: Number(requestedGeneration) });
      }
      return json(response, 200, this.snapshot(taskId));
    }
    await this.serveFixture(url.pathname, response);
  }

  private async serveFixture(pathname: string, response: ServerResponse): Promise<void> {
    const relativePath = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const absoluteRoot = resolve(this.rootDir);
    const filePath = resolve(absoluteRoot, relativePath);
    if (!filePath.startsWith(`${absoluteRoot}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      let body = await readFile(filePath);
      if (extname(filePath) === '.html' || extname(filePath) === '.js') {
        body = Buffer.from(body.toString('utf8')
          .replaceAll('{{ORACLE_ORIGIN}}', this.primaryOrigin ?? '')
          .replaceAll('{{CROSS_ORIGIN}}', this.crossOriginOrigin ?? ''));
      }
      response.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-store' }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  }
}

function digestPayload(payload: Record<string, string | number | boolean | null>): string {
  const canonical = Object.fromEntries(Object.entries(payload).sort(([left], [right]) => left.localeCompare(right)));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += String(chunk);
      if (body.length > 64 * 1024) reject(new Error('request body exceeds 64KB'));
    });
    request.on('end', () => resolveBody(body));
    request.on('error', reject);
  });
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(`${JSON.stringify(value)}\n`);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolveListen();
    });
  });
}

function serverOrigin(server: Server): string {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('enterprise fixture server did not bind to TCP');
  return `http://127.0.0.1:${address.port}`;
}

function close(server?: Server): Promise<void> {
  if (!server) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function contentType(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}
