import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SessionScopeSchema, type SessionScope } from './session-scope.js';

export { DigestSchema, SessionScopeSchema } from './session-scope.js';
export type { SessionScope } from './session-scope.js';

export const VirtualSessionModeSchema = z.enum(['live', 'shadow']);
export type VirtualSessionMode = z.infer<typeof VirtualSessionModeSchema>;
export const VirtualSessionStatusSchema = z.enum(['active', 'promoted', 'discarded', 'crashed']);
export type VirtualSessionStatus = z.infer<typeof VirtualSessionStatusSchema>;

/** Public session identity. It contains no storage state, cookies, headers, or page values. */
export const VirtualSessionRefSchema = z.object({
  version: z.literal(1),
  session_id: z.string().min(1),
  mode: VirtualSessionModeSchema,
  status: VirtualSessionStatusSchema,
  scope: SessionScopeSchema,
  epoch: z.number().int().nonnegative(),
}).strict();
export type VirtualSessionRef = z.infer<typeof VirtualSessionRefSchema>;

export type SessionCleanupStatus = 'completed' | 'failed';
export interface SessionCleanupEvidence {
  status: SessionCleanupStatus;
  error_code?: 'CLEANUP_FAILED';
}

export type SessionLifecycleEvent =
  | { seq: number; kind: 'opened' | 'cloned' | 'navigated' | 'promoted' | 'discarded' | 'crashed'; session_id: string; epoch: number }
  | { seq: number; kind: 'promotion_rejected'; session_id: string; epoch: number; reason: 'stale_context' | 'scope_mismatch' | 'inactive' }
  | { seq: number; kind: 'cleanup_failed'; session_id: string; epoch: number; operation: 'discard' | 'crash' | 'promotion'; error_code: 'CLEANUP_FAILED' };

export class VirtualSessionError extends Error {
  constructor(message: string, readonly code: 'SESSION_NOT_FOUND' | 'INACTIVE_SESSION' | 'STALE_CONTEXT' | 'SCOPE_MISMATCH' | 'PROMOTION_FAILED' | 'SESSION_LIMIT') {
    super(message);
    this.name = 'VirtualSessionError';
  }
}

export interface VirtualContext {
  /** Opaque adapter-owned context handle. Never persisted by this package. */
  context_id: string;
}

/**
 * Browser-specific operations are injected so the manager never knows how to
 * read cookies/storage or dispatch browser actions. Storage state is passed
 * between adapter calls only and is never copied into a session ref or event.
 */
export interface VirtualSessionAdapter<StorageState> {
  createContext(input: { mode: VirtualSessionMode; storageState?: StorageState }): Promise<VirtualContext>;
  captureStorageState(context: VirtualContext): Promise<StorageState>;
  /** Must atomically replace the live context or throw without changing it. */
  promoteContext(input: { live: VirtualContext; shadow: VirtualContext; expectedLiveEpoch: number }): Promise<VirtualContext>;
  disposeContext(context: VirtualContext): Promise<void>;
}

interface StoredSession {
  ref: VirtualSessionRef;
  context: VirtualContext;
  base_live_id?: string;
  base_live_epoch?: number;
}

export interface OpenLiveOptions<StorageState> extends SessionScope {
  storageState?: StorageState;
  sessionId?: string;
}

export interface CloneOptions {
  sessionId?: string;
}

export interface VirtualSessionManagerOptions {
  id?: () => string;
  /** Hard cap across active and retained terminal refs; evict terminal refs to release slots. */
  maxSessions?: number;
}

export interface VirtualSessionStats {
  total: number;
  active: number;
  live: number;
  shadow: number;
  terminal: number;
  max_sessions: number;
}

/**
 * Owns live/shadow context lifecycles. It is deliberately action-free: the
 * manager can clone, advance an epoch, promote, discard, and clean up, but it
 * has no method that accepts or dispatches a predicted browser action.
 */
export class VirtualSessionManager<StorageState> {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly events: SessionLifecycleEvent[] = [];
  private nextEvent = 0;

