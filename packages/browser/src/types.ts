import { z } from 'zod';

/** Parses one stable frame or shadow segment in a composed browsing path. */
export const BrowserContextSegmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('frame'), keyHash: z.string().length(16), originHash: z.string().length(16) }),
  z.object({ kind: z.literal('shadow'), keyHash: z.string().length(16), mode: z.enum(['open', 'closed']) }),
]);
/** One stable frame or shadow segment in a composed browsing path. */
export type BrowserContextSegment = z.infer<typeof BrowserContextSegmentSchema>;

/** Versioned durable context path plus a fresh-document dispatch token. */
export const BrowserContextCoordinateSchema = z.object({
  version: z.literal(1),
  path: z.array(BrowserContextSegmentSchema),
  contextHash: z.string().length(16),
  documentToken: z.string().length(16),
});
export type BrowserContextCoordinate = z.infer<typeof BrowserContextCoordinateSchema>;

/** Parses a discovered composed context that cannot be traversed safely. */
export const UnsupportedBrowserContextSchema = z.object({
  coordinate: BrowserContextCoordinateSchema,
  classification: z.literal('closed_shadow_root_unsupported'),
});
/** Discovered composed context that cannot be traversed safely. */
export type UnsupportedBrowserContext = z.infer<typeof UnsupportedBrowserContextSchema>;

export const CapturedElementSchema = z.object({
  tag: z.string().min(1),
  attributes: z.record(z.string(), z.string()).default({}),
  text: z.string().default(''),
  depth: z.number().int().nonnegative(),
  context: BrowserContextCoordinateSchema.optional(),
});
export type CapturedElement = z.infer<typeof CapturedElementSchema>;

export const CapturedPageSchema = z.object({
  url: z.string().min(1),
  title: z.string().default(''),
  html: z.string(),
  elements: z.array(CapturedElementSchema),
  unsupportedContexts: z.array(UnsupportedBrowserContextSchema).optional(),
  /**
   * Top-level document epoch (hash of the CDP loader id). Same-document route
   * changes (`history.pushState`) keep it; only a real document load changes it,
   * so consumers can tell an SPA transition from a navigation (#132). Static and
   * fake backends omit it and fall back to URL identity.
   */
  documentToken: z.string().length(16).optional(),
});
export type CapturedPage = z.infer<typeof CapturedPageSchema>;

/** Browser capture boundary for the harness; CDP and fixture backends share this shape. */
export interface BrowserCaptureBackend {
  capture(url: string): Promise<CapturedPage>;
}
