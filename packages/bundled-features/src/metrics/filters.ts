import { extractTableInfo, type WhereObject } from "@cosmicdrift/kumiko-framework/bun-db";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import type { MetricDefinition, MetricFilterResolver } from "./types.js";

export const RESERVED_PAYLOAD_KEYS: readonly string[] = ["range", "timeZone", "tenantId"];

// Dashboard select options always send strings.
const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;
const MAX_FILTER_STRING_LENGTH = 200;
const NUMERIC_PG_TYPES: ReadonlySet<string> = new Set([
  "integer",
  "int4",
  "smallint",
  "int2",
  "bigint",
  "serial",
  "bigserial",
  "double precision",
]);

export type FilterValueKind = "uuid" | "number" | "string";

/** Undefined = the column type cannot be filtered by a payload value without risking a Postgres cast error. */
export function filterValueKindOf(pgType: string | undefined): FilterValueKind | undefined {
  if (pgType === undefined) return undefined;
  if (pgType === "uuid") return "uuid";
  if (pgType === "text") return "string";
  if (NUMERIC_PG_TYPES.has(pgType) || pgType.startsWith("numeric")) return "number";
  return undefined;
}

export type MetricFilterEntry = {
  readonly payloadKey: string;
  readonly column: string;
  readonly resolver?: MetricFilterResolver;
};

export function metricFilterEntries(metric: MetricDefinition): readonly MetricFilterEntry[] {
  return Object.entries(metric.filters ?? {}).map(([payloadKey, spec]) =>
    typeof spec === "string"
      ? { payloadKey, column: spec }
      : { payloadKey, column: spec.column, resolver: spec },
  );
}

function filterValueSchema(kind: FilterValueKind): z.ZodType {
  if (kind === "uuid") return z.uuid();
  if (kind === "number")
    return z.union([z.number(), z.string().regex(NUMERIC_STRING).transform(Number)]);
  return z.string().min(1).max(MAX_FILTER_STRING_LENGTH);
}

/** "" and null mean "no filter" (the dashboard's "(all)" option). */
export function metricFilterPayloadShape(metric: MetricDefinition): Record<string, z.ZodType> {
  const info = extractTableInfo(metric.source);
  const shape: Record<string, z.ZodType> = {};
  for (const { payloadKey, column, resolver } of metricFilterEntries(metric)) {
    const kind =
      resolver !== undefined
        ? (resolver.valueKind ?? "string")
        : filterValueKindOf(info.pgTypeOf(info.columnOf(column)));
    if (kind === undefined) continue;
    shape[payloadKey] = z.union([z.literal(""), z.null(), filterValueSchema(kind)]).optional();
  }
  return shape;
}

function activeFilterValue(payload: Readonly<Record<string, unknown>>, key: string): unknown {
  const value = payload[key];
  return value === undefined || value === null || value === "" ? undefined : value;
}

/** Column-equality filters only; resolver filters need resolveMetricFilterWhere. */
export function metricFilterWhere(
  metric: MetricDefinition,
  payload: Readonly<Record<string, unknown>>,
): WhereObject {
  const where: WhereObject = {};
  for (const { payloadKey, column, resolver } of metricFilterEntries(metric)) {
    const value = activeFilterValue(payload, payloadKey);
    if (resolver === undefined && value !== undefined) where[column] = value;
  }
  return where;
}

export async function resolveMetricFilterWhere(
  metric: MetricDefinition,
  payload: Readonly<Record<string, unknown>>,
  ctx: HandlerContext,
): Promise<WhereObject> {
  const where = metricFilterWhere(metric, payload);
  for (const { payloadKey, column, resolver } of metricFilterEntries(metric)) {
    const value = activeFilterValue(payload, payloadKey);
    if (resolver === undefined || (typeof value !== "string" && typeof value !== "number"))
      continue;
    where[column] = await resolver.resolve(value, ctx);
  }
  return where;
}
