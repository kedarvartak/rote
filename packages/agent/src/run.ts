import { ActionContractUnavailableError, assertBrowserExpect, assertPostActionEvidence, BrowserCapabilityUnsupportedError, deriveActionContract, BrowserExpectationError, classifyBrowserActionSafety, derivePostActionEvidence, DragContextMismatchError, ElementResolutionConflictError, ElementResolutionError, ElementResolutionStaleIdentityError, normalizeKeyChord, PostActionEvidenceError, resolveElementTarget, UploadNotAllowlistedError, type AllowedUploadFile, type ElementResolutionResult, type PostActionEvidence } from '@rote/action';
import type { CapturedPage } from '@rote/browser';
import { pageKey, type ActionContract, type BrowserExpect } from '@rote/core';
import { distillPage, renderAdaptiveObservation, stableNodeRef, type DistilledNode } from '@rote/perception';
import { assemblePlannerContext, assertCacheStablePrefix } from './context.js';
import { BrowserPlannerOutputError } from './tagged-llm-planner.js';
import { BrowserActionGuardError, normalizeBrowserAction, type BrowserAction, type BrowserActionClassification, type BrowserAgentResult, type BrowserAgentStep, type BrowserAgentStepVerification, type BrowserAgentVerification, type SiteBriefInput, type SiteBriefUtility, type BrowserExpectFailure, type BrowserPageTransition, type BrowserPlannerResponse, type BrowserPlannerSource, type RunBrowserAgentOptions } from './types.js';

