import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { extractParamRefs, renderTemplate, UnboundParamError } from '../src/template.js';

// CLAUDE.md "Testing": property-based tests for templating. The property that
// matters is not that substitution works on an example — it is that the two
// readers of a template agree. `extractParamRefs` decides whether a playbook is
// *valid* (PlaybookSchema rejects an undeclared param); `renderTemplate` decides
// what is *dispatched*. A template the first reads as reference-free and the
// second demands a binding for is a playbook that validates and then fails at
// replay; the reverse is a playbook rejected for a param it never uses.

/**
 * Param names the grammar accepts (`\w+`), including the ones that live on
 * `Object.prototype`. Generating those is what found the binding check reading
 * through the prototype chain.
 */
const paramName = fc.oneof(
  fc.stringMatching(/^\w{1,8}$/),
  fc.constantFrom('toString', 'valueOf', 'constructor', 'hasOwnProperty', 'isPrototypeOf', '__proto__'),
);

/** Text that never contains a brace or backslash, so it cannot form a reference. */
const inertText = fc.string({ maxLength: 12 }).map((s) => s.replaceAll(/[{}\\]/g, '.'));

/** A template string assembled from inert text, live refs and escaped refs. */
const templateString = fc.array(
  fc.oneof(
    inertText,
    paramName.map((name) => `{{${name}}}`),
    paramName.map((name) => `\\{{${name}}}`),
  ),
  { maxLength: 6 },
).map((parts) => parts.join(''));

/** A JSON-ish structure whose leaves are template strings. */
const templateValue = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    templateString,
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    tie('array') as fc.Arbitrary<unknown>,
    tie('object') as fc.Arbitrary<unknown>,
  ),
  array: fc.array(tie('value'), { maxLength: 3 }),
  object: fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), tie('value'), { maxKeys: 3 }),
})).value;

const bindingsFor = (names: readonly string[]) =>
  Object.fromEntries(names.map((name) => [name, `<${name}>`]));

