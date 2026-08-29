import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  assertP2CampaignPreflight,
  parseP2CampaignDryRun,
  parseP2CampaignProtocol,
  type P2CampaignProtocol,
} from './p2-campaign-preflight.js';

/** Successful, non-evidentiary result written by the no-provider campaign preflight. */
export interface P2CampaignPreflightReport {
  protocol_id: string;
  preflight: 'passed';
  cells: readonly string[];
  provider_calls: 0;
}

/**
 * Reads static campaign inputs, validates every planned row, and writes a dry-run report.
 * @throws P2CampaignPreflightError or ZodError when the campaign is not safe to collect.
 */
export async function writeP2CampaignPreflight(
  protocolPath: string,
  dryRunPath: string,
  outPath: string,
): Promise<P2CampaignPreflightReport> {
  const protocol = await readProtocol(protocolPath);
  const rows = parseP2CampaignDryRun(JSON.parse(await readFile(resolve(dryRunPath), 'utf8')));
  assertP2CampaignPreflight(protocol, rows);
  const report: P2CampaignPreflightReport = {
    protocol_id: protocol.protocol_id,
    preflight: 'passed',
    cells: protocol.cells.map((cell) => cell.id),
    provider_calls: 0,
  };
  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

async function readProtocol(path: string): Promise<P2CampaignProtocol> {
  return parseP2CampaignProtocol(JSON.parse(await readFile(resolve(path), 'utf8')));
}
