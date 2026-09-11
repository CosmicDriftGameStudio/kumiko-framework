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
import { isSelfPiiField } from "../crypto/is-self-pii-field";
import type { SubjectId } from "../crypto/kms-adapter";
import { collectSearchableSubjectFields } from "../crypto/subject-resolver";
import type { DbRunner } from "../db/connection";
import { resolveTableName } from "../db/entity-table-meta";
import { executeRawQueryRead } from "../db/queries/raw-sql";
import { tableExists } from "../db/schema-inspection";
import type { FeatureDefinition } from "../engine/types";
import type { EntityDefinition } from "../engine/types/fields";
import type { EntityId, TenantId } from "../engine/types/identifiers";
import { toSnakeCase } from "../utils/case";
import type { SearchAdapter } from "./types";

function finalizePredicateParts(
  parts: readonly string[],
  params: readonly unknown[],
): { sql: string; params: unknown[] } | null {
  if (parts.length === 0) return null;
  return { sql: parts.join(" OR "), params: [...params] };
}

function userOwnershipPredicates(
  entity: EntityDefinition,
  searchableFields: readonly string[],
  userId: string,
  nextParam: () => number,
): { sql: string; params: unknown[] } | null {
  const parts: string[] = [];
  const params: unknown[] = [];
  let selfIdN: number | undefined;
  const ownerFieldN = new Map<string, number>();

  for (const fieldName of searchableFields) {
    const field = entity.fields[fieldName];
    if (!field) continue;
    if ("userOwned" in field && field.userOwned !== undefined) {
      const col = toSnakeCase(field.userOwned.ownerField);
      let n = ownerFieldN.get(col);
      if (n === undefined) {
        n = nextParam();
        ownerFieldN.set(col, n);
        params.push(userId);
        parts.push(`${quoteIdent(col)} = $${n}`);
      }
    } else if (isSelfPiiField(field) && selfIdN === undefined) {
      selfIdN = nextParam();
      params.push(userId);
      parts.push(`${quoteIdent("id")} = $${selfIdN}`);
    }
  }
  return finalizePredicateParts(parts, params);
}

function tenantOwnershipPredicates(
  entity: EntityDefinition,
  searchableFields: readonly string[],
  tenantId: string,
  nextParam: () => number,
): { sql: string; params: unknown[] } | null {
  const parts: string[] = [];
  const params: unknown[] = [];
  let tenantIdN: number | undefined;

  for (const fieldName of searchableFields) {
    const field = entity.fields[fieldName];
    if (!field) continue;
    if ("tenantOwned" in field && field.tenantOwned === true && tenantIdN === undefined) {
      tenantIdN = nextParam();
      params.push(tenantId);
      parts.push(`${quoteIdent("tenant_id")} = $${tenantIdN}`);
    }
  }
  return finalizePredicateParts(parts, params);
}

function recordOwnershipPredicates(
  entity: EntityDefinition,
  searchableFields: readonly string[],
  entityName: string,
  subjectEntity: string,
  subjectId: string,
  nextParam: () => number,
): { sql: string; params: unknown[] } | null {
  const parts: string[] = [];
  const params: unknown[] = [];
  let recordIdN: number | undefined;

  for (const fieldName of searchableFields) {
    const field = entity.fields[fieldName];
    if (!field) continue;
    const isMatchingRecordField =
      entityName === subjectEntity && "recordOwned" in field && field.recordOwned === true;
    if (isMatchingRecordField && recordIdN === undefined) {
      recordIdN = nextParam();
      params.push(subjectId);
      parts.push(`${quoteIdent("id")} = $${recordIdN}`);
    }
  }
  return finalizePredicateParts(parts, params);
}

/** Build OR predicates for rows owned by `subject` (id / ownerField / tenant_id). */
function ownershipPredicates(
  entity: EntityDefinition,
  searchableFields: readonly string[],
  entityName: string,
  subject: SubjectId,
  nextParam: () => number,
): { sql: string; params: unknown[] } | null {
  switch (subject.kind) {
    case "user":
      return userOwnershipPredicates(entity, searchableFields, subject.userId, nextParam);
    case "tenant":
      return tenantOwnershipPredicates(entity, searchableFields, subject.tenantId, nextParam);
    case "record":
      return recordOwnershipPredicates(
        entity,
        searchableFields,
        entityName,
        subject.entity,
        subject.id,
        nextParam,
      );
    default: {
      const exhaustiveCheck: never = subject;
      throw new Error(`Unhandled subject kind: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

type MatchedRow = { id: string; tenant_id: string };

// ponytail: LIMIT/OFFSET, not a keyset cursor — mirrors reindexEntity's same
// tradeoff (id type varies uuid/serial across entities). A tenant-destroy
// purge is a one-time sweep, not a hot path.
const PURGE_BATCH_SIZE = 500;

async function collectMatchingRowsForEntity(
  db: DbRunner,
  tableName: string,
  whereSql: string,
  params: readonly unknown[],
): Promise<readonly MatchedRow[]> {
  const rows: MatchedRow[] = [];
  let offset = 0;
  for (;;) {
    const offsetN = params.length + 1;
    const page = await executeRawQueryRead<MatchedRow>(
      db,
      `SELECT id, tenant_id FROM ${quoteIdent(tableName)} WHERE ${whereSql}
        ORDER BY ${quoteIdent("id")} ASC
        LIMIT ${PURGE_BATCH_SIZE} OFFSET $${offsetN}`,
      [...params, offset],
    );
    if (page.length === 0) break;
    rows.push(...page);
    offset += page.length;
    if (page.length < PURGE_BATCH_SIZE) break;
  }
  return rows;
}

function buildSubjectPredicate(
  entity: EntityDefinition,
  fields: readonly string[],
  likePattern: string,
  entityName: string,
  subject: SubjectId | undefined,
): { sql: string; params: unknown[] } {
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
    const owned = ownershipPredicates(entity, fields, entityName, subject, nextParam);
    if (owned) {
      params.push(...owned.params);
      orParts.push(`(${owned.sql})`);
    }
  }

  return { sql: orParts.join(" OR "), params };
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
      // Same post-eraseKey hazard as nullBlindIndexesForSubject (fw#2550):
      // a mounted feature without its migration must not abort the purge
      // (and the audit event after it).
      if (!(await tableExists(db, tableName))) continue;
      const predicate = buildSubjectPredicate(entity, fields, likePattern, entityName, subject);
      const rows = await collectMatchingRowsForEntity(
        db,
        tableName,
        predicate.sql,
        predicate.params,
      );
      for (const row of rows) {
        const key = `${row.tenant_id}:${entityName}:${row.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
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
