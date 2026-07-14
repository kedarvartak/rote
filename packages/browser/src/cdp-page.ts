import { captureStaticHtml } from './static-backend.js';
import type { CapturedPage } from './types.js';
import { CdpClient, createCdpTarget } from './cdp-client.js';

export interface CdpPageOptions {
  /** Existing CDP HTTP endpoint, e.g. http://127.0.0.1:9222. */
  endpoint: string;
}

interface RuntimeEvaluateResult {
  result: { value?: unknown };
  exceptionDetails?: { text?: string };
}

export interface CdpActivitySample {
  pendingRequests: number;
  mutationVersion: number;
}

/** Stateful CDP page session for browser-agent navigation, capture, actions, and activity probes. */
export class CdpPage {
  private readonly pendingRequests = new Set<string>();
  private readonly unsubscribe: Array<() => void> = [];

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

  /** Captures the current page into Rote's normalized page shape. */
  async capture(): Promise<CapturedPage> {
    const html = await this.evaluateString(`(() => {
      const clone = document.documentElement.cloneNode(true);
      const liveElements = document.querySelectorAll('*');
      const clonedElements = clone.querySelectorAll('*');
      liveElements.forEach((live, index) => {
        const copied = clonedElements[index];
        if (!copied) return;
        const style = getComputedStyle(live);
        const visible = !live.hidden && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && live.getClientRects().length > 0;
        copied.setAttribute('data-rote-visible', visible ? 'true' : 'false');
      });
      const liveControls = document.querySelectorAll('input, textarea, select');
      const clonedControls = clone.querySelectorAll('input, textarea, select');
      liveControls.forEach((live, index) => {
        const copied = clonedControls[index];
        if (!copied) return;
        copied.setAttribute('value', live.value);
        if (copied.tagName === 'TEXTAREA') copied.textContent = live.value;
        if (copied.tagName === 'SELECT') {
          Array.from(copied.options).forEach((option) => {
            if (option.value === live.value) option.setAttribute('selected', 'selected');
            else option.removeAttribute('selected');
          });
        }
      });
      return clone.outerHTML;
    })()`);
    const url = await this.evaluateString('location.href');
    return captureStaticHtml(url, html);
  }

  /** Fills an input-like element and dispatches input/change events for page scripts. */
  async fill(selector: string, value: string): Promise<void> {
    await this.evaluateVoid(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || !("value" in element)) throw new Error("fillable element not found: ${escapeForTemplate(selector)}");
      element.focus();
      element.value = ${JSON.stringify(value)};
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(value)} }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
  }

  /** Selects an option value and dispatches input/change events. */
  async select(selector: string, value: string): Promise<void> {
    await this.evaluateVoid(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.tagName !== "SELECT") throw new Error("select element not found: ${escapeForTemplate(selector)}");
      element.value = ${JSON.stringify(value)};
      if (element.value !== ${JSON.stringify(value)}) throw new Error("option not found: ${escapeForTemplate(value)}");
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
  }

  /** Clicks an element by selector using the page's DOM event path. */
  async click(selector: string): Promise<void> {
    await this.evaluateVoid(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("clickable element not found: ${escapeForTemplate(selector)}");
      element.click();
    })()`);
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

  private async evaluateString(expression: string): Promise<string> {
    const value = await this.evaluate<unknown>(expression);
    if (typeof value !== 'string') throw new Error(`CDP expression did not return a string: ${expression}`);
    return value;
  }

  private async evaluateVoid(expression: string): Promise<void> {
    await this.evaluate<unknown>(expression);
  }
}

async function evaluate<T>(client: CdpClient, expression: string): Promise<T> {
  const result = await client.send<RuntimeEvaluateResult>('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'CDP evaluation failed');
  return result.result.value as T;
}

function escapeForTemplate(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
