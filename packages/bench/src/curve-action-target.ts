// see docs/testing/T38-predictor-kill-gate.md "Honest reading" — the kill gate's
// carried condition: curve runs must record *what* each action targeted, not only
// its verb, so the whole-action predictor number is measured on real pages. The
// target is value-free by construction: a stable identity ref, a selector, or a
// URL path — never a typed value, credential, or query string.

/** The subset of a browser action a predictor must reproduce: verb plus a value-free target. */
export interface CurveActionLike {
  kind: string;
  stableId?: string | undefined;
  selector?: string | undefined;
  url?: string | undefined;
}

/**
 * Value-free target of one browser action for curve records and predictor keys:
 * `done` → '' ; `navigate` → URL pathname (origin and query dropped); element
 * verbs → stable identity ref when recorded, else the selector.
 */
export function curveActionTarget(action: CurveActionLike): string {
  if (action.kind === 'done') return '';
  if (action.kind === 'navigate') return action.url === undefined ? '' : urlPath(action.url);
  return action.stableId ?? action.selector ?? '';
}

function urlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
