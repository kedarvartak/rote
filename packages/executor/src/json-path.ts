/**
 * Minimal dot/bracket path resolver for `json_path_exists`/`json_path_equals`
 * — deliberately not a full JSONPath engine (no wildcards, no filters, no
 * expressions). The closed Expect DSL forbids arbitrary code execution
 * (docs/06-build-plan.md M0); a plain property-path lookup is data access,
 * not code, so it stays inside that constraint. Supports `a.b.c` and
 * `a.b[0].c` / `a[0].b`.
 */

const SEGMENT_PATTERN = /[^.[\]]+/g;

function segments(path: string): string[] {
  return path.match(SEGMENT_PATTERN) ?? [];
}

const NOT_FOUND = Symbol('json-path-not-found');

function resolve(value: unknown, path: string): unknown | typeof NOT_FOUND {
  let current: unknown = value;
  for (const segment of segments(path)) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return NOT_FOUND;
    }
    const key = /^\d+$/.test(segment) ? Number(segment) : segment;
    if (Array.isArray(current)) {
      if (typeof key !== 'number' || key < 0 || key >= current.length) return NOT_FOUND;
      current = current[key];
    } else {
      const record = current as Record<string, unknown>;
      if (!(String(key) in record)) return NOT_FOUND;
      current = record[String(key)];
    }
  }
  return current;
}

export function jsonPathExists(value: unknown, path: string): boolean {
  return resolve(value, path) !== NOT_FOUND;
}

export function jsonPathGet(value: unknown, path: string): unknown {
  const result = resolve(value, path);
  return result === NOT_FOUND ? undefined : result;
}
