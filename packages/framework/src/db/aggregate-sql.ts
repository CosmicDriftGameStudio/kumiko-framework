import type {
  AggregateDimension,
  AggregateKey,
  AggregateSpec,
  AggregateTimeBucket,
} from "@cosmicdrift/kumiko-types/aggregate-types";
import type { FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import type {
  ListAggregateMeasureKind,
  ListAggregateValue,
} from "@cosmicdrift/kumiko-types/list-aggregate-types";
import { quoteIdent } from "../crypto/ciphertext-pattern.ts";
import type { TableInfo } from "./table-info.ts";

const AGGREGATE_BUCKET_UNITS: readonly AggregateTimeBucket[] = ["hour", "day"];
const AGGREGATE_ORDER_DIRECTIONS = ["asc", "desc"] as const;

function requireAggregateColumn(info: TableInfo, field: string, role: string): string {
  if (!info.hasColumn(field)) {
    throw new Error(`aggregateWhere: ${role} "${field}" is not a column of ${info.name}`);
  }
  return quoteIdent(info.columnOf(field));
}

export function isTimestamptzType(pgType: string | undefined): boolean {
  return pgType === "timestamptz" || pgType === "timestamptz(3)";
}

export function aggregateKeyOf(raw: unknown): AggregateKey {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;
  if (typeof raw === "bigint") return Number(raw);
  if (raw instanceof Date) return raw.toISOString();
  return String(raw);
}

export type AggregateFunction = "count" | "countDistinct" | "sum" | "avg" | "min" | "max";

// FILTER sits inside the aggregate so a row-dependent read clause restricts only
// this measure; COALESCE stays outside to keep an all-filtered SUM at 0.
export function aggregateFunctionSql(
  fn: AggregateFunction,
  columnSql: string | undefined,
  filterSql?: string,
): string {
  const filter = filterSql === undefined ? "" : ` FILTER (WHERE ${filterSql})`;
  const column = columnSql ?? "*";
  switch (fn) {
    case "count":
      return `COUNT(${column})${filter}`;
    case "countDistinct":
      return `COUNT(DISTINCT ${column})${filter}`;
    case "sum":
      return `COALESCE(SUM(${column})${filter}, 0)`;
    case "avg":
      return `AVG(${column})${filter}`;
    case "min":
      return `MIN(${column})${filter}`;
    case "max":
      return `MAX(${column})${filter}`;
    default:
      throw new Error(`aggregateWhere: unknown aggregate fn "${String(fn)}"`);
  }
}

export function aggregateMeasureSql(info: TableInfo, measure: AggregateSpec["measure"]): string {
  if (measure.fn === "count") return aggregateFunctionSql("count", undefined);
  return aggregateFunctionSql(
    measure.fn,
    requireAggregateColumn(info, measure.field, "measure field"),
  );
}

type FieldType = FieldDefinition["type"];

const NUMERIC_MEASURE_TYPES: readonly FieldType[] = ["number", "bigInt", "decimal", "money"];
const ORDERED_MEASURE_TYPES: readonly FieldType[] = [...NUMERIC_MEASURE_TYPES, "date", "timestamp"];
// Group keys must round-trip as a plain `field eq key` filter, which rules out
// composite, multi-valued, currency-paired and zone-paired types.
const GROUPABLE_TYPES: readonly FieldType[] = [
  "text",
  "longText",
  "select",
  "boolean",
  "number",
  "bigInt",
  "decimal",
  "date",
  "timestamp",
];

export function isListAggregateMeasureSupported(
  kind: ListAggregateMeasureKind,
  fieldType: FieldType,
): boolean {
  if (kind === "count") return true;
  const allowed = kind === "sum" || kind === "avg" ? NUMERIC_MEASURE_TYPES : ORDERED_MEASURE_TYPES;
  return allowed.includes(fieldType);
}

export function isListAggregateGroupable(fieldType: FieldType, multiple: boolean): boolean {
  return fieldType === "reference" ? !multiple : GROUPABLE_TYPES.includes(fieldType);
}

export function listAggregateKeySql(
  fieldType: FieldType,
  columnSql: string,
  alias: string,
): string {
  // A date column must not pass through a JS Date, so it travels as text.
  return fieldType === "date" ? `${columnSql}::text AS ${alias}` : `${columnSql} AS ${alias}`;
}

const ISO_UTC_TIMESTAMP_FORMAT = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

// Numbers leave PG as float8 and dates/timestamps as text, so the driver never
// hands back a bigint or numeric string that JSON could not carry.
export function listAggregateMeasureSql(
  kind: ListAggregateMeasureKind,
  fieldType: FieldType,
  columnSql: string,
  filterSql?: string,
): string {
  const fn = aggregateFunctionSql(kind, columnSql, filterSql);
  if (kind === "count") return `(${fn})::float8`;
  if (kind === "min" || kind === "max") {
    if (fieldType === "date") return `(${fn})::text`;
    if (fieldType === "timestamp") {
      return `to_char((${fn}) AT TIME ZONE 'UTC', ${ISO_UTC_TIMESTAMP_FORMAT})`;
    }
  }
  // Money is integer minor units, so an average rounds to one.
  if (kind === "avg" && fieldType === "money") return `ROUND(${fn})::float8`;
  return `(${fn})::float8`;
}

export function groupedKeyOrderLimitSql(limit: number): string {
  return ` GROUP BY 1 ORDER BY 1 ASC NULLS LAST LIMIT ${limit}`;
}

export function decodeListAggregateValue(raw: unknown): ListAggregateValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" || typeof raw === "string") return raw;
  if (typeof raw === "bigint") return Number(raw);
  if (raw instanceof Date) return raw.toISOString();
  return String(raw);
}

