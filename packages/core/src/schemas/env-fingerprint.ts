import { z } from 'zod';
import { canonicalStringify, sha256Hex } from '../fingerprint.js';

export const ToolInventoryEntrySchema = z.object({
  name: z.string().min(1),
  schema_hash: z.string().min(1),
});
export type ToolInventoryEntry = z.infer<typeof ToolInventoryEntrySchema>;

export const EnvFingerprintSchema = z.object({
  tool_inventory: z.array(ToolInventoryEntrySchema),
  target_identity: z.string().min(1),
  surface_versions: z.record(z.string(), z.string()).default({}),
  fingerprint_hash: z.string().length(64),
});
export type EnvFingerprint = z.infer<typeof EnvFingerprintSchema>;

export type EnvFingerprintInput = Omit<EnvFingerprint, 'fingerprint_hash'>;

/**
 * Builds a full EnvFingerprint, computing fingerprint_hash from the other
 * fields. tool_inventory is sorted by name before hashing so key/array
 * ordering never changes the hash — only actual content does. See
 * docs/05-roadmap.md M0 "Fingerprint stability".
 */
export function buildEnvFingerprint(input: EnvFingerprintInput): EnvFingerprint {
  const sortedInventory = [...input.tool_inventory].sort((a, b) => a.name.localeCompare(b.name));
  const canonicalInput = {
    tool_inventory: sortedInventory,
    target_identity: input.target_identity,
    surface_versions: input.surface_versions ?? {},
  };
  const fingerprint_hash = sha256Hex(canonicalStringify(canonicalInput));
  return { ...canonicalInput, fingerprint_hash };
}

/**
 * The pattern a playbook's task_signature matches against: a coarse,
 * hand-authorable subset (domain + tool prefixes) — distinct from the exact
 * runtime EnvFingerprint recorded per-run above. Matching logic itself lands
 * in M4 (Matcher); this schema is just the shape it operates on.
 */
export const EnvFingerprintPatternSchema = z.object({
  domain: z.string().min(1),
  tool_prefixes: z.array(z.string().min(1)).min(1),
});
export type EnvFingerprintPattern = z.infer<typeof EnvFingerprintPatternSchema>;
