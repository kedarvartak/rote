import { assertBrowserExpect, BrowserExpectationError, ElementResolutionConflictError, ElementResolutionError, resolveElementTarget, type ElementResolutionResult } from '@rote/action';
import type { BrowserExpect } from '@rote/core';
import { distillPage, renderAdaptiveObservation, type DistilledNode } from '@rote/perception';
import { assemblePlannerContext, assertCacheStablePrefix } from './context.js';
import { BrowserPlannerOutputError } from './tagged-llm-planner.js';
import { BrowserActionGuardError, normalizeBrowserAction, type BrowserAction, type BrowserActionClassification, type BrowserAgentResult, type BrowserAgentStep, type BrowserExpectFailure, type BrowserPlannerResponse, type BrowserPlannerSource, type RunBrowserAgentOptions } from './types.js';

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
  let finished = false;
  let repairsUsed = 0;
  let pendingRepair: BrowserExpectFailure | undefined;
  let plannerStablePrefix: string | undefined;

  try {
    for (let step = 0; step < maxSteps; step += 1) {
      const startedAt = clock();
      const page = await options.page.capture();
      const nodes = distillPage(page);
      // INVARIANT: a diff base belongs to one page identity. Reusing old-page
      // nodes after navigation leaves the planner acting on controls that no longer exist.
      const observation = renderAdaptiveObservation(nodes, {
        maxChars: options.observationMaxChars,
        maxBootstrapChars: options.observationBootstrapMaxChars,
        previousNodes: previousPageUrl === page.url ? previousNodes : undefined,
      });
      previousNodes = nodes;
      previousPageUrl = page.url;
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
        stateSummary: renderStatefulControls(nodes),
        ...(pendingRepair ? { repair: pendingRepair } : {}),
      });
      plannerStablePrefix = assertCacheStablePrefix(plannerStablePrefix, context.stablePrefix);
      // INVARIANT: planner calls are always source-tagged for benchmark accounting.
      let planned = await options.planner.plan(source, {
        task: options.task,
        step,
        page: pageState,
        observation,
        previousActions,
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
      if (action.kind !== 'done') {
        try {
          try {
            resolution = resolveAction(action, nodes);
            options.beforeAction?.({ action, nodes, resolvedSelector: resolution?.selector });
          } catch (error) {
            const repairable = error instanceof ElementResolutionError || error instanceof BrowserActionGuardError;
            if (!repairable || maxTargetRepairs < 1) throw error;
            // The action has not executed, so one bounded repair may copy a grounded
            // target from the same observation. This is distinct from postcondition
            // repair, where repeating an already-performed action would be unsafe.
            planned = await options.planner.plan('repair', {
              task: options.task,
              step,
              page: pageState,
              observation,
              previousActions,
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
            resolution = resolveAction(action, nodes);
            options.beforeAction?.({ action, nodes, resolvedSelector: resolution?.selector });
          }
          if (action.kind !== 'done') {
            await applyAction(options.page, action, resolution?.selector);
            // An omitted expect is not an unchecked action: the independent final
            // verifier still gates success (#49). It only means the model declined to
            // predict, which beats an invented string.
            if (action.expect) {
              const liveExpect = resolvedExpect(action.expect, action.kind === 'navigate' ? undefined : action.selector, resolution?.selector);
              assertBrowserExpect(liveExpect, await options.page.capture());
            }
            previousActions.push(action);
          }
        } catch (error) {
          actionError = asError(error);
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
        durationMs: Math.max(0, clock() - startedAt),
        ...(actionError ? { error: actionError.message } : {}),
        ...(resolution ? { resolution } : {}),
      };
      steps.push(recordedStep);
      await options.recorder?.recordStep(recordedStep);
      if (actionError) {
        // see docs/02-architecture.md "Repair ladder" — on assertion failure, never
        // fail the task blindly and never silently continue. The step above is
        // recorded with its error either way; what a remaining budget buys is one
        // chance to reconcile against the real page.
        //
        // INVARIANT: only a failed *postcondition* is repairable. An action that
        // threw (element detached, navigation error) is a broken world, not a wrong
        // belief about it, and stays fatal.
        const repairable = actionError instanceof BrowserExpectationError && repairsUsed < maxRepairs;
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
        if (success) {
          const verification = await options.verifier.verify(await options.page.capture(), options.task, action.summary);
          success = verification.success;
          summary = verification.summary;
        }
        // INVARIANT: planner-declared completion is never success until an independent verifier passes.
        const result = resultFromSteps(success, summary, steps);
        finished = true;
        await options.recorder?.finish(success ? 'success' : 'failure', summary, result.tokenUsage);
        return result;
      }
    }

    const summary = `planner exceeded maxSteps=${maxSteps}`;
    const result = resultFromSteps(false, summary, steps);
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

function resultFromSteps(success: boolean, summary: string, steps: BrowserAgentStep[]): BrowserAgentResult {
  return { success, summary, steps, tokenUsage: tokenUsageFromSteps(steps) };
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

function resolveAction(action: BrowserAction, nodes: readonly DistilledNode[]): ElementResolutionResult | undefined {
  if (action.kind === 'navigate' || action.kind === 'done') return undefined;
  const hasSemanticIdentity = Boolean(action.stableId || action.role || action.name || action.text);
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
  resolvedSelector?: string,
): Promise<void> {
  switch (action.kind) {
    case 'navigate':
      await page.navigate(action.url);
      return;
    case 'fill':
      await page.fill(resolvedSelector ?? action.selector, action.value);
      return;
    case 'select':
      await page.select(resolvedSelector ?? action.selector, action.value);
      return;
    case 'click':
      await page.click(resolvedSelector ?? action.selector);
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
    stableId: node.id.hash,
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
    stableId: node.id.hash,
    role: node.role,
    name: node.name,
  })).join('\n');
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
