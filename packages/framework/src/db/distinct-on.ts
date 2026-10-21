import type { OrderByClause } from "@cosmicdrift/kumiko-types/where-clause-types";
import type { TableInfo } from "./query.ts";

type DistinctOnClause = {
  /** Physical column names, unquoted. */
  readonly columns: readonly string[];
  readonly orderBy: readonly OrderByClause[];
};

// Postgres rejects DISTINCT ON unless ORDER BY starts with the same
// expressions, so a mismatch is caught here with a readable message instead of
// surfacing as a driver error.
export function buildDistinctOnClause(
  info: TableInfo,
  distinctOn: readonly string[] | undefined,
  orderBy: OrderByClause | readonly OrderByClause[] | undefined,
): DistinctOnClause | undefined {
  if (distinctOn === undefined) return undefined;
  if (distinctOn.length === 0) {
    throw new Error(`selectMany: distinctOn must not be empty for "${info.name}"`);
  }
  for (const field of distinctOn) {
    if (!info.hasColumn(field)) {
      throw new Error(`selectMany: distinctOn entry "${field}" is not a column of "${info.name}"`);
    }
  }
  const columns = distinctOn.map((field) => info.columnOf(field));
  if (orderBy === undefined) {
    return { columns, orderBy: distinctOn.map((col) => ({ col })) };
  }
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  const startsWithDistinctOn = columns.every((column, i) => {
    const clause = clauses[i];
    return (
      clause !== undefined && info.hasColumn(clause.col) && info.columnOf(clause.col) === column
    );
  });
  if (!startsWithDistinctOn) {
    throw new Error(
      `selectMany: orderBy must start with the distinctOn fields [${distinctOn.join(", ")}] in the same order for "${info.name}"`,
    );
  }
  return { columns, orderBy: clauses };
}
