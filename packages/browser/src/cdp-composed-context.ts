import { sha256Hex } from '@rote/core';
import { browserContextCoordinate, BrowserContextMismatchError, BrowsingContextStaleError } from './browser-context.js';
import { captureStaticHtml } from './static-backend.js';
import type { CdpClient } from './cdp-client.js';
import type { BrowserContextCoordinate, BrowserContextSegment, CapturedElement, CapturedPage, UnsupportedBrowserContext } from './types.js';

interface CdpFrame {
  id: string;
  parentId?: string;
  loaderId: string;
  name?: string;
  url: string;
}
interface CdpFrameTree { frame: CdpFrame; childFrames?: CdpFrameTree[] }
interface SerializedShadow {
  mode: 'open' | 'closed';
  key: string;
  selectors: string[];
  html?: string;
}
interface SerializedContext {
  url: string;
  title: string;
  html: string;
  shadows: SerializedShadow[];
}

/** Ephemeral CDP routing data associated with one durable captured coordinate. */
export interface LiveBrowserContext {
  coordinate: BrowserContextCoordinate;
  frameId: string;
  executionContextId: number;
  shadowSelectors: string[];
  unsupported: boolean;
}

/** Normalized composed capture plus ephemeral routing state for immediate dispatch. */
export interface ComposedCaptureResult {
  page: CapturedPage;
  contexts: Map<string, LiveBrowserContext>;
}

/** Captures every frame document and open shadow root through CDP isolated worlds. */
export async function captureComposedPage(client: CdpClient): Promise<ComposedCaptureResult> {
  const response = await client.send<{ frameTree: CdpFrameTree }>('Page.getFrameTree');
  const frames = flattenFrames(response.frameTree);
  const contexts = new Map<string, LiveBrowserContext>();
  const elements: CapturedElement[] = [];
  const unsupportedContexts: UnsupportedBrowserContext[] = [];
  let top: SerializedContext | undefined;

  for (const entry of frames) {
    const world = await client.send<{ executionContextId: number }>('Page.createIsolatedWorld', {
      frameId: entry.frame.id,
      worldName: 'rote-composed-capture-v1',
      grantUniveralAccess: false,
    });
    const serialized = await evaluateInContext<SerializedContext>(client, world.executionContextId, SERIALIZE_COMPOSED_CONTEXT);
    if (entry.path.length === 0) top = serialized;
    const documentToken = sha256Hex(entry.frame.loaderId).slice(0, 16);
    const documentCoordinate = browserContextCoordinate(entry.path, documentToken);
    registerContext(contexts, {
      coordinate: documentCoordinate,
      frameId: entry.frame.id,
      executionContextId: world.executionContextId,
      shadowSelectors: [],
      unsupported: false,
    });
    elements.push(...withContext(captureStaticHtml(serialized.url, serialized.html).elements, documentCoordinate));

    for (const shadow of serialized.shadows) {
      const shadowPath = [
        ...entry.path,
        ...shadow.selectors.map((_, index) => shadowSegment(serialized.shadows, shadow.selectors.slice(0, index + 1))),
      ];
      const coordinate = browserContextCoordinate(shadowPath, documentToken);
      const liveContext: LiveBrowserContext = {
        coordinate,
        frameId: entry.frame.id,
        executionContextId: world.executionContextId,
        shadowSelectors: shadow.selectors,
        unsupported: shadow.mode === 'closed',
      };
      registerContext(contexts, liveContext);
      if (shadow.mode === 'closed') {
        unsupportedContexts.push({ coordinate, classification: 'closed_shadow_root_unsupported' });
      } else if (shadow.html !== undefined) {
        elements.push(...withContext(captureStaticHtml(serialized.url, shadow.html).elements, coordinate));
      }
    }
  }

  if (!top) throw new Error('CDP frame tree did not contain a top-level document');
  return {
    page: {
      url: top.url,
      title: top.title,
      html: top.html,
      elements,
      ...(unsupportedContexts.length ? { unsupportedContexts } : {}),
    },
    contexts,
  };
}

/** Resolves a fresh captured coordinate and rejects detach/navigation before dispatch. */
export async function resolveLiveBrowserContext(
  client: CdpClient,
  contexts: ReadonlyMap<string, LiveBrowserContext>,
  coordinate: BrowserContextCoordinate,
): Promise<LiveBrowserContext> {
  const live = contexts.get(coordinate.contextHash);
  if (!live) throw new BrowserContextMismatchError(coordinate.contextHash);
  if (live.coordinate.documentToken !== coordinate.documentToken) {
    throw new BrowsingContextStaleError(coordinate.contextHash);
  }
  const response = await client.send<{ frameTree: CdpFrameTree }>('Page.getFrameTree');
  const current = flattenFrames(response.frameTree).find((entry) => entry.frame.id === live.frameId)?.frame;
  if (!current || sha256Hex(current.loaderId).slice(0, 16) !== coordinate.documentToken) {
    throw new BrowsingContextStaleError(coordinate.contextHash);
  }
  return live;
}

/** Evaluates one expression in a specific CDP execution context. */
export async function evaluateInContext<T>(client: CdpClient, contextId: number, expression: string): Promise<T> {
  const result = await client.send<{
    result: { value?: unknown };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'CDP context evaluation failed');
  }
  return result.result.value as T;
}

