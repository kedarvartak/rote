import { ClosedShadowRootUnsupportedError } from './browser-context.js';
import { captureComposedPage, evaluateInContext, resolveLiveBrowserContext, type LiveBrowserContext } from './cdp-composed-context.js';
import type { BrowserContextCoordinate, CapturedPage } from './types.js';
import { CdpClient, createCdpTarget } from './cdp-client.js';

export interface CdpPageOptions {
  /** Existing CDP HTTP endpoint, e.g. http://127.0.0.1:9222. */
  endpoint: string;
}

interface RuntimeEvaluateResult {
  result: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

export interface CdpActivitySample {
  /** Requests the server has not answered yet (no response headers). */
  pendingRequests: number;
  /** Requests answered but not finished: streaming, SSE, or unconsumed fetch bodies. */
  streamingResponses: number;
  mutationVersion: number;
  /** Monotonic counter bumped on every request/response/data/finish edge. */
  networkVersion: number;
}

/** Stateful CDP page session for browser-agent navigation, capture, actions, and activity probes. */
export class CdpPage {
  private readonly pendingRequests = new Set<string>();
  private readonly streamingResponses = new Set<string>();
  private networkVersion = 0;
  private readonly unsubscribe: Array<() => void> = [];
  private contexts = new Map<string, LiveBrowserContext>();

  private constructor(private readonly client: CdpClient) {
    // A request stops being "pending" once the server answers. Long-lived
    // sessions accumulate answered-but-unfinished requests (SSE, long-poll
    // bodies, fetches whose body nobody reads); counting those as in-flight
    // makes settledness unreachable after a few transitions (#132). Every
    // network edge still bumps `networkVersion`, so a streaming body that is
    // actively delivering chunks keeps the page unsettled.
    this.unsubscribe.push(
      client.onEvent('Network.requestWillBeSent', (params) => {
        this.networkVersion += 1;
        if (typeof params['requestId'] === 'string') this.pendingRequests.add(params['requestId']);
      }),
      client.onEvent('Network.responseReceived', (params) => {
        this.networkVersion += 1;
        if (typeof params['requestId'] !== 'string') return;
        if (this.pendingRequests.delete(params['requestId'])) this.streamingResponses.add(params['requestId']);
      }),
      client.onEvent('Network.dataReceived', () => { this.networkVersion += 1; }),
      client.onEvent('Network.loadingFinished', (params) => this.finishRequest(params)),
      client.onEvent('Network.loadingFailed', (params) => this.finishRequest(params)),
    );
  }

  /** Opens a new page target against an existing CDP endpoint. */
  static async open(options: CdpPageOptions): Promise<CdpPage> {
    const target = await createCdpTarget(options.endpoint);
    if (!target.webSocketDebuggerUrl) throw new Error('CDP endpoint did not create a page target');
    const client = await CdpClient.connect({ webSocketDebuggerUrl: target.webSocketDebuggerUrl });
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    return new CdpPage(client);
  }

  /** Navigates the page and waits for the load event. */
  async navigate(url: string): Promise<void> {
    const loaded = this.client.waitForEvent('Page.loadEventFired');
    await this.client.send('Page.navigate', { url });
    await loaded;
  }

  /** Captures top-level, frame, and open-shadow contexts into one normalized page. */
  async capture(): Promise<CapturedPage> {
    const captured = await captureComposedPage(this.client);
    this.contexts = captured.contexts;
    return captured.page;
  }

  /** Fills an input-like element in its captured composed context. */
  async fill(selector: string, value: string, context?: BrowserContextCoordinate): Promise<void> {
    const encoded = JSON.stringify(value);
    await this.evaluateTarget(selector, context, `
      if (!("value" in element)) throw new Error("fillable element not found");
      element.focus();
      element.value = ${encoded};
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${encoded} }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    `);
  }

  /** Selects an option value in its captured composed context. */
  async select(selector: string, value: string, context?: BrowserContextCoordinate): Promise<void> {
    const encoded = JSON.stringify(value);
    await this.evaluateTarget(selector, context, `
      if (element.tagName !== "SELECT") throw new Error("select element not found");
      element.value = ${encoded};
      if (element.value !== ${encoded}) throw new Error("option not found");
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    `);
  }

