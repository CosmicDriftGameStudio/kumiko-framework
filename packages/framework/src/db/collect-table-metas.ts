// Canonical table source for both `kumiko schema generate` and setupTestStack
// (entities, storeTables, projections, multiStreamProjections). One shared
// source so the test-DB push and migrations cannot drift apart again.

import type { FeatureDefinition } from "../engine/types/index.ts";
import { compareByCodepoint } from "../utils/index.ts";
import {
  assertBackingTableSuperset,
  deriveEntityTableMeta,
  type EntityTableMeta,
} from "./entity-table-meta.ts";
import { enumerateFeatureTableSources } from "./feature-table-sources.ts";
import { asEntityTableMeta } from "./query.ts";

function canonicalColumnsKey(meta: EntityTableMeta): string {
  // Column identity independent of declaration order and object-key order.
  // Indexes are excluded: a projection table (buildEntityTable without relations)
  // legitimately has fewer FK indexes than the entity metadata for the same table.
  return [...meta.columns]
    .sort((a, b) => compareByCodepoint(a.name, b.name))
    .map(
      (c) =>
        `${c.name}|${c.pgType}|${c.notNull}|${c.defaultSql ?? ""}|${c.primaryKey ?? false}|${c.identity ?? false}|${c.bigintJsMode ?? ""}`,
    )
    .join("\n");
}

function registerPass1Meta(
  metas: EntityTableMeta[],
  byName: Map<string, { meta: EntityTableMeta; origin: string }>,
  meta: EntityTableMeta,
  origin: string,
): void {
  const existing = byName.get(meta.tableName);
  if (existing) {
    throw new Error(
      `collectTableMetas: table "${meta.tableName}" is registered by ${origin} and ${existing.origin}. ` +
        "Give one of them a different table name.",
    );
  }
  metas.push(meta);
  byName.set(meta.tableName, { meta, origin });
}

export function collectTableMetas(
  features: readonly FeatureDefinition[],
): readonly EntityTableMeta[] {
  const metas: EntityTableMeta[] = [];
  const byName = new Map<string, { meta: EntityTableMeta; origin: string }>();

  // Pass 1: canonical schema sources, matching the previous template behavior
  // (same order, same deriveEntityTableMeta options).
  for (const feature of features) {
    for (const [name, ent] of Object.entries(feature.entities ?? {})) {
      const fieldMeta = deriveEntityTableMeta(name, ent, { relations: feature.relations[name] });
      // Backing table wins: it's the physical DDL truth for ride-along columns/
      // indexes the field-DSL can't express (secrets' envelope). Validated as a
      // superset of the field-derived meta so a field/table disagreement throws.
      const backing = feature.entityTables?.[name];
      let meta = fieldMeta;
      if (backing !== undefined) {
        const tableMeta = asEntityTableMeta(backing);
        if (!tableMeta) {
          throw new Error(
            `collectTableMetas: entity "${name}" (${feature.name}) declares a backing ` +
              "table that carries no EntityTableMeta — build it via table() / buildEntityTable.",
          );
        }
        assertBackingTableSuperset(name, fieldMeta, tableMeta);
        meta = tableMeta;
      }
      registerPass1Meta(metas, byName, meta, `entity "${name}" (${feature.name})`);
    }
    for (const entry of Object.values(feature.storeTables)) {
      registerPass1Meta(metas, byName, entry.meta, `storeTable "${entry.name}" (${feature.name})`);
    }
  }

  // Pass 2: table-bearing registrations. Two passes ensure that an entity table
  // from Feature B takes precedence over a same-named projection table from
  // Feature A—entity metadata is the richer source because of FK indexes from
  // relations.
  for (const feature of features) {
    for (const { table, origin } of enumerateFeatureTableSources(feature)) {
      const meta = asEntityTableMeta(table);
      if (!meta) {
        throw new Error(
          `collectTableMetas: ${origin} carries no EntityTableMeta — ` +
            "build the table via table() / buildEntityTable / defineUnmanagedTable.",
        );
      }
      const existing = byName.get(meta.tableName);
      if (existing) {
        if (canonicalColumnsKey(existing.meta) !== canonicalColumnsKey(meta)) {
          throw new Error(
            `collectTableMetas: table "${meta.tableName}" is declared with diverging ` +
              `columns by ${origin} and ${existing.origin}. Align the column ` +
              "definitions or rename one of the tables.",
          );
        }
        continue;
      }
      metas.push(meta);
      byName.set(meta.tableName, { meta, origin });
    }
  }

  return metas;
}
