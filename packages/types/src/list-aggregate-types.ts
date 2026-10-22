import * as z from "zod";
import type { AggregateKey } from "./aggregate-types.ts";
import { isPlainObject } from "./type-guards.ts";

export const MAX_LIST_AGGREGATE_MEASURES = 20;

export const LIST_AGGREGATE_MEASURE_KINDS = ["sum", "avg", "count", "min", "max"] as const;

export type ListAggregateMeasureKind = (typeof LIST_AGGREGATE_MEASURE_KINDS)[number];

export const listAggregatePayloadSchema = z.object({
  groupBy: z.string().optional(),
  measures: z
    .array(z.object({ field: z.string(), kind: z.enum(LIST_AGGREGATE_MEASURE_KINDS) }))
    .max(MAX_LIST_AGGREGATE_MEASURES)
    .default([]),
});

export type ListAggregatePayload = {
  readonly groupBy?: string | undefined;
  readonly measures: readonly {
    readonly field: string;
    readonly kind: ListAggregateMeasureKind;
  }[];
};

export type ListAggregateValue = number | string | null;

export type ListAggregateGroup = {
  readonly key: AggregateKey;
  readonly label?: string | null;
  readonly count: number;
  readonly measures: readonly ListAggregateValue[];
};

export type ListAggregateResult = {
  readonly groups: readonly ListAggregateGroup[];
  readonly truncated?: true;
  readonly searchTruncated?: true;
};

const LIST_AGGREGATE_RESULT_KEYS: ReadonlySet<string> = new Set([
  "groups",
  "truncated",
  "searchTruncated",
]);

// Closed key set: a row that merely has a `groups` field (jsonb column) must not
// be mistaken for an aggregate and skip the row-level read filter.
export function isListAggregateResult(value: unknown): value is ListAggregateResult {
  return (
    isPlainObject(value) &&
    Array.isArray(value["groups"]) &&
    Object.keys(value).every((key) => LIST_AGGREGATE_RESULT_KEYS.has(key))
  );
}