/** Runs the compact-observation browser-agent loop until the planner returns `done`. */
export async function runBrowserAgent(options: RunBrowserAgentOptions): Promise<BrowserAgentResult> {
  const maxSteps = options.maxSteps ?? 20;
  const maxRepairs = options.maxRepairs ?? 1;
  const maxTargetRepairs = options.maxTargetRepairs ?? 1;
  if (maxTargetRepairs !== 0 && maxTargetRepairs !== 1) throw new Error('maxTargetRepairs must be 0 or 1');
  const clock = options.clock ?? Date.now;
  const previousActions: BrowserAction[] = [];
  const steps: BrowserAgentStep[] = [];
  let previousNodes: DistilledNode[] | undefined;
  let previousPageUrl: string | undefined;
  let previousDocumentToken: string | undefined;
  // Stable identities this run has already dispatched to. On a remounting SPA
  // the same identity re-issued after its element is gone must not be healed
  // onto a look-alike successor (#132).
  const dispatchedStableIds = new Set<string>();
  let finished = false;
  let repairsUsed = 0;
  let pendingRepair: BrowserExpectFailure | undefined;
  let plannerStablePrefix: string | undefined;
  let observationHistoryEvicted = false;
  let pendingPage: CapturedPage | undefined;
  // Advertise only verbs this backend can dispatch, once, so the stable prefix
  // stays byte-identical across steps (cache-layout immutability). `upload` is
  // additionally gated on a non-empty allowlist — a verb with zero legal
  // arguments is an invitation to invent one.
  const supportedVerbs = ([
    ...(options.page.hover ? ['hover' as const] : []),
    ...(options.page.press ? ['press' as const] : []),
    ...(options.page.upload && options.uploadFiles?.length ? ['upload' as const] : []),
    ...(options.page.dragAndDrop ? ['dragAndDrop' as const] : []),
  ]);
  const enterpriseActions = supportedVerbs.length > 0
    ? {
      verbs: supportedVerbs,
      ...(options.uploadFiles?.length ? { uploadFileIds: options.uploadFiles.map((file) => file.file_id) } : {}),
    }
    : undefined;

  try {
    for (let step = 0; step < maxSteps; step += 1) {
      const startedAt = clock();
      const page = pendingPage ?? await options.page.capture();
      pendingPage = undefined;
      const currentPageKey = pageKey(page.url);
      const nodes = distillPage(page);
      // INVARIANT: a diff base belongs to one document. Reusing old-document
      // nodes after navigation leaves the planner acting on controls that no
      // longer exist. A same-document SPA route change (pushState) is not a
      // navigation: the document token is unchanged, so the base is retained and
      // the transition is rendered as a diff (#132). Backends without a token
      // fall back to URL identity.
      const pageTransition = classifyPageTransition(previousPageUrl, previousDocumentToken, page);
      const observation = renderAdaptiveObservation(nodes, {
        maxChars: options.observationMaxChars,
        maxBootstrapChars: options.observationBootstrapMaxChars,
        previousNodes: pageTransition?.documentChanged ? undefined : previousNodes,
      });
      // see docs/02-architecture.md "The policy" — once any prior observation is
      // omitted, later stateless planner calls must know that absence is not evidence.
      observationHistoryEvicted ||= Boolean(pageTransition?.documentChanged) || observation.mode === 'diff';
      previousNodes = nodes;
      previousPageUrl = page.url;
      previousDocumentToken = page.documentToken;
      const pageState = { url: page.url, title: page.title };
      // A step that follows a failed postcondition is a scoped repair, and is billed
      // as one: docs/02 makes cheap recovery an efficiency claim, so repair spend has
      // to be visible in the accounting rather than hidden inside planner totals.
      const source: BrowserPlannerSource = pendingRepair ? 'repair' : 'planner';
      const context = assemblePlannerContext({
        task: options.task,
        page: pageState,
        observation: observation.text,
        observationMode: observation.mode,
        previousActions,
        ...(options.historyCompactionPolicy !== undefined
          ? { historyCompactionPolicy: options.historyCompactionPolicy }
          : {}),
        stateSummary: renderStatefulControls(nodes),
        ...(observationHistoryEvicted ? { observationHistoryEvicted: true } : {}),
        ...(pendingRepair ? { repair: pendingRepair } : {}),
        ...(enterpriseActions ? { enterpriseActions } : {}),
        ...(options.siteBrief?.text ? { siteBrief: options.siteBrief.text } : {}),
      });
      if (context.history.compaction) observationHistoryEvicted = true;
      plannerStablePrefix = assertCacheStablePrefix(plannerStablePrefix, context.stablePrefix);
      // INVARIANT: planner calls are always source-tagged for benchmark accounting.
      let planned = await options.planner.plan(source, {
        task: options.task,
        step,
        page: pageState,
        observation,
        previousActions: context.history.visibleActions,
        context,
        ...(pendingRepair ? { repair: pendingRepair } : {}),
      });
      pendingRepair = undefined;
      assertPlannerUsageSources(planned, source);
      const initialUsage = planned.usage;
      const repairUsage = [...(planned.repairUsage ?? [])];
      const initialProviderReceipt = planned.providerReceipt;
      const repairProviderReceipts = [...(planned.repairProviderReceipts ?? [])];
      let normalized = normalizeBrowserAction(planned.action);
      let action = normalized.action;
      let classifications = uniqueClassifications([
        ...(planned.classifications ?? []),
        ...normalized.classifications,
      ]);

      let actionError: Error | undefined;
      let resolution: ElementResolutionResult | undefined;
      let dispatch: PreparedDispatch | undefined;
      let nextPageKey: string | undefined;
      let postActionEvidence: PostActionEvidence | undefined;
      if (action.kind !== 'done') {
        try {
          try {
            dispatch = prepareDispatch(action, nodes, options.uploadFiles, dispatchedStableIds);
            resolution = dispatch.resolution;
            options.beforeAction?.({ action, nodes, resolvedSelector: resolution?.selector });
          } catch (error) {
            // Upload-allowlist and drag-context violations are planner targeting
            // mistakes caught before any side effect, so they buy the same single
            // grounded correction as an unresolvable element (#131).
            const repairable = error instanceof ElementResolutionError || error instanceof BrowserActionGuardError
              || error instanceof UploadNotAllowlistedError || error instanceof DragContextMismatchError;
            if (!repairable || maxTargetRepairs < 1) throw error;
            // The action has not executed, so one bounded repair may copy a grounded
            // target from the same observation. This is distinct from postcondition
            // repair, where repeating an already-performed action would be unsafe.
            planned = await options.planner.plan('repair', {
              task: options.task,
              step,
              page: pageState,
              observation,
              previousActions: context.history.visibleActions,
              context: {
                ...context,
                volatileSuffix: `${context.volatileSuffix}\n\nYour proposed action was NOT performed because its pre-action checks failed: ${error.message}\nGrounded candidates for the requested role:\n${renderGroundedCandidates(nodes, error instanceof BrowserActionGuardError ? error.candidateRole : ('role' in action ? action.role : undefined), error instanceof BrowserActionGuardError ? error.candidateName : ('name' in action ? action.name : undefined))}\nChoose one corrected action by copying selector, stableId, role, and name from one complete candidate object. Never combine fields from different candidates.${error instanceof BrowserActionGuardError ? '\nYou MUST perform the missing candidate action now; do not repeat the rejected action.' : ''}`,
              },
            });
            assertPlannerUsageSources(planned, 'repair');
            repairUsage.push(planned.usage, ...(planned.repairUsage ?? []));
            if (planned.providerReceipt) repairProviderReceipts.push(planned.providerReceipt);
            repairProviderReceipts.push(...(planned.repairProviderReceipts ?? []));
            normalized = normalizeBrowserAction(planned.action);
            action = normalized.action;
            classifications = uniqueClassifications([
              ...classifications,
              ...(error instanceof ElementResolutionConflictError ? ['repaired_conflicting_target_identity' as const] : []),
              ...(planned.classifications ?? []),
              ...normalized.classifications,
            ]);
            dispatch = prepareDispatch(action, nodes, options.uploadFiles, dispatchedStableIds);
            resolution = dispatch.resolution;
            options.beforeAction?.({ action, nodes, resolvedSelector: resolution?.selector });
          }
          if (action.kind !== 'done') {
            await applyAction(options.page, action, dispatch);
            if ('stableId' in action && action.stableId) dispatchedStableIds.add(action.stableId);
            const postActionPage = await options.page.capture();
            // Reuse the settled post-action capture as the next planner observation;
            // derived evidence adds no browser capture or LLM call to the loop.
            pendingPage = postActionPage;
            nextPageKey = pageKey(postActionPage.url);
            postActionEvidence = derivePostActionEvidence({
              action,
              ...(action.kind === 'navigate' ? {} : {
                resolvedSelector: action.kind === 'dragAndDrop'
                  ? dispatch?.targetResolution?.selector ?? action.targetSelector
                  : resolution?.selector ?? action.selector,
              }),
              before: page,
              after: postActionPage,
            });
            // INVARIANT: a dispatch that returned without its strong observable
            // effect is a failed step, never evidence of successful execution.
            assertPostActionEvidence(postActionEvidence, postActionPage.url);
            // An omitted model-authored expect is no longer an unchecked strong
            // effect. Click reaction remains shadow-only until #54 qualification.
            if (action.expect) {
              const liveExpect = resolvedExpect(action.expect, action.kind === 'navigate' ? undefined : action.selector, resolution?.selector);
              assertBrowserExpect(liveExpect, postActionPage);
            }
            previousActions.push(action);
          }
        } catch (error) {
          actionError = asError(error);
        }
      }
      // Verification runs before the terminal step is recorded so the run carries
      // what decided success (and which declarative checks held — the distiller
      // learns `verify` from them). A verifier that throws still leaves the step
      // recorded; the error propagates below exactly as before.
      let verification: BrowserAgentVerification | undefined;
      let verificationError: Error | undefined;
      if (action.kind === 'done' && action.success && !actionError) {
        try {
          verification = await options.verifier.verify(page, options.task, action.summary);
        } catch (error) {
          verificationError = asError(error);
        }
      }
      const recordedStep: BrowserAgentStep = {
        step,
        action,
        observation,
        usage: initialUsage,
        ...(initialProviderReceipt ? { providerReceipt: initialProviderReceipt } : {}),
        ...(repairUsage.length > 0 ? { repairUsage } : {}),
        ...(repairProviderReceipts.length > 0 ? { repairProviderReceipts } : {}),
        ...(classifications.length > 0 ? { classifications } : {}),
        ...(postActionEvidence ? { postActionEvidence } : {}),
        ...(context.history.compaction ? { historyCompaction: context.history.compaction } : {}),
        durationMs: Math.max(0, clock() - startedAt),
        ...(actionError ? { error: actionError.message } : {}),
        ...(resolution ? { resolution } : {}),
        ...(dispatch?.targetResolution ? { targetResolution: dispatch.targetResolution } : {}),
        ...(action.kind !== 'done' ? { actionSafety: classifyBrowserActionSafety(action.kind) } : {}),
        ...(dispatch?.actionContract ? { actionContract: dispatch.actionContract } : {}),
        ...(pageTransition ? { pageTransition } : {}),
        ...(verification ? { verification: recordedVerification(verification) } : {}),
        // Value-free page identity before/after the action: site memory's page graph
        // and selector maps key on these, never on raw URLs.
        ...(currentPageKey ? { pageKey: currentPageKey } : {}),
        ...(nextPageKey ? { nextPageKey } : {}),
      };
      steps.push(recordedStep);
      await options.recorder?.recordStep(recordedStep);
      if (verificationError) throw verificationError;
      if (actionError) {
        // see docs/02-architecture.md "Repair ladder" — on assertion failure, never
        // fail the task blindly and never silently continue. The step above is
        // recorded with its error either way; what a remaining budget buys is one
        // chance to reconcile against the real page.
        //
        // INVARIANT: only a failed *postcondition* is repairable. An action that
        // threw (element detached, navigation error) is a broken world, not a wrong
        // belief about it, and stays fatal.
        const repairable = (actionError instanceof BrowserExpectationError || actionError instanceof PostActionEvidenceError) && repairsUsed < maxRepairs;
        if (repairable) {
          repairsUsed += 1;
          pendingRepair = { action, reason: actionError.message };
          // The action did execute, so it belongs in history even though its
          // postcondition did not hold.
          previousActions.push(action);
          continue;
        }
        throw actionError;
      }

      if (action.kind === 'done') {
        let success = action.success;
        let summary = action.summary;
        let failureClassification: BrowserAgentResult['failureClassification'] = action.success
          ? undefined
          : action.failureClassification;
        if (success) {
          if (!verification) throw new Error('verification did not run for a successful done');
          success = verification.success;
          summary = verification.summary;
          if (!success) failureClassification = 'verification_failed';
        }
        // INVARIANT: planner-declared completion is never success until an independent verifier passes.
        const result = resultFromSteps(success, summary, steps, failureClassification, options.siteBrief);
        finished = true;
        await options.recorder?.finish(success ? 'success' : 'failure', summary, result.tokenUsage);
        return result;
      }
    }

    const summary = `planner exceeded maxSteps=${maxSteps}`;
    const result = resultFromSteps(false, summary, steps, 'step_budget_exhausted', options.siteBrief);
    finished = true;
    await options.recorder?.finish('failure', summary, result.tokenUsage);
    return result;
  } catch (error) {
    const failure = asError(error);
    if (!finished) {
      finished = true;
      const outputFailureUsage = failure instanceof BrowserPlannerOutputError ? failure.usages : [];
      await options.recorder?.finish('failure', failure.message, [...tokenUsageFromSteps(steps), ...outputFailureUsage]);
    }
    throw failure;
  }
}

