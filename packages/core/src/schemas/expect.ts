import { z } from 'zod';

const ExitCode = z.object({ exit_code: z.number().int() }).strict();
const SelectorVisible = z.object({ selector_visible: z.string().min(1) }).strict();
const SelectorAbsent = z.object({ selector_absent: z.string().min(1) }).strict();
const InputValue = z.object({ input_value: z.string().min(1), equals: z.string() }).strict();
const UrlContains = z.object({ url_contains: z.string().min(1) }).strict();
const TextVisible = z.object({ text_visible: z.string().min(1) }).strict();
const JsonPathExists = z.object({ json_path_exists: z.string().min(1) }).strict();
const JsonPathEquals = z.object({ json_path_equals: z.string().min(1), equals: z.unknown() }).strict();
const OutputMatches = z.object({ output_matches: z.string().min(1) }).strict();
const Nonempty = z.object({ nonempty: z.literal(true) }).strict();

/**
 * The closed Expect DSL (docs/02-architecture.md "Assertion synthesis" /
 * "Expect DSL v1"). Exactly one assertion primitive per object; no arbitrary
 * code execution. Extending the DSL means deliberately adding a branch here,
 * never accepting a free-form predicate.
 */
export const ExpectSchema = z.union([
  ExitCode,
  SelectorVisible,
  SelectorAbsent,
  InputValue,
  UrlContains,
  TextVisible,
  JsonPathExists,
  JsonPathEquals,
  OutputMatches,
  Nonempty,
]);
export type Expect = z.infer<typeof ExpectSchema>;

/** Browser-observable subset of the Expect DSL used for live action postconditions. */
export const BrowserExpectSchema = z.union([
  SelectorVisible,
  SelectorAbsent,
  InputValue,
  UrlContains,
  TextVisible,
]);
export type BrowserExpect = z.infer<typeof BrowserExpectSchema>;

export const EXPECT_PRIMITIVE_NAMES = [
  'exit_code',
  'selector_visible',
  'selector_absent',
  'input_value',
  'url_contains',
  'text_visible',
  'json_path_exists',
  'json_path_equals',
  'output_matches',
  'nonempty',
] as const;
