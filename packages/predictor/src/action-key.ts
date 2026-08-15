import type { TrajectoryEvent } from '@rote/core';

// see docs/05-roadmap.md P2 item 10 — a predictor must reproduce *what to do and
// to which control*. The key is value-free by construction: verb plus a stable
// identity ref, a selector, or a URL path — never a typed value or query string.

/** One action reduced to what a predictor must get right. */
export interface ActionKey {
  kind: string;
  /** Stable identity ref when recorded, else the selector; URL path for navigate; '' for done. */
  target: string;
}

/** The subset of a browser action the key is derived from. */
export interface ActionLike {
  kind: string;
  stableId?: string | undefined;
  selector?: string | undefined;
  url?: string | undefined;
}

/** Value-free target of one action (shared with the bench curve recorder so live and offline keys agree). */
export function actionTarget(action: ActionLike): string {
  if (action.kind === 'done') return '';
  if (action.kind === 'navigate') return action.url === undefined ? '' : urlPath(action.url);
  return action.stableId ?? action.selector ?? '';
}

export function actionKeyOf(action: ActionLike): ActionKey {
  return { kind: action.kind, target: actionTarget(action) };
}

/** Key of a recorded trajectory event (`browser.<kind>` tools). */
export function actionKeyFromEvent(event: TrajectoryEvent): ActionKey {
  const kind = event.tool.replace(/^browser\./, '');
  const args = event.args;
  const optional = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : undefined);
  return actionKeyOf({ kind, stableId: optional('stableId'), selector: optional('selector'), url: optional('url') });
}

export function actionKeyId(key: ActionKey): string {
  return `${key.kind} ${key.target}`;
}

export function sameAction(left: ActionKey | undefined, right: ActionKey | undefined): boolean {
  return left !== undefined && right !== undefined && left.kind === right.kind && left.target === right.target;
}

function urlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
