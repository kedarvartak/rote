import { createHash } from 'node:crypto';

/**
 * Deterministically stringifies a JSON-compatible value: object keys are
 * sorted recursively so semantically identical objects with different key
 * order produce identical output. Array order is preserved — every caller of
 * this function treats array order as semantically meaningful.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize(record[key]);
    }
    return result;
  }
  return value;
}

/** SHA-256 of a UTF-8 string, returned as lowercase hex. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
