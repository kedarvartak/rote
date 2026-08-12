import { BrowserCapabilityUnsupportedError, ElementResolutionAmbiguityError, ElementResolutionContextMismatchError, KeyChordError, normalizeKeyChord, resolveElementTarget, UploadNotAllowlistedError, type AllowedUploadFile, type ElementResolutionTarget, type NormalizedKeyChord } from '@rote/action';
import { BrowsingContextStaleError, ClosedShadowRootUnsupportedError, type BrowserContextCoordinate, type CapturedElement, type CapturedPage } from '@rote/browser';
import { distillPage } from '@rote/perception';
import type { ToolCallOutcome, ToolCaller } from './tool-caller.js';

export interface BrowserReplayPage {
  navigate(url: string): Promise<void>;
  capture(): Promise<CapturedPage>;
  fill(selector: string, value: string, context?: BrowserContextCoordinate): Promise<void>;
  select(selector: string, value: string, context?: BrowserContextCoordinate): Promise<void>;
  click(selector: string, context?: BrowserContextCoordinate): Promise<void>;
  /** E7.5 verbs; a backend without one yields `BROWSER_CAPABILITY_UNSUPPORTED`, keeping fallback clean. */
  hover?(selector: string, context?: BrowserContextCoordinate): Promise<void>;
  press?(selector: string, chord: NormalizedKeyChord, context?: BrowserContextCoordinate): Promise<void>;
  upload?(selector: string, file: { name: string; mimeType: string; contentBase64: string }, context?: BrowserContextCoordinate): Promise<void>;
  dragAndDrop?(sourceSelector: string, targetSelector: string, context?: BrowserContextCoordinate): Promise<void>;
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
  constructor(
    private readonly page: BrowserReplayPage,
    /** Injected upload allowlist; replayed upload steps reference `fileId` only (#131). */
    private readonly options: { uploadFiles?: readonly AllowedUploadFile[] } = {},
  ) {}

  async call(tool: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
    try {
      let extra: Record<string, unknown> = {};
      switch (tool) {
        case 'browser.navigate':
          await this.page.navigate(requiredString(tool, args, 'url'));
          break;
        case 'browser.fill': {
          const target = await this.resolveTarget(tool, args);
          await this.page.fill(target.selector, requiredString(tool, args, 'value'), target.context);
          extra = target.extra;
          break;
        }
        case 'browser.select': {
          const target = await this.resolveTarget(tool, args);
          await this.page.select(target.selector, requiredString(tool, args, 'value'), target.context);
          extra = target.extra;
          break;
        }
        case 'browser.click':
        case 'browser.download_file': {
          const target = await this.resolveTarget(tool, args);
          await this.page.click(target.selector, target.context);
          extra = target.extra;
          break;
        }
        case 'browser.hover': {
          if (!this.page.hover) throw new BrowserCapabilityUnsupportedError('hover');
          const target = await this.resolveTarget(tool, args);
          await this.page.hover(target.selector, target.context);
          extra = target.extra;
          break;
        }
        case 'browser.press': {
          if (!this.page.press) throw new BrowserCapabilityUnsupportedError('press');
          // Chords normalize (or fail typed) before the backend sees them —
          // replay has no arbitrary-event escape hatch either (#131).
          const chord = normalizeKeyChord(requiredString(tool, args, 'chord'));
          const target = await this.resolveTarget(tool, args);
          await this.page.press(target.selector, chord, target.context);
          extra = target.extra;
          break;
        }
        case 'browser.upload': {
          if (!this.page.upload) throw new BrowserCapabilityUnsupportedError('upload');
          const fileId = requiredString(tool, args, 'fileId');
          const file = this.options.uploadFiles?.find((candidate) => candidate.file_id === fileId);
          if (!file) throw new UploadNotAllowlistedError(fileId, (this.options.uploadFiles ?? []).map((candidate) => candidate.file_id));
          const target = await this.resolveTarget(tool, args);
          await this.page.upload(target.selector, {
            name: file.name,
            mimeType: file.mime_type,
            contentBase64: file.content_base64,
          }, target.context);
          extra = target.extra;
          break;
        }
        case 'browser.drag_and_drop': {
          if (!this.page.dragAndDrop) throw new BrowserCapabilityUnsupportedError('dragAndDrop');
          const target = await this.resolveTarget(tool, args);
          await this.page.dragAndDrop(target.selector, requiredString(tool, args, 'targetSelector'), target.context);
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
          code: browserFailureCode(failure),
        },
      };
    }
  }

  private async resolveTarget(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ selector: string; context?: BrowserContextCoordinate; extra: Record<string, unknown> }> {
    const requestedSelector = requiredString(tool, args, 'selector');
    const target: ElementResolutionTarget = {
      selector: requestedSelector,
      ...(optionalString(tool, args, 'stableId') ? { stableId: optionalString(tool, args, 'stableId') } : {}),
      ...(optionalString(tool, args, 'role') ? { role: optionalString(tool, args, 'role') } : {}),
      ...(optionalString(tool, args, 'name') ? { name: optionalString(tool, args, 'name') } : {}),
      ...(optionalString(tool, args, 'text') ? { text: optionalString(tool, args, 'text') } : {}),
      ...(optionalString(tool, args, 'contextHash') ? { contextHash: optionalString(tool, args, 'contextHash') } : {}),
    };
    const hasSemanticIdentity = Boolean(target.stableId || target.contextHash || target.role || target.name || target.text);
    if (!hasSemanticIdentity) return { selector: requestedSelector, extra: {} };
    const capture = await this.page.capture();
    const unsupported = target.contextHash
      ? capture.unsupportedContexts?.find((candidate) => candidate.coordinate.contextHash === target.contextHash)
      : undefined;
    if (unsupported?.classification === 'closed_shadow_root_unsupported') {
      throw new ClosedShadowRootUnsupportedError(unsupported.coordinate.contextHash);
    }
    const resolution = resolveElementTarget(distillPage(capture), target);
    return {
      selector: resolution.selector,
      ...(resolution.context ? { context: resolution.context } : {}),
      extra: {
        target_resolution: {
          requested_selector: requestedSelector,
          resolved_selector: resolution.selector,
          strategy: resolution.strategy,
          repaired: requestedSelector !== resolution.selector,
          ...(resolution.context ? { context: resolution.context } : {}),
        },
      },
    };
  }
}

function browserFailureCode(error: Error): string {
  if (error instanceof ElementResolutionAmbiguityError) return 'BROWSER_TARGET_AMBIGUOUS';
  if (error instanceof ElementResolutionContextMismatchError) return 'BROWSER_CONTEXT_MISMATCH';
  if (error instanceof BrowsingContextStaleError) return 'BROWSER_CONTEXT_STALE';
  if (error instanceof ClosedShadowRootUnsupportedError) return 'CLOSED_SHADOW_ROOT_UNSUPPORTED';
  if (error instanceof BrowserCapabilityUnsupportedError) return 'BROWSER_CAPABILITY_UNSUPPORTED';
  if (error instanceof UploadNotAllowlistedError) return 'UPLOAD_NOT_ALLOWLISTED';
  if (error instanceof KeyChordError) return 'KEY_CHORD_INVALID';
  return 'BROWSER_REPLAY_TOOL_ERROR';
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
