const PARAM_REF_PATTERN = /\{\{(\w+)\}\}/g;
const SOLE_PARAM_REF_PATTERN = /^\{\{(\w+)\}\}$/;

/**
 * Both patterns above have exactly one, non-optional capture group, so a
 * match always has it populated — this just gives that guarantee a name
 * instead of asserting `!` at every call site (noUncheckedIndexedAccess
 * otherwise types `match[1]` as possibly undefined).
 */
function capturedName(match: RegExpMatchArray): string {
  const name = match[1];
  if (name === undefined) {
    throw new Error('unreachable: PARAM_REF_PATTERN always captures a group');
  }
  return name;
}

export type ParamBindings = Record<string, string | number | boolean>;

export class UnboundParamError extends Error {
  constructor(public readonly paramName: string) {
    super(`Parameter "${paramName}" is referenced but has no bound value`);
    this.name = 'UnboundParamError';
  }
}

/**
 * Recursively collects every {{param}} reference in a JSON-like value.
 * A literal `{{` is written with a backslash escape — `\{{name}}` yields the
 * literal text `{{name}}` and is never counted as a reference.
 */
export function extractParamRefs(value: unknown): string[] {
  const refs = new Set<string>();
  walkStrings(value, (str) => {
    for (const match of str.matchAll(PARAM_REF_PATTERN)) {
      const start = match.index ?? 0;
      if (start > 0 && str[start - 1] === '\\') continue; // escaped, not a real reference
      refs.add(capturedName(match));
    }
  });
  return [...refs];
}

function walkStrings(value: unknown, onString: (s: string) => void): void {
  if (typeof value === 'string') {
    onString(value);
  } else if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, onString);
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) walkStrings(v, onString);
  }
}

/**
 * Substitutes every {{param}} in a JSON-like value with its bound value.
 * Throws UnboundParamError if a referenced param has no binding — an
 * undeclared/unbound param is never silently rendered as an empty string
 * (docs/05-roadmap.md M0 "Templating").
 */
export function renderTemplate(value: unknown, bindings: ParamBindings): unknown {
  if (typeof value === 'string') {
    return renderString(value, bindings);
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderTemplate(item, bindings));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      result[key] = renderTemplate(v, bindings);
    }
    return result;
  }
  return value;
}

function renderString(str: string, bindings: ParamBindings): unknown {
  // A string that is *exactly* one param reference preserves the bound
  // value's original type (so a numeric `amount` stays a number, not "42").
  const soleMatch = str.match(SOLE_PARAM_REF_PATTERN);
  if (soleMatch) {
    const paramName = capturedName(soleMatch);
    if (!(paramName in bindings)) throw new UnboundParamError(paramName);
    return bindings[paramName];
  }

  let result = '';
  let lastIndex = 0;
  for (const match of str.matchAll(PARAM_REF_PATTERN)) {
    const start = match.index ?? 0;
    const escaped = start > 0 && str[start - 1] === '\\';
    const paramName = capturedName(match);
    result += str.slice(lastIndex, escaped ? start - 1 : start);
    if (escaped) {
      result += `{{${paramName}}}`;
    } else {
      if (!(paramName in bindings)) throw new UnboundParamError(paramName);
      result += String(bindings[paramName]);
    }
    lastIndex = start + match[0].length;
  }
  result += str.slice(lastIndex);
  return result;
}