function flattenFrames(root: CdpFrameTree): Array<{ frame: CdpFrame; path: BrowserContextSegment[] }> {
  const flattened: Array<{ frame: CdpFrame; path: BrowserContextSegment[] }> = [];
  const visit = (tree: CdpFrameTree, path: BrowserContextSegment[]) => {
    flattened.push({ frame: tree.frame, path });
    for (const child of tree.childFrames ?? []) {
      const key = child.frame.name?.trim() || canonicalFrameKey(child.frame.url);
      const origin = originOf(child.frame.url);
      visit(child, [...path, {
        kind: 'frame',
        keyHash: sha256Hex(key).slice(0, 16),
        originHash: sha256Hex(origin).slice(0, 16),
      }]);
    }
  };
  visit(root, []);
  return flattened;
}

function canonicalFrameKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('epoch');
    parsed.hash = '';
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function originOf(url: string): string {
  try { return new URL(url).origin; } catch { return 'opaque'; }
}

function shadowSegment(shadows: readonly SerializedShadow[], selectors: readonly string[]): BrowserContextSegment {
  const shadow = shadows.find((candidate) => candidate.selectors.length === selectors.length
    && candidate.selectors.every((selector, index) => selector === selectors[index]));
  if (!shadow) throw new Error('serialized shadow path is missing its ancestor');
  return { kind: 'shadow', keyHash: sha256Hex(shadow.key).slice(0, 16), mode: shadow.mode };
}

function withContext(elements: readonly CapturedElement[], context: BrowserContextCoordinate): CapturedElement[] {
  return elements.map((element) => ({ ...element, context }));
}

function registerContext(contexts: Map<string, LiveBrowserContext>, context: LiveBrowserContext): void {
  if (contexts.has(context.coordinate.contextHash)) {
    throw new Error(`duplicate composed browser context ${context.coordinate.contextHash}`);
  }
  contexts.set(context.coordinate.contextHash, context);
}

const SERIALIZE_COMPOSED_CONTEXT = `(() => {
  const uniqueSelector = (element, root) => {
    if (element.id) {
      const selector = '#' + CSS.escape(element.id);
      if (root.querySelectorAll(selector).length === 1) return selector;
    }
    const parts = [];
    let current = element;
    while (current && current !== root) {
      let part = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) {
        if (current.parentNode === root) parts.unshift(part);
        break;
      }
      const sameTag = Array.from(parent.children).filter((sibling) => sibling.tagName === current.tagName);
      if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(current) + 1) + ')';
      parts.unshift(part);
      if (parent.id) { parts.unshift('#' + CSS.escape(parent.id)); break; }
      current = parent;
    }
    const selector = parts.join(' > ');
    return selector && root.querySelectorAll(selector).length === 1 ? selector : undefined;
  };
  const decorate = (root, cloneRoot) => {
    const liveElements = root instanceof Document
      ? root.documentElement.querySelectorAll('*')
      : root.querySelectorAll('*');
    const copiedElements = cloneRoot.querySelectorAll('*');
    liveElements.forEach((live, index) => {
      const copied = copiedElements[index];
      if (!copied) return;
      const style = getComputedStyle(live);
      const visible = !live.hidden && style.display !== 'none' && style.visibility !== 'hidden'
        && style.opacity !== '0' && live.getClientRects().length > 0;
      copied.setAttribute('data-rote-visible', visible ? 'true' : 'false');
      if (visible && live.matches('a, button, input, textarea, select, [role]')) {
        const selector = uniqueSelector(live, root);
        if (selector) copied.setAttribute('data-rote-selector', selector);
      }
      if (live.matches('input, textarea, select')) {
        copied.setAttribute('value', live.value);
        if (live instanceof HTMLInputElement && (live.type === 'checkbox' || live.type === 'radio')) {
          if (live.checked) copied.setAttribute('checked', 'checked'); else copied.removeAttribute('checked');
        }
        if (copied.tagName === 'TEXTAREA') copied.textContent = live.value;
        if (copied.tagName === 'SELECT') Array.from(copied.options).forEach((option) => {
          if (option.value === live.value) option.setAttribute('selected', 'selected'); else option.removeAttribute('selected');
        });
      }
    });
  };
  const shadows = [];
  const walk = (root, parentSelectors) => {
    for (const host of root.querySelectorAll('*')) {
      const declared = host.getAttribute('data-shadow-mode');
      const open = host.shadowRoot;
      if (!open && declared !== 'closed') continue;
      const selector = uniqueSelector(host, root);
      if (!selector) continue;
      const selectors = [...parentSelectors, selector];
      const key = host.getAttribute('data-context-key') || host.getAttribute('aria-label') || host.id || selector;
      if (!open) {
        shadows.push({ mode: 'closed', key, selectors });
        continue;
      }
      const container = document.createElement('div');
      container.innerHTML = open.innerHTML;
      decorate(open, container);
      shadows.push({ mode: 'open', key, selectors, html: container.innerHTML });
      walk(open, selectors);
    }
  };
  const clone = document.documentElement.cloneNode(true);
  decorate(document, clone);
  walk(document, []);
  return { url: location.href, title: document.title, html: clone.outerHTML, shadows };
})()`;
