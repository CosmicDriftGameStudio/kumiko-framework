import { extractTableInfo, type WhereObject } from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import type { MetricDefinition, MetricFilterResolver } from "./types.js";

export const RESERVED_PAYLOAD_KEYS: readonly string[] = ["range", "timeZone", "tenantId"];

// Dashboard select options always send strings.
const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;
const INTEGER_STRING = /^-?\d+$/;
const MAX_FILTER_STRING_LENGTH = 200;
const INTEGER_RANGES = {
  smallint: { min: -32_768, max: 32_767 },
  integer: { min: -2_147_483_648, max: 2_147_483_647 },
  // bigint is bound as a JS number, so only the exactly representable range is accepted.
  bigint: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
} as const;
const PG_INTEGER_KINDS: Readonly<Record<string, keyof typeof INTEGER_RANGES>> = {
  smallint: "smallint",
  int2: "smallint",
  integer: "integer",
  int4: "integer",
  serial: "integer",
  bigint: "bigint",
  bigserial: "bigint",
};

export type FilterValueKind = "uuid" | "number" | "string" | keyof typeof INTEGER_RANGES;

/** Undefined = the column type cannot be filtered by a payload value without risking a Postgres cast error. */
export function filterValueKindOf(pgType: string | undefined): FilterValueKind | undefined {
  if (pgType === undefined) return undefined;
  if (pgType === "uuid") return "uuid";
  if (pgType === "text") return "string";
  const integerKind = PG_INTEGER_KINDS[pgType];
  if (integerKind !== undefined) return integerKind;
  if (pgType === "double precision" || pgType.startsWith("numeric")) return "number";
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

function integerValueSchema(range: { readonly min: number; readonly max: number }): z.ZodType {
  const bounded = z.number().int().min(range.min).max(range.max);
  return z.union([bounded, z.string().regex(INTEGER_STRING).transform(Number).pipe(bounded)]);
}

function filterValueSchema(kind: FilterValueKind): z.ZodType {
  if (kind === "uuid") return z.uuid();
  if (kind === "smallint" || kind === "integer" || kind === "bigint") {
    return integerValueSchema(INTEGER_RANGES[kind]);
  }
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
