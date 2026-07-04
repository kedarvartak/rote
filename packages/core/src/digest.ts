import { z } from 'zod';
import { sha256Hex } from './fingerprint.js';

export const ResultDigestSchema = z.object({
  sha256: z.string().length(64),
  byte_length: z.number().int().nonnegative(),
  preview: z.string(),
});
export type ResultDigest = z.infer<typeof ResultDigestSchema>;

export const ResultRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inline'), value: z.unknown() }),
  z.object({ kind: z.literal('blob'), path: z.string().min(1) }),
]);
export type ResultRef = z.infer<typeof ResultRefSchema>;
export type InlineResultRef = Extract<ResultRef, { kind: 'inline' }>;

/**
 * Below this size a tool result is stored inline in the trajectory event;
 * above it, the recorder (I/O lives there, not here) spills the result to a
 * content-addressed blob and stores only a path. See docs/02-architecture.md
 * "Recorder".
 */
export const DEFAULT_INLINE_THRESHOLD_BYTES = 8192;

/** Computes the content digest of a tool result. Pure — no I/O. */
export function computeResultDigest(raw: unknown, previewChars = 200): ResultDigest {
  const json = JSON.stringify(raw) ?? 'null';
  const byte_length = Buffer.byteLength(json, 'utf8');
  const sha256 = sha256Hex(json);
  const preview = json.length > previewChars ? `${json.slice(0, previewChars)}…` : json;
  return { sha256, byte_length, preview };
}

/**
 * Decides inline vs. blob storage from byte length alone. Pure — the actual
 * blob write/read is an I/O concern owned by the recorder package (M1).
 */
export function decideStorage(
  byteLength: number,
  thresholdBytes = DEFAULT_INLINE_THRESHOLD_BYTES,
): 'inline' | 'blob' {
  return byteLength > thresholdBytes ? 'blob' : 'inline';
}

/**
 * Verifies an inline result ref against its recorded digest by recomputing
 * the digest from the inline value and comparing hash + length (the preview
 * field is a truncated UI convenience, not part of the integrity check).
 *
 * Blob refs cannot be verified here — that requires reading the blob, which
 * is the recorder/executor's job once it has read the bytes.
 */
export function verifyInlineResultRef(ref: InlineResultRef, digest: ResultDigest): boolean {
  const recomputed = computeResultDigest(ref.value);
  return recomputed.sha256 === digest.sha256 && recomputed.byte_length === digest.byte_length;
}
