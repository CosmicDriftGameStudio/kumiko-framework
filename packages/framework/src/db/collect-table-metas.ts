// collectTableMetas — kanonische ENTITY_METAS-Quelle für `kumiko schema
// generate`. Erfasst dieselben Tabellen-Quellen wie der setupTestStack-
// auto-push (entities, unmanagedTables, projections, multiStreamProjections,
// rawTables) — die frühere Template-Variante sammelte nur entities +
// unmanagedTables, wodurch projection-only-Tabellen (z.B. billing-foundation
// read_subscriptions) nie in Migrations landeten und der erste Prod-Write
// crashte (#255).

import type { FeatureDefinition } from "../engine/types";
import { compareByCodepoint } from "../utils";
import {
  assertBackingTableSuperset,
  buildEntityTableMeta,
  type EntityTableMeta,
} from "./entity-table-meta";
import { enumerateFeatureTableSources } from "./feature-table-sources";
import { asEntityTableMeta } from "./query";

function canonicalColumnsKey(meta: EntityTableMeta): string {
  // Spalten-Identität unabhängig von Deklarations-Reihenfolge und
  // Objekt-Key-Order. Indexes bleiben außen vor: eine Projection-Table
  // (buildEntityTable ohne relations) trägt legitim weniger FK-Indexes
  // als das Entity-Meta derselben Tabelle.
  return [...meta.columns]
    .sort((a, b) => compareByCodepoint(a.name, b.name))
    .map(
      (c) =>
        `${c.name}|${c.pgType}|${c.notNull}|${c.defaultSql ?? ""}|${c.primaryKey ?? false}|${c.identity ?? false}|${c.bigintJsMode ?? ""}`,
    )
    .join("\n");
}

export function collectTableMetas(
  features: readonly FeatureDefinition[],
): readonly EntityTableMeta[] {
  const metas: EntityTableMeta[] = [];
  const byName = new Map<string, { meta: EntityTableMeta; origin: string }>();

  // Pass 1: kanonische Schema-Quellen, identisch zum bisherigen Template-
  // Verhalten (gleiche Reihenfolge, gleiche buildEntityTableMeta-Optionen).
  for (const feature of features) {
    for (const [name, ent] of Object.entries(feature.entities ?? {})) {
      const fieldMeta = buildEntityTableMeta(name, ent, { relations: feature.relations[name] });
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
      metas.push(meta);
      byName.set(meta.tableName, { meta, origin: `entity "${name}" (${feature.name})` });
    }
    for (const entry of Object.values(feature.unmanagedTables)) {
      metas.push(entry.meta);
      byName.set(entry.meta.tableName, {
        meta: entry.meta,
        origin: `unmanagedTable "${entry.name}" (${feature.name})`,
      });
    }
  }

  // Pass 2: table-tragende Registrierungen. Zwei Pässe, damit eine Entity-
  // Tabelle aus Feature B gegen eine gleichnamige Projection-Table aus
  // Feature A gewinnt — Entity-Metas sind die reichere Quelle (FK-Indexes
  // aus relations).
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
