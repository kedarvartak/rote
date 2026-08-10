import { ElementResolutionAmbiguityError, resolveElementTarget, type ElementResolutionTarget } from '@rote/action';
import type { CapturedElement, CapturedPage } from '@rote/browser';
import { distillPage } from '@rote/perception';
import type { ToolCallOutcome, ToolCaller } from './tool-caller.js';

export interface BrowserReplayPage {
  navigate(url: string): Promise<void>;
  capture(): Promise<CapturedPage>;
  fill(selector: string, value: string): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
}

/** Typed failure for an unsupported or malformed browser replay tool call. */
export class BrowserReplayToolError extends Error {
  constructor(readonly tool: string, message: string) {
    super(`${tool}: ${message}`);
    this.name = 'BrowserReplayToolError';
  }
}

/** Adapts a stateful browser page to the replay executor's deterministic ToolCaller boundary. */
export class BrowserToolCaller implements ToolCaller {
  constructor(private readonly page: BrowserReplayPage) {}

  async call(tool: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
    try {
      let extra: Record<string, unknown> = {};
      switch (tool) {
        case 'browser.navigate':
          await this.page.navigate(requiredString(tool, args, 'url'));
          break;
        case 'browser.fill': {
          const target = await this.resolveTarget(tool, args);
          await this.page.fill(target.selector, requiredString(tool, args, 'value'));
          extra = target.extra;
          break;
        }
        case 'browser.select': {
          const target = await this.resolveTarget(tool, args);
          await this.page.select(target.selector, requiredString(tool, args, 'value'));
          extra = target.extra;
          break;
        }
        case 'browser.click':
        case 'browser.download_file': {
          const target = await this.resolveTarget(tool, args);
          await this.page.click(target.selector);
          extra = target.extra;
          break;
        }
        case 'browser.extract': {
          const page = await this.page.capture();
          const limit = optionalPositiveInteger(tool, args, 'limit') ?? 10;
          const items = distillPage(page)
            .filter((node) => node.tag === 'h2' && node.name)
            .slice(0, limit)
            .map((node) => ({ name: node.name }));
          return { ok: true, result: pageResult(page, { items }) };
        }
        default:
          throw new BrowserReplayToolError(tool, 'unsupported browser replay tool');
      }
      const page = await this.page.capture();
      if (tool === 'browser.download_file') extra = { artifact_requested: true };
      return { ok: true, result: pageResult(page, extra) };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      return {
        ok: false,
        error: {
          message: failure.message,
          code: failure instanceof ElementResolutionAmbiguityError
            ? 'BROWSER_TARGET_AMBIGUOUS'
            : 'BROWSER_REPLAY_TOOL_ERROR',
        },
      };
    }
  }

  private async resolveTarget(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ selector: string; extra: Record<string, unknown> }> {
    const requestedSelector = requiredString(tool, args, 'selector');
    const target: ElementResolutionTarget = {
      selector: requestedSelector,
      ...(optionalString(tool, args, 'stableId') ? { stableId: optionalString(tool, args, 'stableId') } : {}),
      ...(optionalString(tool, args, 'role') ? { role: optionalString(tool, args, 'role') } : {}),
      ...(optionalString(tool, args, 'name') ? { name: optionalString(tool, args, 'name') } : {}),
      ...(optionalString(tool, args, 'text') ? { text: optionalString(tool, args, 'text') } : {}),
    };
    const hasSemanticIdentity = Boolean(target.stableId || target.role || target.name || target.text);
    if (!hasSemanticIdentity) return { selector: requestedSelector, extra: {} };
    const resolution = resolveElementTarget(distillPage(await this.page.capture()), target);
    return {
      selector: resolution.selector,
      extra: {
        target_resolution: {
          requested_selector: requestedSelector,
          resolved_selector: resolution.selector,
          strategy: resolution.strategy,
          repaired: requestedSelector !== resolution.selector,
        },
      },
    };
  }
}

function pageResult(page: CapturedPage, extra: Record<string, unknown>): Record<string, unknown> {
  const visible = page.elements.filter(isVisible);
  const visibleSelectors = visible.flatMap(selectorFor);
  const inputValues = Object.fromEntries(
    visible.flatMap((element) => {
      const selector = selectorFor(element)[0];
      const value = element.attributes['value'];
      return selector && value !== undefined ? [[selector, value] as const] : [];
    }),
  );
  return {
    ...extra,
    url: page.url,
    visible_selectors: [...new Set(visibleSelectors)],
    input_values: inputValues,
    visible_text: [page.title, ...visible.map((element) => element.text)].filter(Boolean),
  };
}

function selectorFor(element: CapturedElement): string[] {
  const selectors: string[] = [];
  const id = element.attributes['id'];
  if (id) selectors.push(`#${id}`);
  const name = element.attributes['name'];
  if (name) selectors.push(`${element.tag}[name="${name}"]`);
  return selectors;
}

function isVisible(element: CapturedElement): boolean {
  if (element.attributes['data-rote-visible'] === 'false') return false;
  if ('hidden' in element.attributes || element.attributes['aria-hidden'] === 'true') return false;
  const style = element.attributes['style']?.replaceAll(' ', '').toLowerCase() ?? '';
  return !style.includes('display:none') && !style.includes('visibility:hidden') && !style.includes('opacity:0');
}

function requiredString(tool: string, args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) throw new BrowserReplayToolError(tool, `${key} must be a non-empty string`);
  return value;
}

function optionalString(tool: string, args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new BrowserReplayToolError(tool, `${key} must be a non-empty string when provided`);
  }
  return value;
}

function optionalPositiveInteger(
  tool: string,
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new BrowserReplayToolError(tool, `${key} must be a positive integer`);
  }
  return value;
}
