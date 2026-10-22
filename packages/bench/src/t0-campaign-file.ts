import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  T0CampaignRecordSchema,
  auditT0Campaign,
  renderT0CampaignAudit,
  type T0CampaignAudit,
} from './t0-campaign.js';

/** Reads retained T0 rows and writes both human and machine-readable audit artifacts. */
export async function writeT0CampaignAudit(
  recordsPath: string,
  output: { markdown: string; summary: string },
): Promise<T0CampaignAudit> {
  const records = z.array(T0CampaignRecordSchema).parse(JSON.parse(await readFile(recordsPath, 'utf8')));
  const audit = auditT0Campaign(records);
  await Promise.all([
    mkdir(dirname(output.markdown), { recursive: true }),
    mkdir(dirname(output.summary), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(output.markdown, `${renderT0CampaignAudit(audit)}\n`, 'utf8'),
    writeFile(output.summary, `${JSON.stringify(audit, null, 2)}\n`, 'utf8'),
  ]);
  return audit;
}
