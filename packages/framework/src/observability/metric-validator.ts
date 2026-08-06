import { assertUnreachable } from "../utils";
import type { MetricType } from "./types";

// Boot-time validation of metric names — catches typos and convention
// violations before any metric is emitted. See observability-naming.md.

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

export function validateMetricName(name: string, type: MetricType): void {
  if (!SNAKE_CASE.test(name)) {
    throw new Error(
      `[Kumiko Observability] Metric "${name}" must be snake_case (a-z, 0-9, _). ` +
        `Type: ${type}.`,
    );
  }

  switch (type) {
    case "counter":
      if (!name.endsWith("_total")) {
        throw new Error(
          `[Kumiko Observability] Counter "${name}" must end with "_total". ` +
            `Suggested: "${name}_total".`,
        );
      }
      // skip: counter suffix validated, nothing more to check
      return;

    case "histogram":
      if (name.endsWith("_total")) {
        throw new Error(
          `[Kumiko Observability] Histogram "${name}" must not end with "_total" ` +
            `— that suffix is reserved for counters.`,
        );
      }
      // Histogram must carry a unit suffix (_seconds, _bytes, _eur, ...).
      // Enforce at least one `_<word>` before end to catch naked names.
      if (!/_[a-z]+$/.test(name)) {
        throw new Error(
          `[Kumiko Observability] Histogram "${name}" needs a unit suffix ` +
            `(e.g. "${name}_seconds", "${name}_bytes", "${name}_eur").`,
        );
      }
      // skip: histogram naming + unit suffix validated
      return;

    case "gauge":
      if (name.endsWith("_total")) {
        throw new Error(
          `[Kumiko Observability] Gauge "${name}" must not end with "_total" ` +
            `— that suffix is reserved for counters.`,
        );
      }
      if (name.endsWith("_seconds")) {
        throw new Error(
          `[Kumiko Observability] Gauge "${name}" should not end with "_seconds" ` +
            `— duration values are typically histograms.`,
        );
      }
      // skip: gauge naming validated (no _total, no _seconds)
      return;

    default:
      assertUnreachable(type, "metric type");
  }
}

// Prefix a short feature-local metric name with the Kumiko + feature prefix.
// Short name: "created_total". Feature: "orders". Result: "kumiko_orders_created_total".
//
// Feature names are kebab-case everywhere else (qualified-name segments,
// r.metric() is called with `feature.name` as registered at defineFeature
// time) — normalize "-" to "_" here so a feature like "ai-foundation"
// resolves to the same "kumiko_ai_foundation_x" on both the registration
// path (registry-ingest.ts) and the read path (ctx.metrics / ctx.metricsFor),
// instead of the kebab form being rejected outright (framework#1844).
export function buildMetricName(featureName: string, shortName: string): string {
  const normalizedFeatureName = featureName.replace(/-/g, "_");
  if (!SNAKE_CASE.test(normalizedFeatureName)) {
    throw new Error(
      `[Kumiko Observability] Feature name "${featureName}" must be kebab-case or snake_case ` +
        `(a-z, 0-9, "-" or "_").`,
    );
  }
  return `kumiko_${normalizedFeatureName}_${shortName}`;
}

// Validate label keys: snake_case, not reserved.
const RESERVED_LABELS = new Set(["__name__", "le", "quantile"]);

export function validateLabelKey(key: string): void {
  if (!SNAKE_CASE.test(key)) {
    throw new Error(`[Kumiko Observability] Label key "${key}" must be snake_case.`);
  }
  if (RESERVED_LABELS.has(key)) {
    throw new Error(`[Kumiko Observability] Label key "${key}" is reserved (Prometheus internal).`);
  }
}