  /** Clicks an element in its captured composed context. */
  async click(selector: string, context?: BrowserContextCoordinate): Promise<void> {
    const href = await this.evaluateTarget<string | null>(selector, context, `
      return element instanceof HTMLAnchorElement && !element.download && element.target !== '_blank' ? element.href : null;
    `);
    try {
      await this.evaluateTarget(selector, context, 'element.click();');
    } catch (error) {
      // Top-level same-tab navigation can destroy the execution context before CDP
      // returns. Nested contexts must never promote their navigation into the top page.
      if (!href || context?.path.length) throw error;
      await this.navigate(href);
    }
  }

  /**
   * Hovers a grounded target by dispatching the pointer/mouse enter sequence on
   * it inside its composed context. Synthetic events (not CSS `:hover`) are the
   * portable path through nested frames/shadow roots; fixtures and real apps
   * that open menus from `pointerenter`/`mouseover` listeners see exactly this.
   */
  async hover(selector: string, context?: BrowserContextCoordinate): Promise<void> {
    await this.evaluateTarget(selector, context, `
      const bubbling = new Set(["pointerover", "mouseover", "mousemove"]);
      for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"]) {
        const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
        element.dispatchEvent(new Ctor(type, { bubbles: bubbling.has(type), cancelable: true }));
      }
    `);
  }

  /**
   * Presses one explicit normalized chord on a focused grounded target. The
   * chord arrives pre-normalized (see `normalizeKeyChord` in the action package);
   * this method never evaluates planner-authored strings as code.
   */
  async press(
    selector: string,
    chord: { key: string; modifiers: readonly string[] },
    context?: BrowserContextCoordinate,
  ): Promise<void> {
    const init = JSON.stringify({
      key: chord.key,
      bubbles: true,
      cancelable: true,
      ctrlKey: chord.modifiers.includes('Control'),
      altKey: chord.modifiers.includes('Alt'),
      shiftKey: chord.modifiers.includes('Shift'),
      metaKey: chord.modifiers.includes('Meta'),
    });
    await this.evaluateTarget(selector, context, `
      if (element.focus) element.focus();
      element.dispatchEvent(new KeyboardEvent("keydown", ${init}));
      element.dispatchEvent(new KeyboardEvent("keyup", { ...${init}, cancelable: false }));
    `);
  }

  /**
   * Assigns one allowlisted file to a grounded file input and verifies the
   * assignment in the same evaluation — a file input that ends up without
   * exactly the named file is a failed dispatch, not evidence. File content
   * transits only this call; it is never captured or recorded.
   */
  async upload(
    selector: string,
    file: { name: string; mimeType: string; contentBase64: string },
    context?: BrowserContextCoordinate,
  ): Promise<void> {
    await this.evaluateTarget(selector, context, `
      if (element.tagName !== "INPUT" || element.type !== "file") throw new Error("upload target is not a file input");
      const bytes = Uint8Array.from(atob(${JSON.stringify(file.contentBase64)}), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], ${JSON.stringify(file.name)}, { type: ${JSON.stringify(file.mimeType)} }));
      element.files = transfer.files;
      // INVARIANT: dispatch-time strong effect — captures cannot serialize
      // element.files, so assignment is proven here or the action fails.
      if (element.files.length !== 1 || element.files[0].name !== ${JSON.stringify(file.name)}) {
        throw new Error("file input assignment failed");
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    `);
  }

  /**
   * Drags a grounded source onto a grounded target in the same composed
   * context using the standards HTML drag-event sequence with one shared
   * `DataTransfer`. There is no pointer-simulation fallback yet; a
   * non-draggable source is a typed dispatch failure, never a silent click.
   */
  async dragAndDrop(sourceSelector: string, targetSelector: string, context?: BrowserContextCoordinate): Promise<void> {
    await this.evaluateTargets(sourceSelector, targetSelector, context, `
      if (source.draggable !== true) throw new Error("drag source is not draggable");
      const transfer = new DataTransfer();
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      source.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
    `);
  }

