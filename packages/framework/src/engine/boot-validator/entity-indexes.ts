import type { EntityDefinition, EntityIndexDef } from "@cosmicdrift/kumiko-types/fields";
import { rowMetaFieldNames } from "../../db/table-builder.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { ENTITY_STRUCTURE_RULES } from "./entity-structure-rules.ts";

// --- Entity-index validation ---
//
// entity.indexes declares composite/unique indexes over multiple field
// columns. Common errors include misspelled field names, an empty column
// list, and an index on a field for which the DB has no column (file/image
// in the multi-value variant). Catch these at boot, long before drizzle-kit
// fails during the generate run.
//
// A `tenantId`-only index is redundant because buildEntityTable creates
// that index automatically. Composite forms remain allowed
// (`["tenantId", "key"]` is useful); only the tenantId-only single-column
// form is rejected.
//
// Row-meta base columns (insertedAt, modifiedAt, ..., soft-delete columns only on softDelete
// entities) are indexable; both table paths map them to their snake_case column.

function validateIndexColumn(
  where: string,
  col: string,
  entity: EntityDefinition,
  baseColumns: ReadonlySet<string>,
): void {
  if (baseColumns.has(col)) return;
  const fieldNames = Object.keys(entity.fields);
  if (!fieldNames.includes(col)) {
    throw bootRuleError(ENTITY_STRUCTURE_RULES.indexUnknownColumn, {
      message:
        `${where}: column "${col}" does not match any field in the entity. ` +
        `Available fields: ${fieldNames.join(", ")}. ` +
        `Base columns: ${[...baseColumns].join(", ")}.`,
    });
  }
  const field = entity.fields[col];
  if (
    field &&
    (field.type === "files" ||
      field.type === "images" ||
      (field.type === "reference" && field.multiple === true))
  ) {
    throw bootRuleError(ENTITY_STRUCTURE_RULES.indexMultiValueColumn, {
      message:
        `${where}: column "${col}" is a multi-value field (${field.type}) — ` +
        `a jsonb array cannot be indexed as a column. Use a single-value field or remove from the index.`,
    });
  }
  if (field && field.type === "longText") {
    // longText semantically means "potentially-megabytes content" — a
    // BTREE index on a 1-MB column is a performance disaster
    // (PG would need to dereference TOAST pages for every
    // index lookup). This is consistent with the type-level decision
    // that longText has no sortable/searchable/filterable flags. Anyone
    // who truly needs indexing should use `text` with the
    // corresponding scaling trade-offs.
    throw bootRuleError(ENTITY_STRUCTURE_RULES.indexLongTextColumn, {
      message:
        `${where}: column "${col}" is a longText field — these cannot be indexed. ` +
        `Use \`text\` if you need indexing, or rely on the SearchAdapter (Meilisearch) for full-text search on long content.`,
    });
  }
}

function validateUniqueIndexNotEncrypted(
  where: string,
  def: EntityIndexDef,
  entity: EntityDefinition,
): void {
  // AES-GCM's random-IV ciphertext is never equal to itself across two
  // writes of the same plaintext, so a unique index on an encrypted
  // column can never detect a real duplicate.
  if (!def.unique) return;
  for (const col of def.columns) {
    const field = entity.fields[col];
    if (field && (field.type === "text" || field.type === "longText") && field.encrypted) {
      throw bootRuleError(ENTITY_STRUCTURE_RULES.indexUniqueEncryptedColumn, {
        message:
          `${where}: column "${col}" is encrypted — a unique index on it can never detect ` +
          `duplicates (non-deterministic ciphertext). Remove \`unique\` or \`encrypted\`.`,
      });
    }
  }
}

function validateSingleEntityIndex(
  where: string,
  def: EntityIndexDef,
  entity: EntityDefinition,
  baseColumns: ReadonlySet<string>,
): void {
  if (def.columns.length === 0) {
    throw bootRuleError(ENTITY_STRUCTURE_RULES.indexColumnsEmpty, {
      message: `${where}: empty columns list. An index needs at least one column.`,
    });
  }
  for (const col of def.columns) {
    validateIndexColumn(where, col, entity, baseColumns);
  }
  // A UNIQUE constraint on tenantId is semantically meaningful (1:1 tenant→entity)
  // and NOT redundant — buildEntityTable's automatic index is only a
  // performance hint, not a constraint. Only the tenantId-only,
  // single-column, non-unique form is rejected.
  if (def.columns.length === 1 && def.columns[0] === "tenantId" && !def.unique) {
    throw bootRuleError(ENTITY_STRUCTURE_RULES.indexTenantIdOnly, {
      message:
        `${where}: single-column index on "tenantId" is redundant — ` +
        `buildEntityTable always creates one automatically. Remove this entry.`,
    });
  }
  validateUniqueIndexNotEncrypted(where, def, entity);
}

export function validateEntityIndexes(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    if (!entity.indexes) continue;
    const baseColumns = rowMetaFieldNames(entity.softDelete === true);
    for (const [idx, def] of entity.indexes.entries()) {
      const where = `Feature "${feature.name}", entity "${entityName}", indexes[${idx}]`;
      validateSingleEntityIndex(where, def, entity, baseColumns);
    }
  }
}
