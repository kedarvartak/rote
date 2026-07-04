import type { ToolCallOutcome, ToolCaller } from '../../src/tool-caller.js';

export type ToolScript = (args: Record<string, unknown>, callIndex: number) => ToolCallOutcome;

/** A scriptable fake tool boundary: maps tool name to a per-call script, and logs every call. */
export class FakeToolCaller implements ToolCaller {
  readonly calls: { tool: string; args: Record<string, unknown> }[] = [];
  private readonly callCounts = new Map<string, number>();

  constructor(private readonly scripts: Record<string, ToolScript>) {}

  async call(tool: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
    this.calls.push({ tool, args });
    const count = this.callCounts.get(tool) ?? 0;
    this.callCounts.set(tool, count + 1);
    const script = this.scripts[tool];
    if (!script) throw new Error(`FakeToolCaller: no script registered for tool "${tool}"`);
    return script(args, count);
  }
}

export function ok(result: unknown): ToolCallOutcome {
  return { ok: true, result };
}

export function fail(message: string, code = 'FAKE_ERROR'): ToolCallOutcome {
  return { ok: false, error: { message, code } };
}
