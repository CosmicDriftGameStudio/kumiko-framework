// @runtime client
// Pure constants — imported by server (feature.ts) and by panel declarations,
// so no runtime import from the engine barrel here.

export const METRICS_FEATURE = "metrics" as const;
export const METRICS_SYSTEM_FEATURE = "metrics-system" as const;

export type MetricScope = "system" | "tenant";

const FEATURE_BY_SCOPE: Readonly<Record<MetricScope, string>> = {
  tenant: METRICS_FEATURE,
  system: METRICS_SYSTEM_FEATURE,
};

export function metricQueryName(scope: MetricScope, id: string): string {
  return `${FEATURE_BY_SCOPE[scope]}:query:${id}`;
}

export const METRIC_RANGES = ["24h", "7d", "14d", "30d"] as const;
export type MetricRange = (typeof METRIC_RANGES)[number];

export const MAX_GROUP_ROWS = 50;