  /** Samples unanswered requests, streaming responses, and monotonic DOM/network activity versions. */
  async sampleActivity(): Promise<CdpActivitySample> {
    const mutationVersion = await this.evaluate<number>(`(() => {
      if (!globalThis.__roteMutationState) {
        const state = { version: 0 };
        new MutationObserver(() => { state.version += 1; }).observe(document, {
          subtree: true, childList: true, attributes: true, characterData: true
        });
        globalThis.__roteMutationState = state;
      }
      return globalThis.__roteMutationState.version;
    })()`);
    return {
      pendingRequests: this.pendingRequests.size,
      streamingResponses: this.streamingResponses.size,
      mutationVersion,
      networkVersion: this.networkVersion,
    };
  }

  /** Evaluates an expression and returns a JSON-serializable result for tests and probes. */
  async evaluate<T>(expression: string): Promise<T> {
    return await evaluate<T>(this.client, expression);
  }

  /** Closes the page's CDP socket; safe to call after the owning browser closes. */
  close(): void {
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.client.close();
  }

  private finishRequest(params: Record<string, unknown>): void {
    this.networkVersion += 1;
    if (typeof params['requestId'] !== 'string') return;
    this.pendingRequests.delete(params['requestId']);
    this.streamingResponses.delete(params['requestId']);
  }

  private async evaluateTarget<T = void>(
    selector: string,
    context: BrowserContextCoordinate | undefined,
    body: string,
  ): Promise<T> {
    if (!context) {
      return this.evaluate<T>(targetExpression(selector, [], body));
    }
    const live = await resolveLiveBrowserContext(this.client, this.contexts, context);
    if (live.unsupported) throw new ClosedShadowRootUnsupportedError(context.contextHash);
    return evaluateInContext<T>(
      this.client,
      live.executionContextId,
      targetExpression(selector, live.shadowSelectors, body),
    );
  }

  // Both elements must resolve in one evaluation: a shared DataTransfer cannot
  // cross execution contexts, which is why cross-context drag is rejected a
  // layer above instead of half-dispatched here.
  private async evaluateTargets<T = void>(
    sourceSelector: string,
    targetSelector: string,
    context: BrowserContextCoordinate | undefined,
    body: string,
  ): Promise<T> {
    if (!context) {
      return this.evaluate<T>(pairExpression(sourceSelector, targetSelector, [], body));
    }
    const live = await resolveLiveBrowserContext(this.client, this.contexts, context);
    if (live.unsupported) throw new ClosedShadowRootUnsupportedError(context.contextHash);
    return evaluateInContext<T>(
      this.client,
      live.executionContextId,
      pairExpression(sourceSelector, targetSelector, live.shadowSelectors, body),
    );
  }
}

async function evaluate<T>(client: CdpClient, expression: string): Promise<T> {
  const result = await client.send<RuntimeEvaluateResult>('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'CDP evaluation failed');
  }
  return result.result.value as T;
}

function pairExpression(sourceSelector: string, targetSelector: string, shadowSelectors: readonly string[], body: string): string {
  return `(() => {
    let root = document;
    for (const hostSelector of ${JSON.stringify(shadowSelectors)}) {
      const host = root.querySelector(hostSelector);
      if (!host || !host.shadowRoot) throw new Error('open shadow context is unavailable');
      root = host.shadowRoot;
    }
    const source = root.querySelector(${JSON.stringify(sourceSelector)});
    if (!source) throw new Error('drag source not found in composed browser context');
    const target = root.querySelector(${JSON.stringify(targetSelector)});
    if (!target) throw new Error('drop target not found in composed browser context');
    ${body}
  })()`;
}

function targetExpression(selector: string, shadowSelectors: readonly string[], body: string): string {
  return `(() => {
    let root = document;
    for (const hostSelector of ${JSON.stringify(shadowSelectors)}) {
      const host = root.querySelector(hostSelector);
      if (!host || !host.shadowRoot) throw new Error('open shadow context is unavailable');
      root = host.shadowRoot;
    }
    const element = root.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('target not found in composed browser context');
    ${body}
  })()`;
}
