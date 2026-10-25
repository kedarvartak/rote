/** Value-free prediction sample retained by the routing campaign. */
export interface RoutingCalibrationSample {
  run_id: string;
  phase_kind: 'routing_off' | 'routing_on';
  repetition: number;
  step: number;
  /** Page identity digest; raw URLs are never retained. */
  site_key: string;
  source: string;
  confidence: number;
  /** Value-free actual action identity. */
  action_kind: string;
  action_target: string;
  /** Value-free predicted identity, omitted when the predictor abstained. */
  predicted_kind?: string;
  predicted_action_target?: string;
  hit: boolean;
}

export interface RoutingCalibrationBucket {
  bucket: string;
  lower: number;
  upper: number;
  steps: number;
  hits: number;
  hit_rate: number;
  mean_confidence: number;
}

export interface RoutingCalibrationThreshold {
  threshold: number;
  coverage: number;
  precision: number;
  acted: number;
  hits: number;
}

/** One source or site slice of the retained routing observations. */
export interface RoutingCalibrationGroup {
  /** All recorded agent steps in this slice, including failures and no-prediction steps. */
  steps: number;
  predicted_steps: number;
  hits: number;
  coverage: number;
  precision: number;
  mean_confidence: number;
  calibration: RoutingCalibrationBucket[];
  thresholds: RoutingCalibrationThreshold[];
}

export interface RoutingCalibrationReport {
  total_steps: number;
  predicted_steps: number;
  hits: number;
  coverage: number;
  precision: number;
  mean_confidence: number;
  by_source: Record<string, RoutingCalibrationGroup>;
  by_site: Record<string, RoutingCalibrationGroup>;
}

export const ROUTING_CALIBRATION_THRESHOLDS = [0.5, 0.7, 0.8, 0.9, 0.95] as const;
const BUCKETS: readonly [number, number][] = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.0]];

/**
 * Summarises shadow predictions without treating missing predictions as hits or
 * silently removing failed runs. `totalStepsBySite` is supplied by the caller
 * from every retained trajectory, while source slices use the campaign total
 * as their denominator so source coverage is comparable.
 */
export function summarizeRoutingCalibration(
  samples: readonly RoutingCalibrationSample[],
  totalSteps: number,
  totalStepsBySite: Readonly<Record<string, number>>,
): RoutingCalibrationReport {
  const bySource = summarizeGroups(groupBy(samples, (sample) => sample.source), () => totalSteps);
  const bySite = summarizeGroups(groupBy(samples, (sample) => sample.site_key), (key) => totalStepsBySite[key] ?? 0, Object.keys(totalStepsBySite));
  const overall = summarize(samples, totalSteps);
  return {
    total_steps: totalSteps,
    predicted_steps: overall.predicted_steps,
    hits: overall.hits,
    coverage: overall.coverage,
    precision: overall.precision,
    mean_confidence: overall.mean_confidence,
    by_source: bySource,
    by_site: bySite,
  };
}

function groupBy(samples: readonly RoutingCalibrationSample[], keyOf: (sample: RoutingCalibrationSample) => string): Map<string, RoutingCalibrationSample[]> {
  const groups = new Map<string, RoutingCalibrationSample[]>();
  for (const sample of samples) groups.set(keyOf(sample), [...(groups.get(keyOf(sample)) ?? []), sample]);
  return groups;
}

function summarizeGroups(
  groups: Map<string, RoutingCalibrationSample[]>,
  totalStepsFor: (key: string) => number,
  includeKeys: readonly string[] = [],
): Record<string, RoutingCalibrationGroup> {
  for (const key of includeKeys) if (!groups.has(key)) groups.set(key, []);
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, samples]) => [key, summarize(samples, totalStepsFor(key))]));
}

function summarize(samples: readonly RoutingCalibrationSample[], totalSteps: number): RoutingCalibrationGroup {
  const hits = samples.filter((sample) => sample.hit).length;
  const confidence = samples.reduce((sum, sample) => sum + sample.confidence, 0);
  const calibration = BUCKETS.map(([lower, upper]) => {
    const inBucket = samples.filter((sample) => sample.confidence >= lower && (upper === 1 ? sample.confidence <= upper : sample.confidence < upper));
    const bucketHits = inBucket.filter((sample) => sample.hit).length;
    return {
      bucket: `${lower}–${upper}`, lower, upper,
      steps: inBucket.length, hits: bucketHits,
      hit_rate: inBucket.length ? bucketHits / inBucket.length : 0,
      mean_confidence: inBucket.length ? inBucket.reduce((sum, sample) => sum + sample.confidence, 0) / inBucket.length : 0,
    };
  });
  const thresholds = ROUTING_CALIBRATION_THRESHOLDS.map((threshold) => {
    const acted = samples.filter((sample) => sample.confidence >= threshold);
    const actedHits = acted.filter((sample) => sample.hit).length;
    return {
      threshold,
      coverage: totalSteps > 0 ? acted.length / totalSteps : 0,
      precision: acted.length > 0 ? actedHits / acted.length : 0,
      acted: acted.length,
      hits: actedHits,
    };
  });
  return {
    steps: totalSteps,
    predicted_steps: samples.length,
    hits,
    coverage: totalSteps > 0 ? samples.length / totalSteps : 0,
    precision: samples.length > 0 ? hits / samples.length : 0,
    mean_confidence: samples.length > 0 ? confidence / samples.length : 0,
    calibration,
    thresholds,
  };
}
