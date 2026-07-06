import { z } from 'zod';

export const CapturedElementSchema = z.object({
  tag: z.string().min(1),
  attributes: z.record(z.string(), z.string()).default({}),
  text: z.string().default(''),
  depth: z.number().int().nonnegative(),
});
export type CapturedElement = z.infer<typeof CapturedElementSchema>;

export const CapturedPageSchema = z.object({
  url: z.string().min(1),
  title: z.string().default(''),
  html: z.string(),
  elements: z.array(CapturedElementSchema),
});
export type CapturedPage = z.infer<typeof CapturedPageSchema>;

/** Browser capture boundary for the harness; CDP and fixture backends share this shape. */
export interface BrowserCaptureBackend {
  capture(url: string): Promise<CapturedPage>;
}
