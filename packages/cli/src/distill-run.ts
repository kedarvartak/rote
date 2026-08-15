import { distillTrajectory, loadRecordedRun, type DistillReport } from '@rote/distiller';
import { FilePlaybookLibrary } from '@rote/matcher';
import { deriveSiteMemory, FileSiteMemoryStore } from '@rote/site-memory';

// see docs/02-architecture.md "Learning" — recorded trajectories → playbooks →
// site memory. One command learns both tiers from one verified run: the
// distilled playbook goes to the append-only library (tier 1, matched by
// `rote run`), and value-free site memory to this environment's partition
// (tier 2, rendered as the cold-path brief). Nothing here calls a model.

export interface DistillRunOptions {
  baseDir: string;
  runId: string;
  playbookName: string;
  /** Declared task inputs with the values this run used; the distiller replaces them by `{{name}}` and never persists them. */
  params: Record<string, string>;
  /** Fingerprint pattern domain for the playbook's task signature; defaults to the run's target identity. */
  domain?: string;
  /** Persist fill/select values that match no declared param literally (explicit opt-in). */
  literalValues?: 'fail' | 'allow';
  clock?: () => Date;
}

export interface DistillRunResult {
  playbookPath: string;
  playbook: string;
  version: number;
  kept: number;
  pruned: DistillReport['pruned'];
  contractedSteps: number;
  verifySource: DistillReport['verifySource'];
  evidenceClasses: string[];
  usedParams: string[];
  siteMemoryRecords: number;
  siteMemorySkipped: number;
  fingerprintHash: string;
}

/** Distills one recorded successful run into the playbook library and this environment's site memory. */
export async function distillRun(options: DistillRunOptions): Promise<DistillRunResult> {
  const run = await loadRecordedRun(options.baseDir, options.runId);
  const fingerprintHash = run.manifest.env_fingerprint.fingerprint_hash;
  const report = distillTrajectory(run.events, {
    playbookName: options.playbookName,
    intentDescription: run.manifest.task_spec,
    envFingerprint: { domain: options.domain ?? run.manifest.env_fingerprint.target_identity, tool_prefixes: ['browser.'] },
    params: Object.entries(options.params).map(([name, value]) => ({ name, type: 'string' as const, value })),
    ...(options.literalValues ? { literalValues: options.literalValues } : {}),
  });
  const now = (options.clock ?? (() => new Date()))();
  const library = new FilePlaybookLibrary(options.baseDir);
  const entry = await library.add({ playbook: report.playbook, fingerprintHash, sourceRunId: run.runId, addedAt: now });
  const memory = deriveSiteMemory(run.events, { fingerprintHash, runId: run.runId, observedAt: now.toISOString() });
  await new FileSiteMemoryStore(options.baseDir).append(fingerprintHash, memory.records);
  return {
    playbookPath: entry.playbook_path!,
    playbook: report.playbook.playbook,
    version: report.playbook.version,
    kept: report.kept.length,
    pruned: report.pruned,
    contractedSteps: report.contractedStepIds.length,
    verifySource: report.verifySource,
    evidenceClasses: report.evidenceClasses,
    usedParams: report.usedParams,
    siteMemoryRecords: memory.records.length,
    siteMemorySkipped: memory.skipped.length,
    fingerprintHash,
  };
}
