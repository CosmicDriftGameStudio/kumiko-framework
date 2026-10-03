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

import { collectLookupableFields } from "../crypto/blind-index.js";
import { quoteIdent, subjectCiphertextLikePattern } from "../crypto/ciphertext-pattern.js";
import { isSelfPiiField } from "../crypto/is-self-pii-field.js";
import type { EntityDefinition } from "../engine/types/fields.js";
import type { FeatureDefinition } from "../engine/types/index.js";
import { toSnakeCase } from "../utils/case.js";
import type { DbRunner } from "./connection.js";
import { resolveTableName } from "./entity-table-meta.js";
import { executeRawQuery, executeRawQueryRead } from "./queries/raw-sql.js";
import { columnNamesOf, tableExists } from "./schema-inspection.js";

export async function nullBlindIndexesForSubject(
  db: DbRunner,
  features: ReadonlyMap<string, FeatureDefinition>,
  subjectKey: string,
): Promise<void> {
  const likePattern = subjectCiphertextLikePattern(subjectKey);
  const candidates: { tableName: string; lookupable: readonly string[] }[] = [];
  for (const feature of features.values()) {
    for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
      const lookupable = collectLookupableFields(entity);
      if (lookupable.length === 0) continue;
      // No featureName prefix — the dispatcher builds entity tables without
      // one (buildEntityTable with no featureName option), the sweep has to
      // hit the same names.
      candidates.push({ tableName: resolveTableName(entityName, entity, undefined), lookupable });
    }
  }
  // Skip entities whose projection was never migrated — same class as
  // subjectRowExistsInTenant (fw#2348). A throw here runs AFTER eraseKey
  // in forget-subject and would leave deterministic bidx columns still
  // linkable (fw#2550). One batched existence query instead of one
  // roundtrip per entity.
  const existing = await existingTableNames(
    db,
    candidates.map((c) => c.tableName),
  );
  for (const { tableName, lookupable } of candidates) {
    if (!existing.has(tableName)) continue;
    // Same hazard for a migrated table that predates a later-added
    // lookupable field: skip fields whose columns are missing instead of
    // aborting the sweep for the remaining ones.
    const columns = await columnNamesOf(db, tableName);
    for (const fieldName of lookupable) {
      const snake = toSnakeCase(fieldName);
      if (!columns.has(snake) || !columns.has(`${snake}_bidx`)) continue;
      await executeRawQuery(
        db,
        `UPDATE ${quoteIdent(tableName)} SET ${quoteIdent(`${snake}_bidx`)} = NULL WHERE ${quoteIdent(snake)} LIKE $1`,
        [likePattern],
      );
    }
  }
}

async function existingTableNames(
  db: DbRunner,
  tableNames: readonly string[],
): Promise<ReadonlySet<string>> {
  if (tableNames.length === 0) return new Set();
  const rows = await executeRawQueryRead<{ name: string }>(
    db,
    `SELECT t.name FROM unnest($1::text[]) AS t(name) WHERE to_regclass('public.' || quote_ident(t.name)) IS NOT NULL`,
    [tableNames],
  );
  return new Set(rows.map((r) => r.name));
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
      // Subject ids are uuids; comparing one to a serial id column makes
      // postgres throw (invalid input syntax for integer) mid forget-TX.
      if (entity.idType === "serial") continue;
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

function findEntityByExactName(
  features: ReadonlyMap<string, FeatureDefinition>,
  entityName: string,
): EntityDefinition | undefined {
  for (const feature of features.values()) {
    const entity = feature.entities?.[entityName];
    if (entity) return entity;
  }
  return undefined;
}

// Tighter than subjectRowExistsInTenant: the record subject names its own
// entity, so this is a single-table lookup instead of a self-PII scan
// across the whole registry.
//
// Invariant: sound only because `id` is a single-column PK per entity
// table (globally unique, unspoofable via a client-supplied explicitId
// at create) — a composite PK or shared table would break this (#2348).
export async function recordRowExistsInTenant(
  db: DbRunner,
  features: ReadonlyMap<string, FeatureDefinition>,
  entityName: string,
  recordId: string,
  tenantId: string,
): Promise<boolean> {
  const entity = findEntityByExactName(features, entityName);
  if (!entity) return false;
  const tableName = resolveTableName(entityName, entity, undefined);
  if (!(await tableExists(db, tableName))) return false;
  const rows = await executeRawQueryRead(
    db,
    `SELECT 1 FROM ${quoteIdent(tableName)} WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [recordId, tenantId],
  );
  return rows.length > 0;
}

// Provenance fallback for record subjects whose projection row is gone (hard
// delete) or that have no registered entity at all (custom aggregates): the
// event stream still names the owning tenant. Sound because the unique index on
// (aggregate_id, version) stops another tenant from opening a stream under an
// existing aggregate id.
export async function recordEventExistsInTenant(
  db: DbRunner,
  aggregateType: string,
  aggregateId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = await executeRawQueryRead(
    db,
    `SELECT 1 FROM "kumiko_events" WHERE aggregate_type = $1 AND aggregate_id = $2::uuid AND tenant_id = $3::uuid LIMIT 1`,
    [aggregateType, aggregateId, tenantId],
  );
  return rows.length > 0;
}

// Owning tenant of a record subject's row, for callers that must evaluate
// tenant-scoped policy for the row's real owner (not the acting user's tenant).
export async function recordRowOwningTenantId(
  db: DbRunner,
  features: ReadonlyMap<string, FeatureDefinition>,
  entityName: string,
  recordId: string,
): Promise<string | undefined> {
  const entity = findEntityByExactName(features, entityName);
  if (!entity) return undefined;
  const tableName = resolveTableName(entityName, entity, undefined);
  if (!(await tableExists(db, tableName))) return undefined;
  const rows = await executeRawQueryRead<{ tenant_id: string }>(
    db,
    `SELECT tenant_id FROM ${quoteIdent(tableName)} WHERE id = $1 LIMIT 1`,
    [recordId],
  );
  return rows[0]?.tenant_id;
}