function recordedVerification(verification: BrowserAgentVerification): BrowserAgentStepVerification {
  const evidence = (verification as { consumedEvidence?: readonly { evidence_class: string }[] }).consumedEvidence;
  return {
    success: verification.success,
    summary: verification.summary,
    ...(verification.checks && verification.checks.length > 0 ? { checks: [...verification.checks] } : {}),
    ...(evidence && evidence.length > 0 ? { evidenceClasses: [...new Set(evidence.map((entry) => entry.evidence_class))] } : {}),
  };
}

function resultFromSteps(
  success: boolean,
  summary: string,
  steps: BrowserAgentStep[],
  failureClassification?: BrowserAgentResult['failureClassification'],
  siteBrief?: SiteBriefInput,
): BrowserAgentResult {
  return {
    success,
    summary,
    ...(failureClassification ? { failureClassification } : {}),
    steps,
    tokenUsage: tokenUsageFromSteps(steps),
    ...(siteBrief ? { siteBriefUtility: siteBriefUtility(siteBrief, steps) } : {}),
  };
}

/** docs/03 "hint utility": hinted identities the planner actually dispatched. */
function siteBriefUtility(brief: SiteBriefInput, steps: readonly BrowserAgentStep[]): SiteBriefUtility {
  const dispatched = new Set<string>();
  for (const step of steps) {
    if (step.error || step.action.kind === 'done' || step.action.kind === 'navigate') continue;
    const id = step.resolution?.stableId ?? ('stableId' in step.action ? step.action.stableId : undefined);
    if (typeof id === 'string') dispatched.add(id);
  }
  const hinted = new Set(brief.hintedStableIds);
  let used = 0;
  for (const id of hinted) if (dispatched.has(id)) used += 1;
  return { chars: brief.text.length, hinted: hinted.size, used };
}

