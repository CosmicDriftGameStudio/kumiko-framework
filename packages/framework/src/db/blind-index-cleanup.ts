// Immediate blind-index nulling after a subject erase (#818).
//
// After kms.eraseKey the ciphertext is unreadable, but the deterministic
// bidx column would stay matchable until the next write/rebuild — a
// linkage window ("does any row hold value X"). This sweep closes it right
// away: the ciphertext names its subject inline
// (kumiko-pii:v1:<subjectKey>:...), so a LIKE-prefix match finds exactly
// the erased subject's rows — one UPDATE per lookupable field.
//
// Rows the forget run deletes/anonymizes via the executor anyway get their
// bidx recomputed automatically there; this sweep covers the rows left
// behind (foreign entities with userOwned fields).

import { collectLookupableFields } from "../crypto/blind-index";
import { quoteIdent, subjectCiphertextLikePattern } from "../crypto/ciphertext-pattern";
import { isSelfPiiField } from "../crypto/is-self-pii-field";
import type { FeatureDefinition } from "../engine/types";
import { toSnakeCase } from "../utils/case";
import type { DbRunner } from "./connection";
import { resolveTableName } from "./entity-table-meta";
import { executeRawQuery, executeRawQueryRead } from "./queries/raw-sql";
import { tableExists } from "./schema-inspection";

export async function nullBlindIndexesForSubject(
  db: DbRunner,
  features: ReadonlyMap<string, FeatureDefinition>,
  subjectKey: string,
): Promise<void> {
  const likePattern = subjectCiphertextLikePattern(subjectKey);
  for (const feature of features.values()) {
    for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
      const lookupable = collectLookupableFields(entity);
      if (lookupable.length === 0) continue;
      // No featureName prefix — the dispatcher builds entity tables without
      // one (buildEntityTable with no featureName option), the sweep has to
      // hit the same names.
      const tableName = resolveTableName(entityName, entity, undefined);
      // Skip entities whose projection was never migrated — same class as
      // subjectRowExistsInTenant (fw#2348). A throw here runs AFTER eraseKey
      // in forget-subject and would leave deterministic bidx columns still
      // linkable (fw#2550).
      if (!(await tableExists(db, tableName))) continue;
      for (const fieldName of lookupable) {
        const snake = toSnakeCase(fieldName);
        await executeRawQuery(
          db,
          `UPDATE ${quoteIdent(tableName)} SET ${quoteIdent(`${snake}_bidx`)} = NULL WHERE ${quoteIdent(snake)} LIKE $1`,
          [likePattern],
        );
      }
    }
  }
}

// Tenant-scope oracle for crypto-shredding's forget-subject (mh#349): a
// "user"-kind subject id is often not a real user (share-token recipient,
// email subscriber, ...) — those entities self-own their PII (`pii: true`,
// i.e. their own row id IS the subject) and carry a real tenant_id,
// unlike read_users (systemStream, tenant_id always SYSTEM_TENANT_ID). This
// checks whether the subject row lives in the given tenant, so a tenant-
// scoped DPO can still forget subjects it truly owns without needing a
// tenant-membership row (which only exists for real users).
//
// Invariant: `id` must never be client-settable on self-PII entities — the
// framework create path strips client ids; app write paths MUST do the same
// or a DPO could plant a foreign subject id in their tenant and pass this
// oracle (#2348). Upgrade path: require an event-store provenance check
// (`aggregate_id = subjectId` under the actor tenant) when apps need
// client-supplied ids.
export async function subjectRowExistsInTenant(
  db: DbRunner,
  features: ReadonlyMap<string, FeatureDefinition>,
  subjectId: string,
  tenantId: string,
): Promise<boolean> {
  // Prefetch which self-PII projection tables actually exist — probing a
  // missing relation used to throw (and get swallowed), which both hid
  // real schema bugs and risked poisoning the Bun.SQL connection for the
  // rest of the forget TX (fw#2348 / framework#356).
  const candidateTables: string[] = [];
  for (const feature of features.values()) {
    for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
      const hasSelfPiiField = Object.values(entity.fields).some(isSelfPiiField);
      if (!hasSelfPiiField) continue;
      candidateTables.push(resolveTableName(entityName, entity, undefined));
    }
  }
  const existing = new Set<string>();
  for (const tableName of candidateTables) {
    const rows = await executeRawQueryRead<{ exists: boolean }>(
      db,
      `SELECT to_regclass(quote_ident($1)) IS NOT NULL AS exists`,
      [tableName],
    );
    if (rows[0]?.exists === true) existing.add(tableName);
  }
  for (const tableName of candidateTables) {
    if (!existing.has(tableName)) continue;
    const rows = await executeRawQueryRead(
      db,
      `SELECT 1 FROM ${quoteIdent(tableName)} WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [subjectId, tenantId],
    );
    if (rows.length > 0) return true;
  }
  return false;
}
