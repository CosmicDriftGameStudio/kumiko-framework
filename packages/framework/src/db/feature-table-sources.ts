// Single enumeration of every table-bearing registration on a feature
// (r.projection, r.multiStreamProjection with table, r.rawTable). Consumed
// by BOTH the setupTestStack auto-push and collectTableMetas — one list, so
// test-DB-push and `kumiko schema generate` cannot drift apart again (#255).
// A new table-bearing registrar must be added HERE, not in the consumers.

import type { FeatureDefinition } from "../engine/types";

export type FeatureTableSource = {
  readonly table: unknown;
  // Stable human-readable label, unique across features — used as push-key
  // and in error messages.
  readonly origin: string;
};

export function enumerateFeatureTableSources(
  feature: FeatureDefinition,
): readonly FeatureTableSource[] {
  const sources: FeatureTableSource[] = [];
  for (const [name, proj] of Object.entries(feature.projections)) {
    sources.push({ table: proj.table, origin: `projection "${name}" (${feature.name})` });
  }
  for (const [name, msp] of Object.entries(feature.multiStreamProjections)) {
    // table omitted = side-effect-only MSP, materialises nothing.
    if (!msp.table) continue;
    sources.push({
      table: msp.table,
      origin: `multiStreamProjection "${name}" (${feature.name})`,
    });
  }
  for (const [name, raw] of Object.entries(feature.rawTables)) {
    sources.push({ table: raw.table, origin: `rawTable "${name}" (${feature.name})` });
  }
  return sources;
}
