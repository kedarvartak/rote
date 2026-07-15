import { buildEnvFingerprint, canonicalStringify, sha256Hex, type EnvFingerprint } from '@rote/core';

/** The shape of an MCP `tools/list` result this module needs. */
export interface ToolsListResult {
  tools: Array<{ name: string; inputSchema?: unknown }>;
}

/**
 * Builds the session's EnvFingerprint from the downstream server's first
 * `tools/list` response plus the configured target identity. Each tool's
 * `schema_hash` is the SHA-256 of its canonicalized `inputSchema` — so a
 * tool with an unchanged name but a changed schema still fingerprints
 * differently (docs/05-roadmap.md M0 "Fingerprint stability"). Pure.
 */
export function fingerprintFromToolsList(
  toolsList: ToolsListResult,
  targetIdentity: string,
  surfaceVersions: Record<string, string> = {},
): EnvFingerprint {
  const tool_inventory = toolsList.tools.map((tool) => ({
    name: tool.name,
    schema_hash: sha256Hex(canonicalStringify(tool.inputSchema ?? null)),
  }));
  return buildEnvFingerprint({
    tool_inventory,
    target_identity: targetIdentity,
    surface_versions: surfaceVersions,
  });
}