// What the measure reports over zero rows, mirroring the SQL (SUM coalesces, COUNT is 0).
export function emptyListAggregateValue(kind: ListAggregateMeasureKind): ListAggregateValue {
  return kind === "sum" || kind === "count" ? 0 : null;
}

export function aggregateDimensionSql(
  info: TableInfo,
  dimension: AggregateDimension,
  index: number,
  params: unknown[],
): string {
  const column = requireAggregateColumn(info, dimension.field, "groupBy field");
  if (!("bucket" in dimension)) return `${column} AS k${index}`;
  if (!AGGREGATE_BUCKET_UNITS.includes(dimension.bucket)) {
    throw new Error(`aggregateWhere: unknown bucket "${String(dimension.bucket)}"`);
  }
  if (!isTimestamptzType(info.pgTypeOf(info.columnOf(dimension.field)))) {
    throw new Error(`aggregateWhere: bucket on "${dimension.field}" requires a timestamptz column`);
  }
  params.push(dimension.timeZone);
  return `(EXTRACT(EPOCH FROM date_trunc('${dimension.bucket}', ${column}, $${params.length}::text)) * 1000)::float8 AS k${index}`;
}

export function assertValidAggregateLimits(spec: AggregateSpec): void {
  if (spec.limit !== undefined && (!Number.isInteger(spec.limit) || spec.limit < 0)) {
    throw new Error(`aggregateWhere: limit must be a non-negative integer, got ${spec.limit}`);
  }
  if (spec.orderByValue !== undefined && !AGGREGATE_ORDER_DIRECTIONS.includes(spec.orderByValue)) {
    throw new Error(`aggregateWhere: unknown orderByValue "${String(spec.orderByValue)}"`);
  }
  if (spec.orderByKeys !== undefined && !AGGREGATE_ORDER_DIRECTIONS.includes(spec.orderByKeys)) {
    throw new Error(`aggregateWhere: unknown orderByKeys "${String(spec.orderByKeys)}"`);
  }
}

export function aggregateGroupOrderLimitSql(spec: AggregateSpec, dimensionCount: number): string {
  let sqlText = "";
  if (dimensionCount > 0) {
    const positions = Array.from({ length: dimensionCount }, (_, index) => String(index + 1));
    sqlText += ` GROUP BY ${positions.join(", ")}`;
    const keyDirection = spec.orderByKeys === "desc" ? "DESC" : "ASC";
    const keyParts = positions.map((position) => `${position} ${keyDirection}`);
    const orderParts =
      spec.orderByValue === undefined
        ? keyParts
        : [`${dimensionCount + 1} ${spec.orderByValue === "desc" ? "DESC" : "ASC"}`, ...keyParts];
    sqlText += ` ORDER BY ${orderParts.join(", ")}`;
  }
  if (spec.limit !== undefined) sqlText += ` LIMIT ${spec.limit}`;
  return sqlText;
}