function tokenUsageFromSteps(steps: readonly BrowserAgentStep[]) {
  return steps.flatMap((entry) => [entry.usage, ...(entry.repairUsage ?? [])]);
}

function uniqueClassifications(
  classifications: readonly BrowserActionClassification[],
): BrowserActionClassification[] {
  return [...new Set(classifications)];
}

function assertPlannerUsageSources(planned: BrowserPlannerResponse, source: BrowserPlannerSource): void {
  // INVARIANT: usage returned by a planner cannot be relabeled as another source.
  if (planned.usage.source !== source) {
    throw new Error(`planner returned usage tagged ${planned.usage.source} for a ${source} call`);
  }
  const wronglyTaggedRepair = planned.repairUsage?.find((usage) => usage.source !== 'repair');
  if (wronglyTaggedRepair) {
    throw new Error(`planner returned output-repair usage tagged ${wronglyTaggedRepair.source}`);
  }
}

function resolvedExpect(expect: BrowserExpect, originalSelector?: string, resolvedSelector?: string): BrowserExpect {
  if (!originalSelector || !resolvedSelector || originalSelector === resolvedSelector) return expect;
  if ('selector_visible' in expect && expect.selector_visible === originalSelector) {
    return { selector_visible: resolvedSelector };
  }
  if ('selector_absent' in expect && expect.selector_absent === originalSelector) {
    return { selector_absent: resolvedSelector };
  }
  if ('input_value' in expect && expect.input_value === originalSelector) {
    return { input_value: resolvedSelector, equals: expect.equals };
  }
  return expect;
}

