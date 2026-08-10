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
  pendingRequests: number;
  mutationVersion: number;
}

/** Stateful CDP page session for browser-agent navigation, capture, actions, and activity probes. */
export class CdpPage {
  private readonly pendingRequests = new Set<string>();
  private readonly unsubscribe: Array<() => void> = [];
  private contexts = new Map<string, LiveBrowserContext>();

  private constructor(private readonly client: CdpClient) {
    this.unsubscribe.push(
      client.onEvent('Network.requestWillBeSent', (params) => {
        if (typeof params['requestId'] === 'string') this.pendingRequests.add(params['requestId']);
      }),
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

  /** Samples pending network requests and a monotonic DOM mutation version. */
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
    return { pendingRequests: this.pendingRequests.size, mutationVersion };
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
    if (typeof params['requestId'] === 'string') this.pendingRequests.delete(params['requestId']);
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
