import type { EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import type {
  AggregateMeasure,
  AggregateTimeBucket,
} from "@cosmicdrift/kumiko-types/aggregate-types";
import type { SchemaTable } from "@cosmicdrift/kumiko-types/schema-table-types";
import type { WhereObject } from "@cosmicdrift/kumiko-types/where-clause-types";
import type { Temporal } from "temporal-polyfill";
import type { MetricRange, MetricScope } from "./constants.js";

export type MetricDefinition = {
  readonly id: string;
  readonly description: string;
  readonly source: SchemaTable | EntityTableMeta;
  /** Feature that owns the source table; becomes `r.requires(...)`. */
  readonly requires?: string;
  readonly measure: AggregateMeasure;
  readonly where?: WhereObject;
  /** timestamptz column; without it the metric is a snapshot with no window. */
  readonly timeField?: string;
  /** Fixed window, ignores the payload range. */
  readonly window?: MetricRange;
  /** "auto": 24h → hour, otherwise day. */
  readonly bucket?: AggregateTimeBucket | "auto";
  /** Default true; false skips the previous-period query (no delta), for measures the previous window cannot answer, e.g. overwritten lastSeenAt. */
  readonly comparePrevious?: boolean;
  readonly groupBy?: string;
  /** Second dimension, becomes `rows[].segments`; only without bucket. */
  readonly stackBy?: string;
  /** Key value → i18n key, applied to groupBy and stackBy keys. */
  readonly groupLabels?: Readonly<Record<string, string>>;
  readonly scopes: readonly MetricScope[];
};

export function defineMetric(definition: MetricDefinition): MetricDefinition {
  return definition;
}

export type MetricPoint = { readonly atMs: number; readonly value: number | null };

export type MetricSeries = {
  readonly key: string;
  readonly label: string;
  readonly points: readonly MetricPoint[];
};

export type MetricSegment = {
  readonly key: string;
  readonly label: string;
  readonly value: number;
};

export type MetricRow = {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly fraction: number;
  readonly segments?: readonly MetricSegment[];
};

export type MetricDeltaDirection = "up" | "down";

export type MetricResult = {
  readonly value: number | null;
  readonly previousValue: number | null;
  readonly delta: string | null;
  readonly deltaDirection: MetricDeltaDirection | null;
  readonly windowStartMs: number | null;
  readonly windowEndMs: number | null;
  readonly points: readonly MetricPoint[];
  readonly series: readonly MetricSeries[];
  readonly rows: readonly MetricRow[];
  readonly nextCursor: null;
};

export type MetricsFeatureOptions = {
  readonly metrics: readonly MetricDefinition[];
  /** Fixed clock for deterministic tests. */
  readonly now?: () => Temporal.Instant;
};
