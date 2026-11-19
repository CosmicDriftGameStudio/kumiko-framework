import type { WhereObject } from "@cosmicdrift/kumiko-types/where-clause-types";
import type { TableLike } from "./query.ts";

export type JoinColumnPair = { readonly left: string; readonly right: string };

export type InnerJoinSpec = {
  readonly left: TableLike;
  readonly right: TableLike;
  readonly on: readonly [JoinColumnPair, ...JoinColumnPair[]];
  readonly leftWhere?: WhereObject;
  readonly rightWhere?: WhereObject;
  /** Fields to return per side; default: all columns of `left`, none of `right`. */
  readonly leftFields?: readonly string[];
  readonly rightFields?: readonly string[];
  readonly limit?: number;
};

export type InnerJoinRow<TLeft, TRight> = { readonly left: TLeft; readonly right: TRight };