  constructor(
    private readonly adapter: VirtualSessionAdapter<StorageState>,
    options: VirtualSessionManagerOptions = {},
  ) {
    if (options.maxSessions !== undefined && (!Number.isInteger(options.maxSessions) || options.maxSessions < 1)) {
      throw new VirtualSessionError('maxSessions must be a positive integer', 'SESSION_LIMIT');
    }
    this.options = { id: options.id, maxSessions: options.maxSessions ?? 32 };
  }

  private readonly options: { id?: () => string; maxSessions: number };

  async openLive(input: OpenLiveOptions<StorageState>): Promise<VirtualSessionRef> {
    this.assertCapacity();
    const scope = SessionScopeSchema.parse(input);
    const context = await this.adapter.createContext({ mode: 'live', ...(input.storageState !== undefined ? { storageState: input.storageState } : {}) });
    const ref = this.newRef(input.sessionId ?? this.newId(), 'live', scope);
    this.sessions.set(ref.session_id, { ref, context });
    this.emit({ kind: 'opened', session_id: ref.session_id, epoch: ref.epoch });
    return ref;
  }

  async cloneShadow(liveId: string, options: CloneOptions = {}): Promise<VirtualSessionRef> {
    const live = this.requireActive(liveId);
    if (live.ref.mode !== 'live') throw new VirtualSessionError(`${liveId} is not a live session`, 'SCOPE_MISMATCH');
    this.assertCapacity();
    const storageState = await this.adapter.captureStorageState(live.context);
    const context = await this.adapter.createContext({ mode: 'shadow', storageState });
    const ref = this.newRef(options.sessionId ?? this.newId(), 'shadow', live.ref.scope, live.ref.epoch);
    this.sessions.set(ref.session_id, { ref, context, base_live_id: liveId, base_live_epoch: live.ref.epoch });
    this.emit({ kind: 'cloned', session_id: ref.session_id, epoch: ref.epoch });
    return ref;
  }

  /** Marks a completed navigation and advances the document epoch without dispatching it. */
  advanceEpoch(sessionId: string, expectedEpoch?: number): VirtualSessionRef {
    const stored = this.requireActive(sessionId);
    if (expectedEpoch !== undefined && stored.ref.epoch !== expectedEpoch) throw new VirtualSessionError(`session ${sessionId} epoch is stale`, 'STALE_CONTEXT');
    stored.ref = { ...stored.ref, epoch: stored.ref.epoch + 1 };
    this.emit({ kind: 'navigated', session_id: sessionId, epoch: stored.ref.epoch });
    return stored.ref;
  }

  async promote(shadowId: string): Promise<VirtualSessionRef> {
    const shadow = this.requireActive(shadowId);
    if (shadow.ref.mode !== 'shadow' || !shadow.base_live_id || shadow.base_live_epoch === undefined) {
      this.emit({ kind: 'promotion_rejected', session_id: shadowId, epoch: shadow.ref.epoch, reason: 'scope_mismatch' });
      throw new VirtualSessionError(`session ${shadowId} is not an attached shadow`, 'SCOPE_MISMATCH');
    }
    const live = this.requireActive(shadow.base_live_id);
    if (live.ref.epoch !== shadow.base_live_epoch) {
      this.emit({ kind: 'promotion_rejected', session_id: shadowId, epoch: shadow.ref.epoch, reason: 'stale_context' });
      await this.cleanup(shadowId, shadow, 'promotion');
      throw new VirtualSessionError(`shadow ${shadowId} was based on epoch ${shadow.base_live_epoch}, live is ${live.ref.epoch}`, 'STALE_CONTEXT');
    }
    let promoted: VirtualContext;
    try {
      promoted = await this.adapter.promoteContext({ live: live.context, shadow: shadow.context, expectedLiveEpoch: live.ref.epoch });
    } catch (error) {
      await this.cleanup(shadowId, shadow, 'promotion');
      throw new VirtualSessionError(`promotion failed: ${error instanceof Error ? error.message : String(error)}`, 'PROMOTION_FAILED');
    }
    live.context = promoted;
    live.ref = { ...live.ref, epoch: live.ref.epoch + 1 };
    shadow.ref = { ...shadow.ref, status: 'promoted' };
    this.emit({ kind: 'promoted', session_id: shadowId, epoch: live.ref.epoch });
    return live.ref;
  }

