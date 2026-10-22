import type {
  AggregateDimension,
  AggregateKey,
  AggregateSpec,
  AggregateTimeBucket,
} from "@cosmicdrift/kumiko-types/aggregate-types";
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

export function aggregateMeasureSql(info: TableInfo, measure: AggregateSpec["measure"]): string {
  switch (measure.fn) {
    case "count":
      return "COUNT(*)";
    case "countDistinct":
      return `COUNT(DISTINCT ${requireAggregateColumn(info, measure.field, "measure field")})`;
    case "sum":
      return `COALESCE(SUM(${requireAggregateColumn(info, measure.field, "measure field")}), 0)`;
    case "avg":
      return `AVG(${requireAggregateColumn(info, measure.field, "measure field")})`;
    default:
      throw new Error(`aggregateWhere: unknown measure fn "${String(Reflect.get(measure, "fn"))}"`);
  }
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