interface PreparedDispatch {
  resolution?: ElementResolutionResult;
  /** Contract of the resolved live target (#143); recorded, never enforced against a planner. */
  actionContract?: ActionContract;
  /** Present only for `dragAndDrop`. */
  targetResolution?: ElementResolutionResult;
  /** Present only for a validated `upload`; content stays out of every record. */
  uploadFile?: AllowedUploadFile;
}

/**
 * Resolves every grounded target and validates verb-specific preconditions
 * before anything dispatches: the upload allowlist (#131 — ids only, no
 * filesystem reach-through) and the same-browsing-context rule for drag
 * (a shared DataTransfer cannot cross execution contexts).
 */
function prepareDispatch(
  action: BrowserAction,
  nodes: readonly DistilledNode[],
  uploadFiles: readonly AllowedUploadFile[] | undefined,
  dispatchedStableIds: ReadonlySet<string>,
): PreparedDispatch {
  if (action.kind === 'navigate' || action.kind === 'done') return {};
  const resolution = resolveAction(action, nodes);
  // INVARIANT: an already-dispatched stable identity that is gone from the live
  // capture may only rebind through an exact identity match (stable id, or
  // role+name for a remount that moved the same control). Fuzzy text/selector
  // rebinding would click "the next one" on behalf of a planner that asked for
  // "the one I already clicked" (#132 remount/virtualization).
  if (resolution && action.stableId && dispatchedStableIds.has(action.stableId)
    && (resolution.strategy === 'text-proximity' || resolution.strategy === 'selector')) {
    throw new ElementResolutionStaleIdentityError(action, resolution.selector, resolution.stableId);
  }
  const actionContract = resolution ? contractForResolution(action.kind, resolution, nodes) : undefined;
  const contractPart = actionContract ? { actionContract } : {};
  if (action.kind === 'upload') {
    const file = uploadFiles?.find((candidate) => candidate.file_id === action.fileId);
    // INVARIANT: an upload outside the injected allowlist never reaches a
    // backend; the error names ids only, never file names, paths, or content.
    if (!file) throw new UploadNotAllowlistedError(action.fileId, (uploadFiles ?? []).map((candidate) => candidate.file_id));
    return { ...(resolution ? { resolution } : {}), ...contractPart, uploadFile: file };
  }
  if (action.kind === 'dragAndDrop') {
    const targetResolution = resolveElementTarget(nodes, {
      selector: action.targetSelector,
      ...(action.targetStableId ? { stableId: action.targetStableId } : {}),
      ...(action.targetRole ? { role: action.targetRole } : {}),
      ...(action.targetName ? { name: action.targetName } : {}),
      ...(action.targetText ? { text: action.targetText } : {}),
      ...(action.contextHash ? { contextHash: action.contextHash } : {}),
    });
    if (resolution?.context?.contextHash !== targetResolution.context?.contextHash) {
      throw new DragContextMismatchError(resolution?.context?.contextHash, targetResolution.context?.contextHash);
    }
    return { ...(resolution ? { resolution } : {}), ...contractPart, targetResolution };
  }
  return resolution ? { resolution, ...contractPart } : {};
}

