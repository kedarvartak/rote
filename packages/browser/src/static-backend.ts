import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '@rote/core';
import type { BrowserCaptureBackend, CapturedElement, CapturedPage } from './types.js';

/** Deterministic fixture backend used until the CDP backend lands in the next P1 slice. */
export class StaticHtmlBackend implements BrowserCaptureBackend {
  async capture(url: string): Promise<CapturedPage> {
    const path = url.startsWith('file:') ? fileURLToPath(url) : url;
    const html = await readFile(path, 'utf8');
    return captureStaticHtml(url, html);
  }
}

/** Captures static HTML into the same page shape the CDP backend will produce. */
export function captureStaticHtml(url: string, html: string): CapturedPage {
  const title = textOfFirst(html, 'title');
  return {
    url,
    title,
    html,
    elements: enrichAccessibility(parseElements(html), html),
  };
}

const ELEMENT_RE = /<\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>([\s\S]*?)(?=<\s*\/[a-zA-Z][^>]*>|<\s*[a-zA-Z][^>]*>|$)/g;
const ATTR_RE = /([:@a-zA-Z_][:@a-zA-Z0-9_.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g;
const VOID_OR_INLINE = new Set(['input', 'button', 'a', 'select', 'textarea', 'option', 'label', 'h1', 'h2', 'h3', 'p']);

function parseElements(html: string): CapturedElement[] {
  const elements: CapturedElement[] = [];
  const lineageByOffset = containerLineageByOffset(html);
  const formByOffset = enclosingFormByOffset(html);
  let match: RegExpExecArray | null;
  while ((match = ELEMENT_RE.exec(html)) !== null) {
    const tag = match[1]?.toLowerCase();
    if (!tag || tag.startsWith('!') || tag === 'script' || tag === 'style') continue;
    const attrs = parseAttributes(match[2] ?? '');
    const hadCapturedAttributes = Object.keys(attrs).length > 0;
    // see docs/02-architecture.md "Stable IDs" — only hashed, allowlisted
    // container landmarks cross the capture boundary; form values never participate.
    attrs['data-rote-context-key'] = 'top';
    attrs['data-rote-container-lineage'] = (lineageByOffset.get(match.index) ?? []).join(',');
    // Observable action-contract facts (#143), mirroring the CDP decorator: the
    // enclosing form's action path/method and whether Enter would submit it.
    const form = formByOffset.get(match.index);
    if (form && ['input', 'textarea', 'select', 'button'].includes(tag)) {
      if (form.action !== undefined) attrs['data-rote-form-action'] = form.action;
      attrs['data-rote-form-method'] = form.method;
      if (tag === 'input') attrs['data-rote-implicit-submit'] = form.implicitSubmit ? 'true' : 'false';
    }
    const text = stripTags(match[3] ?? '').trim().replace(/\s+/g, ' ');
    const before = html.slice(0, match.index);
    const depth = Math.max(0, (before.match(/</g)?.length ?? 0) - (before.match(/<\s*\//g)?.length ?? 0));
    if (VOID_OR_INLINE.has(tag) || hadCapturedAttributes || text.length > 0) {
      elements.push({ tag, attributes: attrs, text, depth });
    }
  }
  return elements;
}

const TAG_RE = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const CONTAINER_TAGS = new Set(['article', 'dialog', 'fieldset', 'form', 'main', 'nav', 'section', 'table', 'tbody', 'tr']);

interface OpenElement {
  tag: string;
  landmark?: string;
}

function containerLineageByOffset(html: string): Map<number, string[]> {
  const lineage = new Map<number, string[]>();
  const stack: OpenElement[] = [];
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(html)) !== null) {
    const closing = match[1] === '/';
    const tag = match[2]!.toLowerCase();
    if (closing) {
      const opening = stack.map((entry) => entry.tag).lastIndexOf(tag);
      if (opening >= 0) stack.splice(opening);
      continue;
    }
    lineage.set(match.index, stack.flatMap((entry) => entry.landmark ? [entry.landmark] : []));
    const attributes = parseAttributes(match[3] ?? '');
    const landmark = containerLandmark(tag, attributes);
    if (!VOID_TAGS.has(tag) && !match[3]?.trimEnd().endsWith('/')) stack.push({ tag, landmark });
  }
  return lineage;
}

interface EnclosingForm {
  action?: string;
  method: string;
  implicitSubmit: boolean;
}

/** Nearest enclosing `<form>` per element offset with the facts a fill/click contract needs. */
function enclosingFormByOffset(html: string): Map<number, EnclosingForm> {
  const forms: Array<{ start: number; end: number; form: EnclosingForm }> = [];
  const open: Array<{ start: number; attributes: Record<string, string> }> = [];
  let match: RegExpExecArray | null;
  const FORM_RE = /<\s*(\/?)\s*form\b([^>]*)>/gi;
  while ((match = FORM_RE.exec(html)) !== null) {
    if (match[1] === '/') {
      const opened = open.pop();
      if (!opened) continue;
      const body = html.slice(opened.start, match.index);
      const implicitSubmit = /<\s*button\b(?![^>]*type\s*=\s*["']?(?:button|reset))/i.test(body)
        || /<\s*input\b[^>]*type\s*=\s*["']?(?:submit|image)/i.test(body)
        || (body.match(/<\s*input\b(?![^>]*type\s*=\s*["']?(?:hidden|checkbox|radio|submit|button|reset|file|image))/gi)?.length ?? 0) === 1;
      const rawAction = opened.attributes['action'];
      forms.push({
        start: opened.start,
        end: match.index,
        form: {
          ...(rawAction !== undefined ? { action: rawAction } : {}),
          method: (opened.attributes['method'] ?? 'get').toLowerCase(),
          implicitSubmit,
        },
      });
    } else {
      open.push({ start: match.index, attributes: parseAttributes(match[2] ?? '') });
    }
  }
  const byOffset = new Map<number, EnclosingForm>();
  let element: RegExpExecArray | null;
  const OFFSET_RE = /<\s*[a-zA-Z][a-zA-Z0-9-]*[^>]*>/g;
  while ((element = OFFSET_RE.exec(html)) !== null) {
    // Innermost enclosing form wins (last pushed forms close first, so search smallest span).
    let best: { start: number; end: number; form: EnclosingForm } | undefined;
    for (const candidate of forms) {
      if (candidate.start < element.index && element.index < candidate.end && (!best || candidate.end - candidate.start < best.end - best.start)) best = candidate;
    }
    if (best) byOffset.set(element.index, best.form);
  }
  return byOffset;
}

function containerLandmark(tag: string, attributes: Record<string, string>): string | undefined {
  const rowKey = attributes['data-row-key'];
  const ariaLabel = attributes['aria-label'];
  const role = attributes['role'];
  if (!CONTAINER_TAGS.has(tag) && !rowKey && !ariaLabel && !role) return undefined;
  return sha256Hex(`${tag}\u0000${role ?? ''}\u0000${ariaLabel ?? ''}\u0000${rowKey ?? ''}`).slice(0, 16);
}

function enrichAccessibility(elements: CapturedElement[], html: string): CapturedElement[] {
  const textById = new Map<string, string>();
  const labelByTarget = labelsFromHtml(html);
  for (const element of elements) {
    const id = element.attributes['id'];
    if (id && element.text) textById.set(id, element.text);
    const target = element.tag === 'label' ? element.attributes['for'] : undefined;
    if (target && element.text && !labelByTarget.has(target)) labelByTarget.set(target, element.text);
  }
  return elements.map((element) => {
    const id = element.attributes['id'];
    const labelledBy = element.attributes['aria-labelledby']
      ?.split(/\s+/)
      .map((labelId) => textById.get(labelId))
      .filter((text): text is string => Boolean(text))
      .join(' ');
    const accessibleName = element.attributes['aria-label'] ?? labelledBy ?? (id ? labelByTarget.get(id) : undefined);
    if (!accessibleName) return element;
    return { ...element, attributes: { ...element.attributes, 'data-rote-name': accessibleName } };
  });
}

function labelsFromHtml(html: string): Map<string, string> {
  const labels = new Map<string, string>();
  const labelPattern = /<label\b([^>]*)>([\s\S]*?)<\/label\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = labelPattern.exec(html)) !== null) {
    const target = parseAttributes(match[1] ?? '')['for'];
    const text = stripTags(match[2] ?? '').trim().replace(/\s+/g, ' ');
    if (target && text) labels.set(target, text);
  }
  return labels;
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw)) !== null) {
    const key = match[1];
    if (!key) continue;
    attrs[key] = decodeHtmlEntities(match[3] ?? match[4] ?? match[5] ?? 'true');
  }
  return attrs;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

function textOfFirst(html: string, tag: string): string {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(html);
  return stripTags(match?.[1] ?? '').trim().replace(/\s+/g, ' ');
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ');
}
