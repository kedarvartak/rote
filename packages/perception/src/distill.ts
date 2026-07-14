import type { CapturedElement, CapturedPage } from '@rote/browser';
import { sha256Hex } from '@rote/core';
import type { DistilledNode, StableNodeId } from './types.js';

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea']);
const CONTENT_TAGS = new Set(['h1', 'h2', 'h3', 'label', 'p']);

/** Converts a captured page into compact, stable, interactive/content-bearing nodes. */
export function distillPage(page: CapturedPage): DistilledNode[] {
  const seenContent = new Set<string>();
  const nodes: DistilledNode[] = [];
  for (const element of page.elements) {
    if (!isVisible(element)) continue;
    // Associated label text is copied onto its control at capture time; keeping both
    // repeats the same semantics and spends tokens without adding an action target.
    if (element.tag === 'label' && element.attributes['for']) continue;
    const role = roleOf(element);
    const name = nameOf(element);
    const interactive = isInteractive(element);
    if (!interactive && !element.attributes['role'] && !(CONTENT_TAGS.has(element.tag) && name)) continue;
    // Repeated non-interactive labels/headings add tokens but no new action target.
    const contentKey = `${role}\u0000${name}`;
    if (!interactive && seenContent.has(contentKey)) continue;
    if (!interactive) seenContent.add(contentKey);
    nodes.push({
      id: stableId(element, role, name),
      role,
      name,
      tag: element.tag,
      selectorHint: selectorHint(element),
      depth: element.depth,
      interactive,
    });
  }
  return nodes;
}

function isVisible(element: CapturedElement): boolean {
  if (element.attributes['data-rote-visible'] === 'false') return false;
  if ('hidden' in element.attributes || element.attributes['aria-hidden'] === 'true') return false;
  if (element.tag === 'input' && element.attributes['type'] === 'hidden') return false;
  const style = element.attributes['style']?.replaceAll(' ', '').toLowerCase() ?? '';
  return !style.includes('display:none') && !style.includes('visibility:hidden') && !style.includes('opacity:0');
}

function isInteractive(element: CapturedElement): boolean {
  return INTERACTIVE_TAGS.has(element.tag) || Boolean(element.attributes['onclick']) || element.attributes['role'] === 'button' || element.attributes['role'] === 'link';
}

function roleOf(element: CapturedElement): string {
  const explicit = element.attributes['role'];
  if (explicit) return explicit;
  if (element.tag === 'a') return 'link';
  if (element.tag === 'button') return 'button';
  if (element.tag === 'input') {
    const type = element.attributes['type'] ?? 'text';
    if (type === 'submit' || type === 'button') return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    return 'textbox';
  }
  if (element.tag === 'select') return 'combobox';
  if (element.tag === 'textarea') return 'textbox';
  if (element.tag.startsWith('h')) return 'heading';
  return element.tag;
}

function nameOf(element: CapturedElement): string {
  return (
    element.attributes['aria-label'] ??
    element.attributes['data-rote-name'] ??
    element.attributes['placeholder'] ??
    element.attributes['name'] ??
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
