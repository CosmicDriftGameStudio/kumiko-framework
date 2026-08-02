// Purge derived search documents for an erased PII subject (#1610).
//
// After kms.eraseKey the projection/event ciphertext is unreadable, but Meili
// still holds the plaintext that createSearchEventConsumer decrypted into the
// index. Discovery is dual-path:
//   1. Ownership: pii self-id / userOwned.ownerField / tenantOwned.tenantId
//      (survives anonymize hooks that overwrite ciphertext with plaintext).
//   2. Ciphertext LIKE prefix (same as nullBlindIndexesForSubject) for rows
//      that still carry the subject key in encrypted columns.

import { quoteIdent, subjectCiphertextLikePattern } from "../crypto/ciphertext-pattern";
import type { SubjectId } from "../crypto/kms-adapter";
import { collectSearchableSubjectFields } from "../crypto/subject-resolver";
import type { DbRunner } from "../db/connection";
import { resolveTableName } from "../db/entity-table-meta";
import { executeRawQuery } from "../db/queries/raw-sql";
import type { FeatureDefinition } from "../engine/types";
import type { EntityDefinition } from "../engine/types/fields";
import type { EntityId, TenantId } from "../engine/types/identifiers";
import { toSnakeCase } from "../utils/case";
import type { SearchAdapter } from "./types";

/** Build OR predicates for rows owned by `subject` (id / ownerField / tenant_id). */
function ownershipPredicates(
  entity: EntityDefinition,
  searchableFields: readonly string[],
  subject: SubjectId,
  nextParam: () => number,
): { sql: string; params: unknown[] } | null {
  const parts: string[] = [];
  const params: unknown[] = [];
  let selfIdN: number | undefined;
  let tenantIdN: number | undefined;
  const ownerFieldN = new Map<string, number>();

  for (const fieldName of searchableFields) {
    const field = entity.fields[fieldName];
    if (!field) continue;
    if (subject.kind === "user") {
      if ("userOwned" in field && field.userOwned !== undefined) {
        const col = toSnakeCase(field.userOwned.ownerField);
        let n = ownerFieldN.get(col);
        if (n === undefined) {
          n = nextParam();
          ownerFieldN.set(col, n);
          params.push(subject.userId);
          parts.push(`${quoteIdent(col)} = $${n}`);
        }
      } else if ("pii" in field && field.pii === true && selfIdN === undefined) {
        selfIdN = nextParam();
        params.push(subject.userId);
        parts.push(`${quoteIdent("id")} = $${selfIdN}`);
      }
    } else if ("tenantOwned" in field && field.tenantOwned === true && tenantIdN === undefined) {
      tenantIdN = nextParam();
      params.push(subject.tenantId);
      parts.push(`${quoteIdent("tenant_id")} = $${tenantIdN}`);
    }
  }
  if (parts.length === 0) return null;
  return { sql: parts.join(" OR "), params };
}

export async function purgeSearchDocumentsForSubject(
  db: DbRunner,
  features: ReadonlyMap<string, FeatureDefinition>,
  search: SearchAdapter,
  subjectKey: string,
  /** When set, also match rows by ownership — needed after anonymize rewrites ciphertext. */
  subject?: SubjectId,
): Promise<void> {
  const likePattern = subjectCiphertextLikePattern(subjectKey);
  const byTenant = new Map<string, { entityType: string; entityId: EntityId }[]>();
  const seen = new Set<string>();

  for (const feature of features.values()) {
    for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
      const fields = collectSearchableSubjectFields(entity);
      if (fields.length === 0) continue;
      const tableName = resolveTableName(entityName, entity, undefined);

      let paramIdx = 0;
      const nextParam = () => ++paramIdx;
      const params: unknown[] = [];
      const orParts: string[] = [];

      const likeN = nextParam();
      params.push(likePattern);
      orParts.push(
        `(${fields.map((f) => `${quoteIdent(toSnakeCase(f))} LIKE $${likeN}`).join(" OR ")})`,
      );

      if (subject) {
        const owned = ownershipPredicates(entity, fields, subject, nextParam);
        if (owned) {
          params.push(...owned.params);
          orParts.push(`(${owned.sql})`);
        }
      }

      // ponytail: LIMIT/OFFSET, not a keyset cursor — mirrors reindexEntity's
      // same tradeoff (id type varies uuid/serial across entities). A
      // tenant-destroy purge is a one-time sweep, not a hot path.
      const batchSize = 500;
      const whereSql = orParts.join(" OR ");
      let offset = 0;
      for (;;) {
        const offsetN = params.length + 1;
        const rows = await executeRawQuery<{ id: string; tenant_id: string }>(
          db,
          `SELECT id, tenant_id FROM ${quoteIdent(tableName)} WHERE ${whereSql}
            ORDER BY ${quoteIdent("id")} ASC
            LIMIT ${batchSize} OFFSET $${offsetN}`,
          [...params, offset],
        );
        if (rows.length === 0) break;
        for (const row of rows) {
          const key = `${row.tenant_id}:${entityName}:${row.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const list = byTenant.get(row.tenant_id) ?? [];
          list.push({ entityType: entityName, entityId: row.id as EntityId });
          byTenant.set(row.tenant_id, list);
        }
        offset += rows.length;
        if (rows.length < batchSize) break;
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
