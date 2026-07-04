import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { TokenUsageSchema, type TokenUsage } from '@rote/core';

const UsageSidecarSchema = z.union([
  z.array(TokenUsageSchema),
  z.object({ token_usage: z.array(TokenUsageSchema) }),
]);

/** Reads a benchmark LLM usage sidecar and validates every call has a source tag. */
export async function readUsageSidecar(path: string): Promise<TokenUsage[]> {
  const parsed = UsageSidecarSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  return Array.isArray(parsed) ? parsed : parsed.token_usage;
}
