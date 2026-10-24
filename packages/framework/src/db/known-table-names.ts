import type { FeatureDefinition } from "../engine/types/index.ts";
import { collectTableMetas } from "./collect-table-metas.ts";
import { isRetiredFrameworkTable } from "./retired-framework-tables.ts";

// The prefix only picks which boot-check message a table gets; both groups still throw, and a second
// framework table list would be one more source to maintain.
// Event store and pipeline state (kumiko_events, kumiko_projections, ...) are created by framework
// boot, not by `schema generate`, so no feature declares them.
const FRAMEWORK_TABLE_PREFIX = "kumiko_";

function isLiveFrameworkTable(tableName: string): boolean {
  return tableName.startsWith(FRAMEWORK_TABLE_PREFIX) && !isRetiredFrameworkTable(tableName);
}

export type KnownTables = {
  readonly has: (tableName: string) => boolean;
};

// Same source as `kumiko schema generate`: a tenant table that is not listed here has no owner left.
export function knownTablesOf(features: readonly FeatureDefinition[]): KnownTables {
  // Lazy: a healthy boot finds no unprotected table and never asks, so it skips collecting metas.
  let names: Set<string> | undefined;
  return {
    has: (tableName) => {
      names ??= new Set(collectTableMetas(features).map((meta) => meta.tableName));
      return names.has(tableName) || isLiveFrameworkTable(tableName);
    },
  };
}
