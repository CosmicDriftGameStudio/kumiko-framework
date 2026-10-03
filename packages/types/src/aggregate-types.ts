export type AggregateMeasure =
  | { readonly fn: "count" }
  | { readonly fn: "countDistinct" | "sum" | "avg"; readonly field: string };

export type AggregateTimeBucket = "hour" | "day";

export type AggregateDimension =
  | { readonly field: string }
  | {
      readonly field: string;
      readonly bucket: AggregateTimeBucket;
      readonly timeZone: string;
    };

export type AggregateSpec = {
  readonly measure: AggregateMeasure;
  readonly groupBy?: readonly AggregateDimension[];
  readonly orderByValue?: "asc" | "desc";
  /** Direction of the group-key ordering (default asc). orderByValue stays the primary key when set. */
  readonly orderByKeys?: "asc" | "desc";
  readonly limit?: number;
};

export type AggregateKey = string | number | boolean | null;

export type AggregateRow = {
  readonly keys: readonly AggregateKey[];
  readonly value: number | null;
};
