// Purge derived search documents for an erased PII subject (#1610).
//
// After kms.eraseKey the projection/event ciphertext is unreadable, but Meili
// still holds the plaintext that createSearchEventConsumer decrypted into the
// index. This walk mirrors nullBlindIndexesForSubject: ciphertext embeds the
// subject key, so a LIKE prefix finds every matching row.

import { collectSearchableSubjectFields } from "../crypto/subject-resolver";
import type { DbRunner } from "../db/connection";
import { resolveTableName } from "../db/entity-table-meta";
import { executeRawQuery } from "../db/queries/raw-sql";
import type { FeatureDefinition } from "../engine/types";
import type { EntityId, TenantId } from "../engine/types/identifiers";
import { toSnakeCase } from "../utils/case";
import type { SearchAdapter } from "./types";

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function purgeSearchDocumentsForSubject(
  db: DbRunner,
  features: ReadonlyMap<string, FeatureDefinition>,
  search: SearchAdapter,
  subjectKey: string,
): Promise<void> {
  const likePattern = `kumiko-pii:v%:${escapeLikePattern(subjectKey)}:%`;
  const byTenant = new Map<string, { entityType: string; entityId: EntityId }[]>();

  for (const feature of features.values()) {
    for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
      const fields = collectSearchableSubjectFields(entity);
      if (fields.length === 0) continue;
      const tableName = resolveTableName(entityName, entity, undefined);
      const conditions = fields
        .map((fieldName) => `${quoteIdent(toSnakeCase(fieldName))} LIKE $1`)
        .join(" OR ");
      const rows = await executeRawQuery<{ id: string; tenant_id: string }>(
        db,
        `SELECT id, tenant_id FROM ${quoteIdent(tableName)} WHERE ${conditions}`,
        [likePattern],
      );
      for (const row of rows) {
        const list = byTenant.get(row.tenant_id) ?? [];
        list.push({ entityType: entityName, entityId: row.id as EntityId });
        byTenant.set(row.tenant_id, list);
      }
    }
  }

  for (const [tenantId, items] of byTenant) {
    if (items.length === 0) continue;
    const tid = tenantId as TenantId;
    if (search.removeBatch) {
      await search.removeBatch(tid, items);
    } else {
      for (const item of items) {
        await search.remove(tid, item.entityType, item.entityId);
      }
    }
  }
}
