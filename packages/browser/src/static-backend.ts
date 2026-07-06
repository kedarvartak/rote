import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
    elements: parseElements(html),
  };
}

const ELEMENT_RE = /<\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>([\s\S]*?)(?=<\s*\/[a-zA-Z][^>]*>|<\s*[a-zA-Z][^>]*>|$)/g;
const ATTR_RE = /([:@a-zA-Z_][:@a-zA-Z0-9_.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g;
const VOID_OR_INLINE = new Set(['input', 'button', 'a', 'select', 'textarea', 'option', 'label', 'h1', 'h2', 'h3', 'p']);

function parseElements(html: string): CapturedElement[] {
  const elements: CapturedElement[] = [];
  let match: RegExpExecArray | null;
  while ((match = ELEMENT_RE.exec(html)) !== null) {
    const tag = match[1]?.toLowerCase();
    if (!tag || tag.startsWith('!') || tag === 'script' || tag === 'style') continue;
    const attrs = parseAttributes(match[2] ?? '');
    const text = stripTags(match[3] ?? '').trim().replace(/\s+/g, ' ');
    const before = html.slice(0, match.index);
    const depth = Math.max(0, (before.match(/</g)?.length ?? 0) - (before.match(/<\s*\//g)?.length ?? 0));
    if (VOID_OR_INLINE.has(tag) || Object.keys(attrs).length > 0 || text.length > 0) {
      elements.push({ tag, attributes: attrs, text, depth });
    }
  }
  return elements;
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw)) !== null) {
    const key = match[1];
    if (!key) continue;
    attrs[key] = match[3] ?? match[4] ?? match[5] ?? 'true';
  }
  return attrs;
}

function textOfFirst(html: string, tag: string): string {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(html);
  return stripTags(match?.[1] ?? '').trim().replace(/\s+/g, ' ');
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ');
}
