import { extractTableInfo, isTimestamptzType } from "@cosmicdrift/kumiko-framework/bun-db";
import { METRIC_RANGES } from "./constants.js";
import type { MetricDefinition } from "./types.js";

const KEBAB_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const TENANT_ID_FIELD = "tenantId";

export function metricHasTenantColumn(metric: MetricDefinition): boolean {
  return extractTableInfo(metric.source).hasColumn(TENANT_ID_FIELD);
}

export function validateMetrics(metrics: readonly MetricDefinition[]): void {
  const seen = new Set<string>();
  for (const metric of metrics) {
    if (seen.has(metric.id)) {
      throw new Error(`metrics: duplicate metric id "${metric.id}"`);
    }
    seen.add(metric.id);
    validateMetric(metric);
  }
}

type Fail = (reason: string) => never;
type TableInfo = ReturnType<typeof extractTableInfo>;

function validateMetric(metric: MetricDefinition): void {
  const fail: Fail = (reason) => {
    throw new Error(`metrics: metric "${metric.id}" ${reason}`);
  };
  if (!KEBAB_ID.test(metric.id)) fail("has an id that is not kebab-case");
  if (metric.scopes.length === 0) fail("declares no scopes");

  const info = extractTableInfo(metric.source);
  validateColumns(metric, info, fail);
  validateTimeSettings(metric, info, fail);
  validateShape(metric, fail);
  if (metric.scopes.includes("tenant") && !metricHasTenantColumn(metric)) {
    fail(`has scope "tenant" but ${info.name} has no tenant_id column`);
  }
}

function validateColumns(metric: MetricDefinition, info: TableInfo, fail: Fail): void {
  const requireColumn = (field: string, role: string): void => {
    if (!info.hasColumn(field)) fail(`${role} "${field}" is not a column of ${info.name}`);
  };
  if (metric.measure.fn !== "count") requireColumn(metric.measure.field, "measure field");
  for (const field of Object.keys(metric.where ?? {})) requireColumn(field, "where field");
  if (metric.groupBy !== undefined) requireColumn(metric.groupBy, "groupBy field");
  if (metric.stackBy !== undefined) requireColumn(metric.stackBy, "stackBy field");
  if (metric.timeField !== undefined) requireColumn(metric.timeField, "timeField");
}

function validateTimeSettings(metric: MetricDefinition, info: TableInfo, fail: Fail): void {
  const { timeField } = metric;
  if (timeField === undefined) {
    if (metric.bucket !== undefined) fail("sets bucket without timeField");
    if (metric.window !== undefined) fail("sets window without timeField");
  } else {
    if (!isTimestamptzType(info.pgTypeOf(info.columnOf(timeField)))) {
      fail(`timeField "${timeField}" is not a timestamptz column`);
    }
    if (metric.window !== undefined && !METRIC_RANGES.includes(metric.window)) {
      fail(`has an unknown window "${metric.window}"`);
    }
  }
}

function validateShape(metric: MetricDefinition, fail: Fail): void {
  if (metric.stackBy !== undefined) {
    if (metric.groupBy === undefined) fail("sets stackBy without groupBy");
    if (metric.bucket !== undefined) fail("combines stackBy with bucket");
  }
}
