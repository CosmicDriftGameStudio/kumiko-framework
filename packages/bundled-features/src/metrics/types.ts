import type { EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type {
  AggregateMeasure,
  AggregateTimeBucket,
} from "@cosmicdrift/kumiko-types/aggregate-types";
import type { SchemaTable } from "@cosmicdrift/kumiko-types/schema-table-types";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { WhereObject } from "@cosmicdrift/kumiko-types/where-clause-types";
import type { MetricRange, MetricScope } from "./constants.js";

/** Maps a payload value (e.g. a folder id) to the values `column` may have (e.g. the folder and its subfolders' loan ids). Runs with the tenant handler context, so reads stay tenant-scoped; the result only narrows. An empty result yields no rows. */
export type MetricFilterResolver = {
  readonly column: string;
  readonly resolve: (
    value: string | number,
    ctx: HandlerContext,
  ) => Promise<readonly (string | number)[]>;
  /** Type of the payload value, not of `column`. Default "string". */
  readonly valueKind?: "uuid" | "number" | "string";
};

export type MetricDefinition = {
  readonly id: string;
  readonly description: string;
  readonly source: SchemaTable | EntityTableMeta;
  /** Feature that owns the source table; becomes `r.requires(...)`. */
  readonly requires?: string;
  readonly measure: AggregateMeasure;
  readonly where?: WhereObject;
  /** Payload key → source column (equality) or a resolver (IN). e.g. `{ folderId: "folderId" }`. Narrows the result only; the tenant scope is always applied on top and never replaced. Resolvers need a metric without scope "system". */
  readonly filters?: Readonly<Record<string, string | MetricFilterResolver>>;
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
