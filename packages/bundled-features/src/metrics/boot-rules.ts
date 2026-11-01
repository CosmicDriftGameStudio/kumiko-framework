import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const METRICS_BOOT_RULES = {
  duplicateMetricId: {
    id: "metrics/duplicate-metric-id",
    summary: "Metric ids passed to the metrics factory are unique.",
    fix: "Rename one of the metrics.",
  },
  invalidMetric: {
    id: "metrics/invalid-metric",
    summary:
      "Each metric passed to the metrics factory has a kebab-case id and a valid definition.",
    fix: "Fix the metric named in the error message.",
  },
} as const satisfies BootRuleTable;
