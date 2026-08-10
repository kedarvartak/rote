import { canonicalStringify, sha256Hex } from '@rote/core';
import {
  BrowserContextCoordinateSchema,
  type BrowserContextCoordinate,
  type BrowserContextSegment,
} from './types.js';

/** Raised when an action targets a context absent from the current composed page. */
export class BrowserContextMismatchError extends Error {
  constructor(readonly contextHash: string) {
    super(`browser context mismatch: ${contextHash}`);
    this.name = 'BrowserContextMismatchError';
  }
}

/** Raised when a frame document changed after target resolution but before dispatch. */
export class BrowsingContextStaleError extends Error {
  constructor(readonly contextHash: string) {
    super(`browser context became stale before dispatch: ${contextHash}`);
    this.name = 'BrowsingContextStaleError';
  }
}

/** Raised when a target is inside a closed shadow root that Rote will not pierce. */
export class ClosedShadowRootUnsupportedError extends Error {
  constructor(readonly contextHash: string) {
    super(`closed shadow root is unsupported: ${contextHash}`);
    this.name = 'ClosedShadowRootUnsupportedError';
  }
}

/** Hashes only stable path segments; the fresh document token never enters identity. */
export function browserContextHash(path: readonly BrowserContextSegment[]): string {
  return sha256Hex(path.length === 0 ? 'top' : canonicalStringify(path)).slice(0, 16);
}

/** Constructs a validated context coordinate from stable segments and a live document token. */
export function browserContextCoordinate(
  path: readonly BrowserContextSegment[],
  documentToken: string,
): BrowserContextCoordinate {
  return BrowserContextCoordinateSchema.parse({
    version: 1,
    path,
    contextHash: browserContextHash(path),
    documentToken,
  });
}
