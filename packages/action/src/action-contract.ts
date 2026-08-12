import { z } from 'zod';

// see docs/02-architecture.md "Enterprise browser contracts" — step 5 (#131):
// every verb lands with safety classification, redaction, settledness, and
// action-specific evidence semantics; there is no arbitrary-event escape hatch.

/** Version of the E7.5 action safety/affordance contract encoded below. */
export const BROWSER_ACTION_CONTRACT_VERSION = 1;

const KEY_CHORD_MODIFIERS = ['Alt', 'Control', 'Meta', 'Shift'] as const;
/** Modifier key accepted in a normalized chord, in canonical order. */
export type KeyChordModifier = (typeof KEY_CHORD_MODIFIERS)[number];

/**
 * Non-modifier keys a chord may commit with. This is a deliberate allowlist —
 * a chord is an *interaction*, never an injection vector, so anything outside
 * navigation/edit keys, function keys, and single printable characters is
 * rejected instead of being forwarded to the page.
 */
const NAMED_CHORD_KEYS = new Set([
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
  'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
]);

/** Normalized explicit keyboard chord: canonical modifier order plus one allowlisted key. */
export const NormalizedKeyChordSchema = z.object({
  /** Canonical rendering, e.g. `Control+Enter` — modifiers sorted, one final key. */
  chord: z.string().min(1),
  modifiers: z.array(z.enum(KEY_CHORD_MODIFIERS)),
  key: z.string().min(1),
}).strict();
/** Normalized keyboard chord accepted by dispatch backends. */
export type NormalizedKeyChord = z.infer<typeof NormalizedKeyChordSchema>;

/** Raised for a chord outside the explicit allowlist — before any dispatch. */
export class KeyChordError extends Error {
  constructor(readonly chord: string, reason: string) {
    super(`invalid key chord "${chord}": ${reason}`);
    this.name = 'KeyChordError';
  }
}

/**
 * Parses `Modifier+...+Key` into a canonical chord. Throws {@link KeyChordError}
 * for unknown modifiers, unknown named keys, multi-character non-named keys,
 * duplicate modifiers, or a missing final key. Pure — safe to call on
 * planner-authored strings before anything reaches a browser.
 */
export function normalizeKeyChord(input: string): NormalizedKeyChord {
  const parts = input.split('+').map((part) => part.trim());
  if (parts.some((part) => part.length === 0)) throw new KeyChordError(input, 'empty chord segment');
  const rawKey = parts[parts.length - 1]!;
  const rawModifiers = parts.slice(0, -1);
  const modifiers: KeyChordModifier[] = [];
  for (const raw of rawModifiers) {
    const canonical = KEY_CHORD_MODIFIERS.find((modifier) => modifier.toLowerCase() === raw.toLowerCase()
      || (raw.toLowerCase() === 'ctrl' && modifier === 'Control')
      || (raw.toLowerCase() === 'cmd' && modifier === 'Meta'));
    if (!canonical) throw new KeyChordError(input, `unknown modifier "${raw}"`);
    if (modifiers.includes(canonical)) throw new KeyChordError(input, `duplicate modifier "${canonical}"`);
    modifiers.push(canonical);
  }
  modifiers.sort();
  const namedKey = [...NAMED_CHORD_KEYS].find((key) => key.toLowerCase() === rawKey.toLowerCase());
  const key = namedKey ?? rawKey;
  if (!namedKey && !/^[\p{L}\p{N}]$/u.test(rawKey)) {
    throw new KeyChordError(input, 'key must be a named key or a single printable character');
  }
  return NormalizedKeyChordSchema.parse({
    chord: [...modifiers, key].join('+'),
    modifiers,
    key,
  });
}

/** Coarse safety class of a browser verb, recorded with every dispatched step. */
export const BrowserActionSafetySchema = z.enum(['read', 'local_input', 'navigation', 'potentially_mutating', 'mutating']);
/** Safety classification for an action kind. */
export type BrowserActionSafety = z.infer<typeof BrowserActionSafetySchema>;

const ACTION_SAFETY: Record<string, BrowserActionSafety> = {
  done: 'read',
  hover: 'read',
  fill: 'local_input',
  select: 'local_input',
  press: 'potentially_mutating',
  click: 'potentially_mutating',
  navigate: 'navigation',
  upload: 'mutating',
  dragAndDrop: 'mutating',
};

/**
 * Classifies a verb's worst-case effect: `hover` only reads, `fill`/`select`
 * change local control state, `press`/`click` may commit, `upload`/`dragAndDrop`
 * are treated as mutating because their whole purpose is a state transfer.
 * Unknown kinds throw — a new verb must be classified before it can dispatch.
 */
export function classifyBrowserActionSafety(kind: string): BrowserActionSafety {
  const safety = ACTION_SAFETY[kind];
  if (!safety) throw new Error(`unclassified browser action kind "${kind}" — extend the E7.5 safety contract before dispatching it`);
  return safety;
}

/**
 * One upload the embedder permits, referenced by planner actions through
 * `file_id` alone.
 *
 * INVARIANT: the planner-facing action carries only the id; the name, MIME
 * type, and content stay on this edge object and are handed directly to the
 * dispatch backend — they never enter observations, recorded actions, errors,
 * or evidence (#131 acceptance).
 */
export const AllowedUploadFileSchema = z.object({
  file_id: z.string().min(1),
  name: z.string().min(1),
  mime_type: z.string().min(1),
  content_base64: z.string(),
}).strict();
/** Injected allowlisted upload source. */
export type AllowedUploadFile = z.infer<typeof AllowedUploadFileSchema>;

/** Raised before dispatch when an upload action references a file outside the allowlist. */
export class UploadNotAllowlistedError extends Error {
  constructor(readonly fileId: string, allowlistedIds: readonly string[]) {
    // Ids only: never echo names, paths, or content into an error message.
    super(`upload file_id "${fileId}" is not allowlisted; allowlisted ids: ${allowlistedIds.length ? allowlistedIds.join(', ') : '(none)'}`);
    this.name = 'UploadNotAllowlistedError';
  }
}

/** Raised when a dispatch backend does not implement a requested verb. */
export class BrowserCapabilityUnsupportedError extends Error {
  constructor(readonly capability: string) {
    super(`browser backend does not support "${capability}"; fall back to a backend that does`);
    this.name = 'BrowserCapabilityUnsupportedError';
  }
}

/** Raised when a drag source and drop target resolve into different browsing contexts. */
export class DragContextMismatchError extends Error {
  constructor(readonly sourceContextHash?: string, readonly targetContextHash?: string) {
    super(`drag source and drop target are in different browsing contexts (${sourceContextHash ?? 'top'} vs ${targetContextHash ?? 'top'}); cross-context drag is not supported`);
    this.name = 'DragContextMismatchError';
  }
}
