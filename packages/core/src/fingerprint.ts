import { createHash } from 'node:crypto';

/**
 * Raised when a value cannot be canonicalised faithfully.
 *
 * see docs/02-architecture.md "Matcher" — stage 1 is a hard gate. A gate is
 * only as trustworthy as the hash behind it, so a value JSON cannot represent
 * must never be *approximated* into one: `JSON.stringify` turns a `Date` into
 * `{}`, `NaN` into `null`, and a `Map` into `{}`, which would give unrelated
 * environments the same fingerprint.
 */
export class NonCanonicalValueError extends Error {
  constructor(
    /** JSON-ish path to the offending value, e.g. `tool_inventory[0].added_at`. */
    public readonly path: string,
    /** What was found there, described for a human. */
    public readonly found: string,
  ) {
    super(`Cannot canonicalise ${found} at ${path}: only JSON values (string, finite number, boolean, null, array, plain object) hash faithfully`);
    this.name = 'NonCanonicalValueError';
  }
}

/**
 * Deterministically stringifies a JSON-compatible value: object keys are
 * sorted recursively so semantically identical objects with different key
 * order produce identical output. Array order is preserved — every caller of
 * this function treats array order as semantically meaningful.
 *
 * Fails closed on anything JSON cannot carry (see {@link NonCanonicalValueError}).
 * The one silent conversion kept is an `undefined` *object property*, which is
 * dropped: in JSON an absent key and a key whose value is undefined are the
 * same statement. An `undefined` inside an *array* is rejected, because there
 * dropping is not available and `JSON.stringify` would substitute `null` —
 * changing an element's value rather than restating the same one.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value, '$'));
}

function canonicalize(value: unknown, path: string): unknown {
  if (value === null) return null;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      // NaN and ±Infinity both stringify to `null`, so three distinct values
      // would share one hash.
      if (!Number.isFinite(value)) throw new NonCanonicalValueError(path, `the non-finite number ${String(value)}`);
      return value;
    case 'undefined':
      throw new NonCanonicalValueError(path, 'undefined');
    case 'bigint':
      throw new NonCanonicalValueError(path, 'a bigint');
    case 'function':
      throw new NonCanonicalValueError(path, 'a function');
    case 'symbol':
      throw new NonCanonicalValueError(path, 'a symbol');
    default:
      break;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  }

  if (!isPlainObject(value)) {
    throw new NonCanonicalValueError(path, `a ${describeExotic(value)}`);
  }

  const sortedKeys = Object.keys(value).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    const property = value[key];
    // An absent key and a key set to undefined are the same JSON statement.
    if (property === undefined) continue;
    result[key] = canonicalize(property, `${path}.${key}`);
  }
  return result;
}

/**
 * A plain object is one whose prototype is `Object.prototype` or `null`.
 * Anything else — a Date, a Map, a class instance — carries state that
 * `Object.keys` does not see, and would hash as if it were empty.
 */
function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function describeExotic(value: object): string {
  const name = (value.constructor as { name?: string } | undefined)?.name;
  return name ? `${name} instance` : 'non-plain object';
}

/** SHA-256 of a UTF-8 string, returned as lowercase hex. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
