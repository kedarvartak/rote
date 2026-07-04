/**
 * The executor's model of "what the world looks like right now," built up
 * from each step's observable output so `expect`/`verify` can check it. The
 * Expect DSL (docs/06-build-plan.md M0) is tool-agnostic, so this file
 * defines the one convention every tool result is read through: a tool's
 * raw result may optionally carry `url`, `visible_selectors`,
 * `input_values`, and `visible_text` fields; anything else is only visible
 * to `json_path_*`/`output_matches`/`nonempty` via the step's own raw
 * result. This mapping is this package's interpretive contribution — the
 * design docs specify the assertion primitives, not how they read a tool's
 * JSON payload (see packages/executor/README.md "Known v1 limitations").
 */

export interface Observation {
  exit_code?: number;
  url?: string;
  visible_selectors?: string[];
  input_values?: Record<string, string>;
  visible_text?: string[];
}

export interface WorldState {
  url?: string;
  visible_selectors: string[];
  input_values: Record<string, string>;
  visible_text: string[];
  /** The most recent step's raw output, for json_path_exists/equals, output_matches, and nonempty. */
  last_exit_code?: number;
  last_json: unknown;
  last_output: string;
}

export function initialWorldState(): WorldState {
  return {
    visible_selectors: [],
    input_values: {},
    visible_text: [],
    last_json: undefined,
    last_output: '',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the observation convention out of a raw tool result. Pure. */
export function observationFromResult(raw: unknown): Observation {
  if (!isRecord(raw)) return {};
  const obs: Observation = {};
  if (typeof raw['exit_code'] === 'number') obs.exit_code = raw['exit_code'];
  if (typeof raw['url'] === 'string') obs.url = raw['url'];
  if (Array.isArray(raw['visible_selectors'])) {
    obs.visible_selectors = raw['visible_selectors'].filter((v): v is string => typeof v === 'string');
  }
  if (isRecord(raw['input_values'])) {
    const entries = Object.entries(raw['input_values']).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    obs.input_values = Object.fromEntries(entries);
  }
  if (Array.isArray(raw['visible_text'])) {
    obs.visible_text = raw['visible_text'].filter((v): v is string => typeof v === 'string');
  } else if (typeof raw['text'] === 'string') {
    obs.visible_text = [raw['text']];
  }
  return obs;
}

/** An LLM completion's own output, read the same way a tool result's `output` would be. Pure. */
export function observationFromText(text: string): Observation {
  return { visible_text: [text] };
}

/**
 * Folds one step's observation into the running world state. Fields the
 * observation doesn't mention persist from before (e.g. a `browser.fill`
 * call needn't repeat the page's whole visible-selector list) — this
 * models a persistent world, not a per-step-scoped snapshot. `last_json`/
 * `last_output`/`last_exit_code` always reflect the most recent step,
 * scoped rather than accumulated, since those primitives check "did this
 * action's own output look right." Pure.
 */
export function mergeWorldState(state: WorldState, obs: Observation, rawResult: unknown): WorldState {
  return {
    url: obs.url ?? state.url,
    visible_selectors: obs.visible_selectors ?? state.visible_selectors,
    input_values: obs.input_values ? { ...state.input_values, ...obs.input_values } : state.input_values,
    visible_text: obs.visible_text ?? state.visible_text,
    last_exit_code: obs.exit_code ?? state.last_exit_code,
    last_json: rawResult,
    last_output: typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult ?? null),
  };
}