describe('templating properties', () => {
  it('renders whatever it extracted: bindings for the extracted refs are always enough', () => {
    // The agreement that PlaybookSchema depends on — a playbook whose declared
    // params cover every extracted ref must never fail at replay for a missing
    // binding.
    fc.assert(fc.property(templateValue, (value) => {
      expect(() => renderTemplate(value, bindingsFor(extractParamRefs(value)))).not.toThrow();
    }));
  });

  it('demands exactly what it extracted: dropping any one binding fails, naming that param', () => {
    // ...and the converse, which is what stops a playbook from being rejected
    // for a param it does not really use.
    fc.assert(fc.property(templateValue, (value) => {
      const refs = extractParamRefs(value);
      fc.pre(refs.length > 0);
      for (const omitted of refs) {
        const partial = bindingsFor(refs.filter((name) => name !== omitted));
        expect(() => renderTemplate(value, partial)).toThrow(UnboundParamError);
      }
    }));
  });

  it('leaves behind exactly the references it was told to leave behind', () => {
    // Every live reference is substituted; the only `{{...}}` text remaining in
    // the output is what an escape asked for. Stating it as "no references
    // remain" would be false — and the property found that on its first run,
    // shrinking straight to `\\{{a}}`.
    fc.assert(fc.property(templateString, (template) => {
      const rendered = renderTemplate(template, bindingsFor(extractParamRefs(template)));
      expect(typeof rendered).toBe('string');
      expect(liveRefs(rendered as string)).toHaveLength(escapedRefs(template).length);
    }));
  });

  it('never re-renders a substituted value, so a value containing a reference is inert', () => {
    // A page-derived value like "{{total}}" must be dispatched as those exact
    // characters, never used to reach another binding.
    fc.assert(fc.property(paramName, paramName, (outer, inner) => {
      fc.pre(outer !== inner);
      const rendered = renderTemplate(`{{${outer}}}!`, { [outer]: `{{${inner}}}`, [inner]: 'REACHED' });
      expect(rendered).toBe(`{{${inner}}}!`);
    }));
  });

  it('preserves the shape it was given', () => {
    fc.assert(fc.property(templateValue, (value) => {
      const rendered = renderTemplate(value, bindingsFor(extractParamRefs(value)));
      expect(shapeOf(rendered)).toEqual(shapeOf(value));
    }));
  });

  it('preserves a sole reference\'s type, and stringifies it anywhere else', () => {
    fc.assert(fc.property(
      paramName,
      fc.oneof(fc.string(), fc.integer(), fc.double({ noNaN: true, noDefaultInfinity: true }), fc.boolean()),
      (name, bound) => {
        expect(renderTemplate(`{{${name}}}`, { [name]: bound })).toBe(bound);
        expect(renderTemplate(`x{{${name}}}`, { [name]: bound })).toBe(`x${String(bound)}`);
      },
    ));
  });

  it('is unaffected by a binding nothing references', () => {
    fc.assert(fc.property(templateValue, paramName, (value, extra) => {
      fc.pre(!extractParamRefs(value).includes(extra));
      const refs = bindingsFor(extractParamRefs(value));
      expect(renderTemplate(value, refs)).toEqual(renderTemplate(value, { ...refs, [extra]: 'unused' }));
    }));
  });

  it('never treats an escaped reference as a reference, in either reader', () => {
    fc.assert(fc.property(paramName, inertText, (name, text) => {
      const template = `${text}\\{{${name}}}`;
      expect(extractParamRefs(template)).toEqual([]);
      expect(renderTemplate(template, {})).toBe(`${text}{{${name}}}`);
    }));
  });

  it('consumes the escaping backslash, so rendering is not idempotent on escapes', () => {
    // Documented, not accidental: `\{{a}}` renders to the literal `{{a}}`, and
    // rendering *that* again would substitute it. Playbooks are rendered once
    // per replay, so this is pinned rather than fixed — see the note on
    // `renderTemplate` and issue #211 for the gap it leaves.
    const once = renderTemplate('\\{{a}}', { a: 'X' });
    expect(once).toBe('{{a}}');
    expect(renderTemplate(once, { a: 'X' })).toBe('X');
  });

  it.each(['toString', 'valueOf', 'constructor', 'hasOwnProperty', 'isPrototypeOf', '__proto__'])(
    'treats {{%s}} as unbound, though every object inherits it',
    (name) => {
      // Regression: the binding check used `name in bindings`, which walks the
      // prototype chain. `{{toString}}` with no bindings at all rendered
      // `Object.prototype.toString` — as a function value for a sole reference,
      // or as the text "function toString() { [native code] }" inside a longer
      // string, which is then dispatched into the page.
      expect(() => renderTemplate(`{{${name}}}`, {})).toThrow(UnboundParamError);
      expect(() => renderTemplate(`prefix-{{${name}}}`, {})).toThrow(UnboundParamError);
      expect(renderTemplate(`{{${name}}}`, { [name]: 'bound' })).toBe('bound');
    },
  );

  it('cannot express a literal backslash immediately before a live reference (#211)', () => {
    // A Windows-style `C:\{{path}}` is read as an escape by both readers: the
    // backslash is consumed and the parameter is not substituted. Pinned so the
    // behaviour is a decision on record rather than a surprise.
    expect(extractParamRefs('C:\\{{path}}')).toEqual([]);
    expect(renderTemplate('C:\\{{path}}', { path: 'reports' })).toBe('C:{{path}}');
  });
});

/** Unescaped `{{name}}` occurrences remaining in rendered text. */
function liveRefs(text: string): string[] {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)]
    .filter((match) => (match.index ?? 0) === 0 || text[(match.index ?? 0) - 1] !== '\\')
    .map((match) => match[1] as string);
}

/** Escaped `\{{name}}` occurrences in a template — the ones that survive as text. */
function escapedRefs(text: string): string[] {
  return [...text.matchAll(/\\\{\{(\w+)\}\}/g)].map((match) => match[1] as string);
}

/** Structure with every leaf replaced by its type, for shape comparison. */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shapeOf);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shapeOf((value as Record<string, unknown>)[key])]));
  }
  return typeof value;
}