/** Derives the live contract for the resolved node; a legacy node without affordance yields none. */
function contractForResolution(
  kind: Exclude<BrowserAction['kind'], 'navigate' | 'done'>,
  resolution: ElementResolutionResult,
  nodes: readonly DistilledNode[],
): ActionContract | undefined {
  const node = nodes.find((candidate) => (resolution.stableId ? stableNodeRef(candidate.id) === resolution.stableId : candidate.selectorHint === resolution.selector));
  if (!node) return undefined;
  try {
    return deriveActionContract({ verb: kind, node });
  } catch (error) {
    if (error instanceof ActionContractUnavailableError) return undefined;
    throw error;
  }
}

function resolveAction(action: BrowserAction, nodes: readonly DistilledNode[]): ElementResolutionResult | undefined {
  if (action.kind === 'navigate' || action.kind === 'done') return undefined;
  const hasSemanticIdentity = Boolean(action.stableId || action.contextHash || action.role || action.name || action.text);
  if (!hasSemanticIdentity && !nodes.some((node) => node.selectorHint === action.selector)) {
    // The shared resolver retains selector-only compatibility for stored legacy
    // actions. A live planner has the current observation and may not dispatch an
    // invented selector that is absent from it.
    throw new ElementResolutionError(action);
  }
  return resolveElementTarget(nodes, action);
}

