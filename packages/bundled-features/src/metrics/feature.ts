import {
  access,
  defineFeature,
  defineQueryHandler,
  type FeatureDefinition,
  type QueryHandlerDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, ValidationError } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "temporal-polyfill";
import * as z from "zod";
import { runMetric } from "./compute.js";
import {
  METRIC_RANGES,
  METRICS_FEATURE,
  METRICS_SYSTEM_FEATURE,
  type MetricScope,
} from "./constants.js";
import {
  metricFilterPayloadShape,
  metricFilterWhere,
  resolveMetricFilterWhere,
} from "./filters.js";
import { METRICS_I18N } from "./i18n.js";
import type { MetricDefinition, MetricsFeatureOptions } from "./types.js";
import { metricHasTenantColumn, validateMetrics } from "./validate.js";
import { isValidTimeZone } from "./window.js";

const DEFAULT_RANGE = "7d";
const DEFAULT_TIME_ZONE = "UTC";

const windowFields = {
  range: z.enum(METRIC_RANGES).default(DEFAULT_RANGE),
  timeZone: z.string().default(DEFAULT_TIME_ZONE),
};

const invalidTimeZone = {
  path: ["timeZone"],
  message: "Unknown IANA time zone",
};

function tenantPayloadSchema(metric: MetricDefinition) {
  return z
    .object({ ...metricFilterPayloadShape(metric), ...windowFields })
    .refine((payload) => isValidTimeZone(payload.timeZone), invalidTimeZone);
}

function systemPayloadSchema(metric: MetricDefinition) {
  return z
    .object({
      ...metricFilterPayloadShape(metric),
      ...windowFields,
      tenantId: z.uuid().optional(),
    })
    .refine((payload) => isValidTimeZone(payload.timeZone), invalidTimeZone);
}

const defaultClock = (): Temporal.Instant => Temporal.Now.instant();

function metricsForScope(
  metrics: readonly MetricDefinition[],
  scope: MetricScope,
): readonly MetricDefinition[] {
  return metrics.filter((metric) => metric.scopes.includes(scope));
}

function requiredFeatures(metrics: readonly MetricDefinition[]): readonly string[] {
  const features = metrics.flatMap((metric) =>
    metric.requires === undefined ? [] : [metric.requires],
  );
  return [...new Set(features)];
}

function createTenantMetricQuery(
  metric: MetricDefinition,
  now: () => Temporal.Instant,
): QueryHandlerDefinition {
  return defineQueryHandler({
    name: metric.id,
    description: metric.description,
    schema: tenantPayloadSchema(metric),
    access: { roles: access.admin },
    handler: async (query, ctx) =>
      runMetric(ctx.db, metric, {
        range: query.payload.range,
        timeZone: query.payload.timeZone,
        now: now(),
        filterWhere: await resolveMetricFilterWhere(metric, query.payload, ctx),
        // ctx.db already reads own-tenant + SYSTEM reference rows; this narrows to own-tenant only.
        scopeWhere: { tenantId: query.user.tenantId },
      }),
  });
}

function createSystemMetricQuery(
  metric: MetricDefinition,
  now: () => Temporal.Instant,
): QueryHandlerDefinition {
  return defineQueryHandler({
    name: metric.id,
    description: metric.description,
    schema: systemPayloadSchema(metric),
    access: { roles: access.systemAdmin },
    handler: (query, ctx) => {
      if (!ctx.systemDb) {
        throw new InternalError({
          message: `${METRICS_SYSTEM_FEATURE}:query:${metric.id} requires ctx.systemDb — is r.systemScope() set?`,
        });
      }
      const { tenantId } = query.payload;
      if (tenantId !== undefined && !metricHasTenantColumn(metric)) {
        throw new ValidationError({
          fields: [
            {
              path: "tenantId",
              code: "unsupported",
              i18nKey: "metrics.errors.tenantFilterUnsupported",
            },
          ],
        });
      }
      const db = ctx.systemDb.acknowledgeCrossTenant(
        `${METRICS_SYSTEM_FEATURE}:${metric.id} — SystemAdmin platform-wide aggregate`,
      );
      return runMetric(db, metric, {
        range: query.payload.range,
        timeZone: query.payload.timeZone,
        now: now(),
        filterWhere: metricFilterWhere(metric, query.payload),
        scopeWhere: tenantId === undefined ? {} : { tenantId },
      });
    },
  });
}

export function createMetricsFeature(options: MetricsFeatureOptions): FeatureDefinition {
  validateMetrics(options.metrics);
  const metrics = metricsForScope(options.metrics, "tenant");
  const now = options.now ?? defaultClock;

  return defineFeature(METRICS_FEATURE, (r) => {
    r.describe(
      "Declarative tenant-scoped metrics: each metric declaration becomes an admin-only query that aggregates a read-model table for the caller's own tenant and returns the shape dashboard panels consume (stat value with period delta, time series, ranked rows).",
    );
    r.uiHints({
      displayLabel: "Metrics · Tenant Dashboard Data",
      category: "operations",
      recommended: false,
    });
    for (const feature of requiredFeatures(metrics)) r.requires(feature);
    for (const metric of metrics) r.queryHandler(createTenantMetricQuery(metric, now));
    r.translations({ keys: METRICS_I18N });
  });
}

export function createSystemMetricsFeature(options: MetricsFeatureOptions): FeatureDefinition {
  validateMetrics(options.metrics);
  const metrics = metricsForScope(options.metrics, "system");
  const now = options.now ?? defaultClock;

  return defineFeature(METRICS_SYSTEM_FEATURE, (r) => {
    r.describe(
      "Declarative platform-wide metrics for SystemAdmin: each metric declaration becomes a query that aggregates a read-model table across all tenants (optionally narrowed to one tenant) and returns the shape dashboard panels consume.",
    );
    r.uiHints({
      displayLabel: "Metrics · Platform Dashboard Data",
      category: "operations",
      recommended: false,
    });
    r.systemScope();
    for (const feature of requiredFeatures(metrics)) r.requires(feature);
    for (const metric of metrics) r.queryHandler(createSystemMetricQuery(metric, now));
    r.translations({ keys: METRICS_I18N });
  });
}
