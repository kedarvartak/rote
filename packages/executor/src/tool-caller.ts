export interface ToolCallSuccess {
  ok: true;
  result: unknown;
}

export interface ToolCallFailure {
  ok: false;
  error: { message: string; code?: string };
}

export type ToolCallOutcome = ToolCallSuccess | ToolCallFailure;

/**
 * Dispatches a deterministic step's tool call. Injected (CLAUDE.md "inject
 * dependencies... no module-level singletons") so tests supply a fake and
 * production wires a real MCP client — the executor itself never talks to
 * a transport directly.
 */
export interface ToolCaller {
  call(tool: string, args: Record<string, unknown>): Promise<ToolCallOutcome>;
}