async function applyAction(
  page: RunBrowserAgentOptions['page'],
  action: BrowserAction,
  dispatch: PreparedDispatch | undefined,
): Promise<void> {
  const resolvedSelector = dispatch?.resolution?.selector;
  const context = dispatch?.resolution?.context;
  switch (action.kind) {
    case 'navigate':
      await page.navigate(action.url);
      return;
    case 'fill':
      await page.fill(resolvedSelector ?? action.selector, action.value, context);
      return;
    case 'select':
      await page.select(resolvedSelector ?? action.selector, action.value, context);
      return;
    case 'click':
      await page.click(resolvedSelector ?? action.selector, context);
      return;
    case 'hover':
      // INVARIANT: a backend without a verb fails typed before side effects;
      // there is no generic event-dispatch fallback (#131).
      if (!page.hover) throw new BrowserCapabilityUnsupportedError('hover');
      await page.hover(resolvedSelector ?? action.selector, context);
      return;
    case 'press':
      if (!page.press) throw new BrowserCapabilityUnsupportedError('press');
      await page.press(resolvedSelector ?? action.selector, normalizeKeyChord(action.chord), context);
      return;
    case 'upload': {
      if (!page.upload) throw new BrowserCapabilityUnsupportedError('upload');
      const file = dispatch?.uploadFile;
      if (!file) throw new UploadNotAllowlistedError(action.fileId, []);
      await page.upload(resolvedSelector ?? action.selector, {
        name: file.name,
        mimeType: file.mime_type,
        contentBase64: file.content_base64,
      }, context);
      return;
    }
    case 'dragAndDrop':
      if (!page.dragAndDrop) throw new BrowserCapabilityUnsupportedError('dragAndDrop');
      await page.dragAndDrop(
        resolvedSelector ?? action.selector,
        dispatch?.targetResolution?.selector ?? action.targetSelector,
        context,
      );
      return;
    case 'done':
      return;
  }
}

function renderStatefulControls(nodes: readonly DistilledNode[]): string {
  const selected = nodes.filter((node) => node.state?.checked && node.selectorHint);
  if (selected.length === 0) return '(none selected)';
  return selected.map((node) => JSON.stringify({
    selector: node.selectorHint,
    stableId: stableNodeRef(node.id),
    ...(node.context?.path.length ? { contextHash: node.context.contextHash } : {}),
    role: node.role,
    name: node.name,
    checked: true,
  })).join('\n');
}

function renderGroundedCandidates(nodes: readonly DistilledNode[], role?: string, name?: string): string {
  const normalizedRole = role?.toLowerCase();
  const normalizedName = name?.toLowerCase();
  const candidates = nodes.filter((node) => (
    node.selectorHint && (!normalizedRole || node.role.toLowerCase() === normalizedRole)
  )).sort((left, right) => {
    const leftExact = normalizedName && left.name.toLowerCase() === normalizedName ? 1 : 0;
    const rightExact = normalizedName && right.name.toLowerCase() === normalizedName ? 1 : 0;
    return rightExact - leftExact;
  }).slice(0, 25);
  if (candidates.length === 0) return '(none)';
  return candidates.map((node) => JSON.stringify({
    selector: node.selectorHint,
    stableId: stableNodeRef(node.id),
    ...(node.context?.path.length ? { contextHash: node.context.contextHash } : {}),
    role: node.role,
    name: node.name,
  })).join('\n');
}

function classifyPageTransition(
  previousUrl: string | undefined,
  previousDocumentToken: string | undefined,
  page: CapturedPage,
): BrowserPageTransition | undefined {
  if (previousUrl === undefined) return undefined;
  const routeChanged = previousUrl !== page.url;
  const documentChanged = previousDocumentToken !== undefined && page.documentToken !== undefined
    ? previousDocumentToken !== page.documentToken
    : routeChanged;
  if (!routeChanged && !documentChanged) return undefined;
  return { routeChanged, documentChanged };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
