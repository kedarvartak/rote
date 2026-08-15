import type { CapturedElement, CapturedPage } from '@rote/browser';
import { sha256Hex } from '@rote/core';
import type { DistilledNode, NodeAffordance, StableNodeId } from './types.js';

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
      ...(element.context ? { context: element.context } : {}),
      ...(role === 'checkbox' || role === 'radio'
        ? { state: { checked: 'checked' in element.attributes } }
        : {}),
      ...(interactive ? { affordance: affordanceOf(element, page.url) } : {}),
    });
  }
  return nodes;
}

/**
 * Derives the control's observable contract facts (#143). Only capture-time
 * attributes participate — tag, type, href, disabled, multiple, draggable, and the
 * `data-rote-form-*` facts stamped by the browser package — so static and CDP
 * captures of the same document derive the same affordance.
 */
export function affordanceOf(element: CapturedElement, pageUrl: string): NodeAffordance {
  const attributes = element.attributes;
  const inputType = element.tag === 'input' ? (attributes['type'] ?? 'text').toLowerCase() : undefined;
  const control = controlOf(element, inputType);
  const formAction = attributes['data-rote-form-action'];
  const rawMethod = attributes['data-rote-form-method'];
  const formMethod = rawMethod === 'post' || rawMethod === 'dialog' ? rawMethod : rawMethod === 'get' ? 'get' : undefined;
  const inForm = formMethod !== undefined;
  const destination = element.tag === 'a' && attributes['href'] !== undefined
    ? destinationHash(attributes['href'], pageUrl)
    // Only controls that *go somewhere* carry a destination: links and submit
    // controls. A field's contract is about how it is filled, not where the form
    // later posts — otherwise an endpoint version bump would stop every fill.
    : inForm && control === 'submit'
      ? destinationHash(formAction ?? pageUrl, pageUrl)
      : undefined;
  const enterBehavior: NodeAffordance['enter_behavior'] = control === 'multi_line_text'
    ? 'inserts_newline'
    : control === 'single_line_text' && attributes['data-rote-implicit-submit'] === 'true'
      ? 'submits_form'
      : 'none';
  return {
    control,
    ...(inputType !== undefined ? { input_type: inputType } : {}),
    enter_behavior: enterBehavior,
    ...(destination !== undefined ? { destination_hash: destination } : {}),
    ...(formMethod !== undefined && destination !== undefined ? { form_method: formMethod } : {}),
    enabled: !('disabled' in attributes) && attributes['aria-disabled'] !== 'true',
    draggable: attributes['draggable'] === 'true',
  };
}

function controlOf(element: CapturedElement, inputType: string | undefined): NodeAffordance['control'] {
  if (element.tag === 'a') return 'link';
  if (element.tag === 'textarea') return 'multi_line_text';
  if (element.tag === 'select') return 'multiple' in element.attributes ? 'select_multiple' : 'select_single';
  if (element.tag === 'button') return (element.attributes['type'] ?? 'submit').toLowerCase() === 'submit' ? 'submit' : 'button';
  if (element.tag === 'input' && inputType) {
    if (inputType === 'submit' || inputType === 'image') return 'submit';
    if (inputType === 'button' || inputType === 'reset') return 'button';
    if (inputType === 'checkbox') return 'checkbox';
    if (inputType === 'radio') return 'radio';
    if (inputType === 'file') return 'file';
    return 'single_line_text';
  }
  const role = element.attributes['role'];
  if (role === 'link') return 'link';
  if (role === 'button') return 'button';
  return 'generic';
}

function destinationHash(target: string, pageUrl: string): string | undefined {
  try {
    const url = new URL(target, pageUrl);
    return sha256Hex(`${url.origin}${url.pathname}`).slice(0, 16);
  } catch {
    return undefined;
  }
}

function isVisible(element: CapturedElement): boolean {
  if (element.attributes['data-rote-visible'] === 'false') return false;
  if ('hidden' in element.attributes || element.attributes['aria-hidden'] === 'true') return false;
  if (element.tag === 'input' && element.attributes['type'] === 'hidden') return false;
  const style = element.attributes['style']?.replaceAll(' ', '').toLowerCase() ?? '';
  if (style.includes('display:none') || style.includes('visibility:hidden')) return false;
  // Opacity must be parsed, not substring-matched: "opacity:0.5" contains "opacity:0",
  // so a merely translucent control (mid-fade, cosmetic restyle) would silently vanish
  // from the observation and surface as a spurious removal in the diff.
  const opacity = /(?:^|;)opacity:([^;]+)/.exec(style);
  return opacity === null || Number.parseFloat(opacity[1]!) !== 0;
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
  const inputType = element.tag === 'input' ? (element.attributes['type'] ?? 'text') : undefined;
  const buttonValue = inputType && ['button', 'reset', 'submit'].includes(inputType)
    ? element.attributes['value']
    : undefined;
  return (
    element.attributes['aria-label'] ??
    element.attributes['data-rote-name'] ??
    element.attributes['placeholder'] ??
    element.attributes['name'] ??
    buttonValue ??
    element.text
  ).trim();
}

function selectorHint(element: CapturedElement): string | undefined {
  const capturedSelector = element.attributes['data-rote-selector'];
  if (capturedSelector) return capturedSelector;
  const id = element.attributes['id'];
  if (id) return `#${id}`;
  const name = element.attributes['name'];
  if (name) return `${element.tag}[name="${name}"]`;
  return undefined;
}

function stableId(element: CapturedElement, role: string, name: string): StableNodeId {
  const contextKey = element.attributes['data-rote-context-key'] ?? 'top';
  const containerLineage = element.attributes['data-rote-container-lineage'] ?? '';
  const contextHash = element.context?.contextHash ?? sha256Hex(contextKey).slice(0, 16);
  const containerHash = sha256Hex(containerLineage || 'root').slice(0, 16);
  // Selector hints and control values are deliberately excluded: v2 must survive
  // harmless selector drift without turning credentials into durable artifacts.
  // see docs/02-architecture.md "Stable IDs".
  return {
    version: 2,
    hash: sha256Hex(`v2\u0000${role}\u0000${name}\u0000${contextHash}\u0000${containerHash}`).slice(0, 16),
    contextHash,
    containerHash,
  };
}
