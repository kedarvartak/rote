import type { CapturedElement, CapturedPage } from '@rote/browser';
import { sha256Hex } from '@rote/core';
import type { DistilledNode, StableNodeId } from './types.js';

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'option']);
const CONTENT_TAGS = new Set(['h1', 'h2', 'h3', 'label', 'p']);

/** Converts a captured page into compact, stable, interactive/content-bearing nodes. */
export function distillPage(page: CapturedPage): DistilledNode[] {
  return page.elements
    .filter(isUsefulElement)
    .map((element) => {
      const role = roleOf(element);
      const name = nameOf(element);
      return {
        id: stableId(element, role, name),
        role,
        name,
        tag: element.tag,
        selectorHint: selectorHint(element),
        depth: element.depth,
        interactive: isInteractive(element),
      };
    });
}

function isUsefulElement(element: CapturedElement): boolean {
  return isInteractive(element) || CONTENT_TAGS.has(element.tag) || Boolean(element.attributes['role']);
}

function isInteractive(element: CapturedElement): boolean {
  return INTERACTIVE_TAGS.has(element.tag) || Boolean(element.attributes['onclick']) || element.attributes['role'] === 'button' || element.attributes['role'] === 'link';
}

function roleOf(element: CapturedElement): string {
  const explicit = element.attributes['role'];
  if (explicit) return explicit;
  if (element.tag === 'a') return 'link';
  if (element.tag === 'input') return element.attributes['type'] === 'submit' ? 'button' : 'textbox';
  if (element.tag === 'select') return 'combobox';
  if (element.tag === 'textarea') return 'textbox';
  if (element.tag.startsWith('h')) return 'heading';
  return element.tag;
}

function nameOf(element: CapturedElement): string {
  return (
    element.attributes['aria-label'] ??
    element.attributes['name'] ??
    element.attributes['placeholder'] ??
    element.attributes['value'] ??
    element.text
  ).trim();
}

function selectorHint(element: CapturedElement): string | undefined {
  const id = element.attributes['id'];
  if (id) return `#${id}`;
  const name = element.attributes['name'];
  if (name) return `${element.tag}[name="${name}"]`;
  return undefined;
}

function stableId(element: CapturedElement, role: string, name: string): StableNodeId {
  const ancestryBucket = Math.floor(element.depth / 2);
  // Selector hints are deliberately excluded: IDs must survive an id/name attribute rename
  // so the action resolver can recover through the semantic fallback chain (docs/16 C2).
  return { hash: sha256Hex(`${role}\u0000${name}\u0000${ancestryBucket}`).slice(0, 16) };
}