  async discard(sessionId: string): Promise<SessionCleanupEvidence> {
    const stored = this.requireActive(sessionId);
    return this.cleanup(sessionId, stored, 'discard');
  }

  async crash(sessionId: string): Promise<SessionCleanupEvidence> {
    const stored = this.requireActive(sessionId);
    return this.cleanup(sessionId, stored, 'crash');
  }

  get(sessionId: string): VirtualSessionRef {
    return this.sessions.get(sessionId)?.ref ?? (() => { throw new VirtualSessionError(`unknown session ${sessionId}`, 'SESSION_NOT_FOUND'); })();
  }

  list(): VirtualSessionRef[] {
    return [...this.sessions.values()].map((session) => session.ref);
  }

  lifecycle(): SessionLifecycleEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  /**
   * Releases terminal refs after a soak interval. Active sessions are never
   * evicted, and the lifecycle log remains append-only for auditability.
   */
  evictInactive(): number {
    let evicted = 0;
    for (const [sessionId, stored] of this.sessions) {
      if (stored.ref.status === 'active') continue;
      this.sessions.delete(sessionId);
      evicted += 1;
    }
    return evicted;
  }

  /** Disposes every active context in order and then releases terminal refs. */
  async closeAll(): Promise<SessionCleanupEvidence[]> {
    const active = [...this.sessions.values()].filter((stored) => stored.ref.status === 'active');
    const evidence: SessionCleanupEvidence[] = [];
    for (const stored of active) evidence.push(await this.cleanup(stored.ref.session_id, stored, 'crash'));
    this.evictInactive();
    return evidence;
  }

  stats(): VirtualSessionStats {
    const refs = [...this.sessions.values()].map((stored) => stored.ref);
    return {
      total: refs.length,
      active: refs.filter((ref) => ref.status === 'active').length,
      live: refs.filter((ref) => ref.mode === 'live' && ref.status === 'active').length,
      shadow: refs.filter((ref) => ref.mode === 'shadow' && ref.status === 'active').length,
      terminal: refs.filter((ref) => ref.status !== 'active').length,
      max_sessions: this.options.maxSessions,
    };
  }

  private async cleanup(sessionId: string, stored: StoredSession, operation: 'discard' | 'crash' | 'promotion'): Promise<SessionCleanupEvidence> {
    try {
      await this.adapter.disposeContext(stored.context);
      stored.ref = { ...stored.ref, status: operation === 'crash' ? 'crashed' : 'discarded' };
      this.emit({ kind: operation === 'crash' ? 'crashed' : 'discarded', session_id: sessionId, epoch: stored.ref.epoch });
      return { status: 'completed' };
    } catch {
      this.emit({ kind: 'cleanup_failed', session_id: sessionId, epoch: stored.ref.epoch, operation, error_code: 'CLEANUP_FAILED' });
      return { status: 'failed', error_code: 'CLEANUP_FAILED' };
    }
  }

  private requireActive(sessionId: string): StoredSession {
    const stored = this.sessions.get(sessionId);
    if (!stored) throw new VirtualSessionError(`unknown session ${sessionId}`, 'SESSION_NOT_FOUND');
    if (stored.ref.status !== 'active') throw new VirtualSessionError(`session ${sessionId} is ${stored.ref.status}`, 'INACTIVE_SESSION');
    return stored;
  }

  private assertCapacity(): void {
    if (this.sessions.size >= this.options.maxSessions) {
      throw new VirtualSessionError(`session capacity ${this.options.maxSessions} reached; evict terminal refs before opening another`, 'SESSION_LIMIT');
    }
  }

  private newRef(sessionId: string, mode: VirtualSessionMode, scope: SessionScope, epoch = 0): VirtualSessionRef {
    return VirtualSessionRefSchema.parse({ version: 1, session_id: sessionId, mode, status: 'active', scope, epoch });
  }

  private newId(): string { return this.options.id?.() ?? randomUUID(); }

  private emit(event: Record<string, unknown> & { kind: SessionLifecycleEvent['kind']; session_id: string; epoch: number }): void {
    this.events.push({ seq: this.nextEvent++, ...event } as SessionLifecycleEvent);
  }
}

export * from './shadow-prefetch.js';
export * from './effect-fenced-speculation.js';
export * from './speculative-pipeline.js';
