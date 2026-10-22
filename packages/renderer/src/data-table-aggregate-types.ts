import type { AggregateKey } from "@cosmicdrift/kumiko-types/aggregate-types";
import type {
  ListAggregateMeasureKind,
  ListAggregateValue,
} from "@cosmicdrift/kumiko-types/list-aggregate-types";

/** One server-computed measure; a money measure holds one minor-unit value per currency. */
export type DataTableMeasure = {
  readonly field: string;
  readonly kind: ListAggregateMeasureKind;
  readonly value: ListAggregateValue;
};

export type DataTableServerGroup = {
  /** `relatedListGroupKey` of the group value; stable across reloads. */
  readonly key: string;
  /** Raw group value, rendered through the group column when `label` is absent. */
  readonly value: AggregateKey;
  readonly label?: string;
  /** Rows of the whole group on the server, not the loaded ones. */
  readonly count: number;
  readonly measures: readonly DataTableMeasure[];
  readonly collapsed: boolean;
  /** How many of the table's `rows` belong to this group; rows arrive in group order. */
  readonly rowCount: number;
  readonly hasMore: boolean;
  readonly loading: boolean;
};

/** Server-side grouping: groups are the load unit, each loads its own rows. */
export type DataTableServerGroups = {
  readonly field: string;
  readonly groups: readonly DataTableServerGroup[];
  readonly totalCount: number;
  readonly onToggle: (key: string) => void;
  readonly onLoadMore: (key: string) => void;
  readonly onHeaderVisible: (key: string) => void;
};

export type DataTableTotals = {
  readonly measures: readonly DataTableMeasure[];
};

/** `truncated`: more groups than the server answers. `searchTruncated`: the search hit its cap. */
export type DataTableListNotice = "truncated" | "searchTruncated";

export type DataTableRangeBound = "min" | "max";

/** "From/to" inputs on a number field. Values are the typed strings, "" = open bound. */
export type DataTableRangeFacet = {
  readonly field: string;
  readonly label: string;
  readonly min: string;
  readonly max: string;
  /** Shown after the inputs, e.g. the money field's currency. */
  readonly unit?: string;
};
