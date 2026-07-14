import { ObservationDiffSchema, type DistilledNode, type ObservationDiff } from './types.js';

/** Raised when an observation contains duplicate stable node IDs. */
export class ObservationIdentityError extends Error {
  constructor(readonly stableId: string) {
    super(`observation contains duplicate stable node ID ${stableId}`);
    this.name = 'ObservationIdentityError';
  }
}

/** Raised when an externally supplied observation diff is structurally inconsistent. */
export class ObservationDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObservationDiffError';
  }
}

/** Computes an ordered observation diff keyed by stable node ID. */
export function diffObservations(
  base: readonly DistilledNode[],
  current: readonly DistilledNode[],
): ObservationDiff {
  const baseById = uniqueNodeMap(base);
  const currentById = uniqueNodeMap(current);
  const added: DistilledNode[] = [];
  const updated: DistilledNode[] = [];
  const removed: string[] = [];

  for (const node of current) {
    const previous = baseById.get(node.id.hash);
    if (!previous) added.push(node);
    else if (!sameNode(previous, node)) updated.push(node);
  }
  for (const node of base) {
    if (!currentById.has(node.id.hash)) removed.push(node.id.hash);
  }
  return ObservationDiffSchema.parse({
    added,
    updated,
    removed,
    order: current.map((node) => node.id.hash),
  });
}

/** Applies a diff and reconstructs the current ordered observation exactly. */
export function applyObservationDiff(
  base: readonly DistilledNode[],
  input: ObservationDiff,
): DistilledNode[] {
  const diff = ObservationDiffSchema.parse(input);
  const nodes = uniqueNodeMap(base);
  const removed = uniqueIds(diff.removed, 'removed');
  const changed = uniqueNodeMap([...diff.updated, ...diff.added]);
  for (const stableId of removed) {
    if (!nodes.has(stableId)) throw new ObservationDiffError(`removed node ${stableId} does not exist in base`);
  }
  for (const node of diff.updated) {
    if (!nodes.has(node.id.hash) || removed.has(node.id.hash)) {
      throw new ObservationDiffError(`updated node ${node.id.hash} is not an active base node`);
    }
  }
  for (const node of diff.added) {
    if (nodes.has(node.id.hash) && !removed.has(node.id.hash)) {
      throw new ObservationDiffError(`added node ${node.id.hash} already exists in base`);
    }
  }
  for (const stableId of removed) nodes.delete(stableId);
  for (const node of changed.values()) nodes.set(node.id.hash, node);
  const order = uniqueIds(diff.order, 'order');
  if (order.size !== nodes.size) throw new ObservationDiffError('diff order does not cover every resulting node exactly once');
  return diff.order.map((stableId) => {
    const node = nodes.get(stableId);
    if (!node) throw new ObservationDiffError(`diff order references missing stable node ID ${stableId}`);
    return node;
  });
}

function uniqueNodeMap(nodes: readonly DistilledNode[]): Map<string, DistilledNode> {
  const mapped = new Map<string, DistilledNode>();
  for (const node of nodes) {
    if (mapped.has(node.id.hash)) throw new ObservationIdentityError(node.id.hash);
    mapped.set(node.id.hash, node);
  }
  return mapped;
}

function uniqueIds(ids: readonly string[], field: string): Set<string> {
  const unique = new Set(ids);
  if (unique.size !== ids.length) throw new ObservationDiffError(`${field} contains duplicate stable node IDs`);
  return unique;
}

function sameNode(left: DistilledNode, right: DistilledNode): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
