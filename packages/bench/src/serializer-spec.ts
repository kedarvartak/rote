import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { captureStaticHtml } from '@rote/browser';
import { distillPage, renderObservation } from '@rote/perception';
import { compareSerializerObservations, type SerializerComparisonResult } from './serializer-comparison.js';

export const SerializerFixtureSpecSchema = z.object({
  id: z.string().min(1),
  html_path: z.string().min(1),
  browser_use_observation_path: z.string().min(1),
});
export type SerializerFixtureSpec = z.infer<typeof SerializerFixtureSpecSchema>;

export const SerializerComparisonSpecSchema = z.object({
  fixtures: z.array(SerializerFixtureSpecSchema).min(1),
});
export type SerializerComparisonSpec = z.infer<typeof SerializerComparisonSpecSchema>;

/** Loads identical fixture pages plus captured Browser Use observations and compares serializers. */
export async function compareSerializersFromSpec(specPath: string): Promise<SerializerComparisonResult> {
  const resolvedSpec = resolve(specPath);
  const spec = SerializerComparisonSpecSchema.parse(JSON.parse(await readFile(resolvedSpec, 'utf8')));
  const specDir = dirname(resolvedSpec);
  const samples = await Promise.all(spec.fixtures.map(async (fixture) => {
    const htmlPath = resolve(specDir, fixture.html_path);
    const html = await readFile(htmlPath, 'utf8');
    const page = captureStaticHtml(htmlPath, html);
    const rote = renderObservation(distillPage(page), { maxChars: Number.MAX_SAFE_INTEGER });
    const browserUse = await readFile(resolve(specDir, fixture.browser_use_observation_path), 'utf8');
    return {
      id: fixture.id,
      rote_observation: rote.text,
      browser_use_observation: browserUse,
    };
  }));
  return compareSerializerObservations(samples);
}
