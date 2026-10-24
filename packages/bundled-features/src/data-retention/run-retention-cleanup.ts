// Retention-Cleanup-Runner — pure function, called by the retention-cleanup cron
// for each fan-out tenant.
//
// Iterates all implicit entity projections, resolves the effective retention
// policy per entity (3-layer resolver, see resolver.ts), and applies the
// strategy to rows whose reference timestamp is older than the keepFor cutoff:
//
//   - hardDelete  → executor.forget per row (event → rebuild-safe hard purge).
//                   Entities with file/image/files/images fields: bytes first
//                   (incl. derivatives), then the fileRef row(s), then the row;
//                   shared fileRefs (other owner, other row of the same table)
//                   stay untouched.
//   - softDelete  → executor.delete per row (event → rebuild-safe soft-delete),
//                   only on not-yet-deleted rows (isDeleted:false filter)
//   - anonymize   → executor.update per row with the values of the per-field
//                   anonymize functions; row remains (fields.ts contract)
//   - blockDelete → untouched during keepFor (retention requirement;
//                   user-forget triggers anonymize). AFTER expiration, the
//                   anonymize functions run — business data remains, the person-
//                   identifying link is removed (fields.ts:44-47).
//
// Via the executor instead of batch-deleteMany/updateMany: an eventless batch write
// to the (erased) projection table is wiped/resurrected during a projection rebuild.
// Cost: N events per cleanup instead of one batch statement (per-row ceiling, with
// a batch-event variant later).
//
// **Stricter than soft-delete-cleanup:** this cron hard-deletes LIVE rows
// (keyed on reference, default createdAt), not already-soft-deleted ones.
// Therefore the column-existence check comes before every WHERE — a missing/mistyped
// reference column would otherwise produce a malformed/all-matching WHERE and
// delete everything.
//
// **anonymize idempotence without a marker column:** the anonymize functions are
// row-independent (`() => unknown`) — evaluated once per entity, they produce
// the target values. A row that already carries them is skipped, so the
// daily rerun appends zero events. The WHERE continues to match anonymized
// rows (reference remains old), hence id-cursor paging instead of a single
// page — otherwise completed rows clog the batchLimit window.

import {
  collectPiiSubjectFields,
  configuredPiiSubjectKms,
  isRecordKeyedField,
  isSelfPiiField,
  type KmsAdapter,
  resolveSubjectForField,
  type SubjectId,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbRunner,
  nullBlindIndexesForSubject,
  selectMany,
  type TenantDb,
  type WhereObject,
  WritePurposes,
} from "@cosmicdrift/kumiko-framework/db";
import { deleteFileRefBytes } from "@cosmicdrift/kumiko-framework/derivatives";
import {
  createSystemUser,
  type EntityDefinition,
  type EntityId,
  entityHasAnonymizableSubjectField,
  type Registry,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import {
  type FileContext,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import {
  collectSingleFileHolders,
  planFileFields,
  purgeRowFileRefs,
  runInSubTransaction,
  type SingleFileHolder,
} from "../shared/index.ts";
import { computeCutoff, type Instant } from "./keep-for.ts";
import type { RetentionPresetKey } from "./presets.ts";
import { resolveRetentionPolicyForTenant } from "./resolve-for-tenant.ts";
import { tenantRetentionOverrideTable } from "./schema/tenant-retention-override.ts";

const DEFAULT_BATCH_LIMIT = 1000;
const DEFAULT_REFERENCE_FIELD = "createdAt";

// The boot validator (boot-validator/pii-retention.ts FRAMEWORK_TIMESTAMP_FIELDS)
// permits these aliases as retention.reference even when they are not declared in
// entity.fields, but the physical columns use different names
// (table-builder.ts: inserted_at/modified_at). Map them to the actual entity field
// during cleanup; otherwise the column existence check below would cause the cron
// to do nothing silently. deletedAt/lastSeenAt are real fields (softDelete and
// session respectively) and need no translation.
const FRAMEWORK_REFERENCE_ALIAS: Readonly<Record<string, string>> = {
  createdAt: "insertedAt",
  updatedAt: "modifiedAt",
};

export interface RunRetentionCleanupArgs {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  /** Layer-2 preset from resolveTenantRetentionPreset, resolved once per tenant
   *  by the caller rather than per entity here. null = layers 1 and 3 only. */
  readonly preloadedTenantPreset: RetentionPresetKey | null;
  /**
   * Injects the current time so tests can pin it without mocking the date (pattern keep-for.ts).
   */
  readonly now: Instant;
  readonly batchLimit?: number;
  /** Storage access for hardDelete entities with file/image/files/images fields.
   *  Missing while fileRefs are due → the row stays (skipped "missing_file_storage"),
   *  fail-closed instead of orphaning bytes. */
  readonly files?: FileContext;
  /** KMS for erasing a hardDeleted row's own subject key. Defaults
   *  to configuredPiiSubjectKms() (same fallback as run-forget-cleanup.ts);
   *  undefined/no-KMS-configured skips erasure entirely — the row is still
   *  hard-deleted, only crypto-shredding of its DEK is not attempted. */
  readonly kms?: KmsAdapter;
}

export interface RetentionCleanupSkip {
  readonly entityName: string;
  readonly reason:
    | "missing_reference_column"
    | "missing_softdelete_columns"
    | "missing_anonymize_fields"
    | "missing_file_storage"
    | "file_delete_failed";
}

export interface RunRetentionCleanupResult {
  readonly hardDeleted: number;
  readonly softDeleted: number;
  /** Rows deren anonymize-Feld-Funktionen angewendet wurden (anonymize + abgelaufene blockDelete). */
  readonly anonymized: number;
  /**
   * Anomalies where the policy references a missing table column or anonymize has no anonymize
   * fields.
   */
  readonly skipped: readonly RetentionCleanupSkip[];
}

// Select one batchLimit-sized page of matching rows and run the executor op per
// row (event → rebuild-safe). Returns the count of successful ops.
async function purgeMatchingRows(
  db: DbRunner,
  table: Parameters<typeof selectMany>[1],
  where: WhereObject,
  batchLimit: number,
  op: (id: EntityId) => Promise<{ readonly isSuccess: boolean }>,
): Promise<number> {
  const rows = await selectMany<{ id: EntityId }>(db, table, where, { limit: batchLimit });
  let count = 0;
  for (const row of rows) {
    const res = await op(row.id);
    if (res.isSuccess) count++;
  }
  return count;
}

// --- hardDelete crypto-shredding ---
//
// recordOwned/self-pii resolution (subject-resolver.ts) only ever reads
// `row.id` for these two kinds — resolveRecordSubject uses opts.entityName +
// row.id, resolveSelfPiiSubject uses row.id alone — so a `{ id }`-shaped row
// (purgeMatchingRows's hardDelete select) is enough; the with-files path's
// full row works the same way.
//
// userOwned/tenantOwned are explicitly excluded (except a whenAbsent: "self" field
// of an ownerless row, which resolves to this row's own record key): hardDelete only destroys
// THIS row's own data, but the owning user's/tenant's key may still protect
// OTHER live rows that reference the same subject — erasing it here would
// be a silent cross-row data-loss bug, not a retention fix.
function mayResolveToOwnRecordKey(field: EntityDefinition["fields"][string]): boolean {
  if ("tenantOwned" in field && field.tenantOwned === true) return false;
  if ("userOwned" in field && field.userOwned !== undefined) return isRecordKeyedField(field);
  return ("recordOwned" in field && field.recordOwned === true) || isSelfPiiField(field);
}

function collectHardDeleteEraseSubjects(
  entity: EntityDefinition,
  entityName: string,
  tenantId: TenantId,
  row: Record<string, unknown>,
): readonly SubjectId[] {
  const subjectsByKey = new Map<string, SubjectId>();
  for (const fieldName of collectPiiSubjectFields(entity)) {
    const field = entity.fields[fieldName];
    if (!field || !mayResolveToOwnRecordKey(field)) continue;
    const subject = resolveSubjectForField(entity, fieldName, row, { tenantId, entityName });
    // whenAbsent: "self" resolves to the owner's key while the row has an owner — never erased here
    const isUserOwned = "userOwned" in field && field.userOwned !== undefined;
    if (isUserOwned && subject?.kind !== "record") continue;
    if (subject) subjectsByKey.set(subjectIdToKey(subject), subject);
  }
  return Array.from(subjectsByKey.values());
}

// Erases the row's own recordOwned/self-pii subject key(s) + sweeps their
// blind indexes. Called from INSIDE the same sub-transaction as the row's forget
// (see forgetRowAndEraseKeys) — an eraseKey throw rolls the forget back too,
// same crash-safety contract as run-forget-cleanup.ts:477-503 (eraseKey is
// contractually idempotent per KmsAdapter, so a retried run re-erases safely).
async function eraseHardDeletedRowKeys(args: {
  readonly kms: KmsAdapter | undefined;
  readonly tx: DbRunner;
  readonly registry: Registry;
  readonly entity: EntityDefinition;
  readonly entityName: string;
  readonly tenantId: TenantId;
  readonly row: Record<string, unknown>;
}): Promise<void> {
  // skip: no KMS adapter, so there are no per-subject keys to erase
  if (!args.kms) return;
  const subjects = collectHardDeleteEraseSubjects(
    args.entity,
    args.entityName,
    args.tenantId,
    args.row,
  );
  for (const subject of subjects) {
    await args.kms.eraseKey(subject, {
      requestId: `data-retention:hardDelete:${args.entityName}:${String(args.row["id"])}`,
      eraseReason: "data-retention:hardDelete",
    });
    await nullBlindIndexesForSubject(args.tx, args.registry.features, subjectIdToKey(subject));
  }
}

// Shared by both hardDelete paths (purgeMatchingRows's op below and
// purgeHardDeleteRowWithFiles) so the erase-after-forget ordering can't be
// forgotten on either one. Wraps the executor's own forget() (which already
// opens its own nested savepoints) in one sub-transaction that also covers
// eraseKey + the blind-index sweep — a KMS failure rolls the whole row back,
// not just the forget. The retention job hands in a pool connection, so this
// must open a real BEGIN there; a savepoint-if-supported helper would run
// unconfined and leave the row gone with its key still live.
async function forgetRowAndEraseKeys(args: {
  readonly db: DbRunner;
  readonly executor: ReturnType<typeof createEventStoreExecutor>;
  readonly entity: EntityDefinition;
  readonly entityName: string;
  readonly tenantId: TenantId;
  readonly systemUser: SessionUser;
  readonly rowId: EntityId;
  readonly row: Record<string, unknown>;
  readonly kms: KmsAdapter | undefined;
  readonly registry: Registry;
}): Promise<{ readonly isSuccess: boolean }> {
  return runInSubTransaction(args.db, async (sp) => {
    const tdb = createTenantDb({
      db: sp,
      tenantId: args.tenantId,
      mode: "system",
      reason: "retention sweep forgets rows of the tenant being swept, outside any request scope",
    });
    const result = await args.executor.forget({ id: args.rowId }, args.systemUser, tdb);
    if (!result.isSuccess) return { isSuccess: false };
    await eraseHardDeletedRowKeys({
      kms: args.kms,
      tx: sp,
      registry: args.registry,
      entity: args.entity,
      entityName: args.entityName,
      tenantId: args.tenantId,
      row: args.row,
    });
    return { isSuccess: true };
  });
}

// --- hardDelete + file-fields ---

// Throws (unsafe key, missing list permission) must fail this row closed,
// not abort the whole tenant run.
async function deleteFileFailingClosed(
  key: string,
  files: FileContext,
  logContext: string,
): Promise<readonly string[]> {
  try {
    return await deleteFileRefBytes(files, { storageKey: key }, "data-retention:hardDelete");
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: operator-visibility for storage-cleanup failures
    console.warn(
      `[data-retention:hardDelete] ${logContext} storage cleanup threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [key];
  }
}

// hardDelete for ONE row of an entity that has file/image/files/images
// fields: purge the un-shared fileRefs (bytes + derivatives, then the fileRef
// rows), then the entity row itself.
async function purgeHardDeleteRowWithFiles(args: {
  readonly db: DbRunner;
  readonly table: Parameters<typeof selectMany>[1];
  readonly fileHolders: readonly SingleFileHolder[];
  readonly tenantId: TenantId;
  readonly entityName: string;
  readonly entity: EntityDefinition;
  readonly rowId: EntityId;
  readonly row: Record<string, unknown>;
  readonly files: FileContext | undefined;
  readonly entityExecutor: ReturnType<typeof createEventStoreExecutor>;
  readonly fileRefExecutor: ReturnType<typeof createEventStoreExecutor>;
  readonly systemUser: SessionUser;
  readonly tdb: TenantDb;
  readonly kms: KmsAdapter | undefined;
  readonly registry: Registry;
  readonly onSkip: (reason: "missing_file_storage" | "file_delete_failed") => void;
}): Promise<boolean> {
  const logContext = `tenant=${args.tenantId} entity=${args.entityName} row=${String(args.rowId)}`;
  const files = args.files;
  const outcome = await purgeRowFileRefs({
    db: args.db,
    tenantId: args.tenantId,
    entityName: args.entityName,
    entity: args.entity,
    table: args.table,
    fileHolders: args.fileHolders,
    row: args.row,
    deleteBytes: files ? (key) => deleteFileFailingClosed(key, files, logContext) : undefined,
    fileRefForget: async (fileRefId) =>
      (await args.fileRefExecutor.forget({ id: fileRefId }, args.systemUser, args.tdb)).isSuccess,
    onBytesDeleteFailed: (failedKeys) => {
      // biome-ignore lint/suspicious/noConsole: operator-visibility for storage-cleanup failures
      console.warn(
        `[data-retention:hardDelete] ${logContext} storage delete failed keys=${failedKeys.join(",")}`,
      );
    },
  });
  if (outcome !== "purged") {
    args.onSkip(outcome);
    return false;
  }
  return (
    await forgetRowAndEraseKeys({
      db: args.db,
      executor: args.entityExecutor,
      entity: args.entity,
      entityName: args.entityName,
      tenantId: args.tenantId,
      systemUser: args.systemUser,
      rowId: args.rowId,
      row: args.row,
      kms: args.kms,
      registry: args.registry,
    })
  ).isSuccess;
}

// hardDelete page for an entity WITH file/image/files/images fields — loads
// full rows (not just id) so file-field values are available, and reports
// each skip reason at most once per entity per run (repeat skips would just
// be noise; the per-row failure is already warned above).
async function purgeHardDeleteRowsWithFiles(args: {
  readonly db: DbRunner;
  readonly table: Parameters<typeof selectMany>[1];
  readonly fileHolders: readonly SingleFileHolder[];
  readonly where: WhereObject;
  readonly batchLimit: number;
  readonly tenantId: TenantId;
  readonly entityName: string;
  readonly entity: EntityDefinition;
  readonly files: FileContext | undefined;
  readonly entityExecutor: ReturnType<typeof createEventStoreExecutor>;
  readonly fileRefExecutor: ReturnType<typeof createEventStoreExecutor>;
  readonly systemUser: SessionUser;
  readonly tdb: TenantDb;
  readonly kms: KmsAdapter | undefined;
  readonly registry: Registry;
  readonly skipped: RetentionCleanupSkip[];
}): Promise<number> {
  const reasonsSeen = new Set<RetentionCleanupSkip["reason"]>();
  const onSkip = (reason: "missing_file_storage" | "file_delete_failed") => {
    // skip: reason already reported for this entity in this run
    if (reasonsSeen.has(reason)) return;
    reasonsSeen.add(reason);
    args.skipped.push({ entityName: args.entityName, reason });
  };

  // id-cursor paging: rows skipped (missing storage, failed delete) stay in the
  // table, so an unordered limit-page would re-fetch the same stuck rows every
  // run and starve every row behind them. batchLimit bounds the DELETES.
  let count = 0;
  let cursor: EntityId | null = null;
  while (count < args.batchLimit) {
    const pageWhere: WhereObject =
      cursor === null ? args.where : { ...args.where, id: { gt: cursor } };
    const rows = await selectMany<Record<string, unknown>>(args.db, args.table, pageWhere, {
      limit: args.batchLimit,
      orderBy: { col: "id" },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      const rawId = row["id"];
      if (typeof rawId !== "string" && typeof rawId !== "number") {
        throw new InternalError({
          message: `data-retention: ${args.entityName} row has no usable id (got ${typeof rawId})`,
        });
      }
      const rowId = rawId;
      cursor = rowId;
      const ok = await purgeHardDeleteRowWithFiles({
        db: args.db,
        table: args.table,
        fileHolders: args.fileHolders,
        tenantId: args.tenantId,
        entityName: args.entityName,
        entity: args.entity,
        rowId,
        row,
        files: args.files,
        entityExecutor: args.entityExecutor,
        fileRefExecutor: args.fileRefExecutor,
        systemUser: args.systemUser,
        tdb: args.tdb,
        kms: args.kms,
        registry: args.registry,
        onSkip,
      });
      if (ok) count++;
      if (count >= args.batchLimit) break;
    }
  }
  return count;
}

// PiiAnnotations.anonymize — structural view, avoids reaching into the
// engine's field-type internals from here.
type AnonymizeCapableField = { readonly anonymize?: () => unknown | Promise<unknown> };

// Evaluate the entity's per-field anonymize functions ONCE — they are
// row-independent by signature, so the result doubles as the idempotency
// probe: a row already carrying these values needs no event.
async function resolveAnonymizeTargets(
  fields: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown> | null> {
  const targets: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    const annot = field as AnonymizeCapableField; // @cast-boundary schema-walk
    if (typeof annot.anonymize === "function") targets[name] = await annot.anonymize();
  }
  return Object.keys(targets).length > 0 ? targets : null;
}

function rowNeedsAnonymize(
  row: Record<string, unknown>,
  targets: Record<string, unknown>,
): boolean {
  return Object.entries(targets).some(([field, value]) => row[field] !== value);
}

// Anonymize every matching row via the executor (event → rebuild-safe).
// id-Cursor-paged because the where keeps matching already-anonymized rows;
// the diff-check keeps the daily re-run event-free. batchLimit bounds the
// UPDATES per run, not the scan.
// ponytail: scans all past-cutoff rows per run — add an anonymized-marker
// column if a hot entity accumulates millions of held rows.
async function anonymizeMatchingRows(
  db: DbRunner,
  table: Parameters<typeof selectMany>[1],
  where: WhereObject,
  batchLimit: number,
  targets: Record<string, unknown>,
  op: (id: EntityId, changes: Record<string, unknown>) => Promise<{ readonly isSuccess: boolean }>,
): Promise<number> {
  let count = 0;
  let cursor: EntityId | null = null;
  while (count < batchLimit) {
    const pageWhere: WhereObject = cursor === null ? where : { ...where, id: { gt: cursor } };
    const rows = await selectMany<Record<string, unknown>>(db, table, pageWhere, {
      limit: batchLimit,
      orderBy: { col: "id" },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      cursor = row["id"] as EntityId; // @cast-boundary db-row
      if (!rowNeedsAnonymize(row, targets)) continue;
      const res = await op(cursor, targets);
      if (res.isSuccess) count++;
      if (count >= batchLimit) break;
    }
  }
  return count;
}

export async function runRetentionCleanup(
  args: RunRetentionCleanupArgs,
): Promise<RunRetentionCleanupResult> {
  const { db, registry, tenantId, preloadedTenantPreset, now } = args;
  const batchLimit = args.batchLimit ?? DEFAULT_BATCH_LIMIT;
  const kms = args.kms ?? configuredPiiSubjectKms();

  let hardDeleted = 0;
  let softDeleted = 0;
  let anonymized = 0;
  const skipped: RetentionCleanupSkip[] = [];

  // Retention writes go through the executor (events) so a projection rebuild
  // replays the cleanup — a batch deleteMany/updateMany on the (erased)
  // projection table is eventless and gets wiped/resurrected on rebuild.
  // The cron acts as the system actor; the WHERE already tenant-scopes, so a
  // system-mode TenantDb (no extra filter) is correct.
  // ponytail: per-row events, one batchLimit-sized page per entity per run —
  // the daily cron converges (hardDelete removes rows, softDelete's isDeleted
  // filter shrinks the set). A single batched forget/delete event is a follow-up.
  const systemUser = createSystemUser(tenantId);
  const tdb = createTenantDb({
    db,
    tenantId,
    mode: "system",
    reason: "retention sweep forgets rows of the tenant being swept, outside any request scope",
  });
  const fileHolders = collectSingleFileHolders(registry);

  // Pre-load every override row for this tenant ONCE — N entities × M
  // tenants would otherwise mean one fetchOne per entity per tenant, even
  // though the whole set for a tenant is a single small, indexed read.
  const overrideRows = await selectMany<{ entityName: string; config: string | null }>(
    db,
    tenantRetentionOverrideTable,
    { tenantId },
  );
  const overrideByEntity = new Map(overrideRows.map((r) => [r.entityName, { config: r.config }]));

  for (const proj of registry.getAllProjections().values()) {
    // Only implicit entity projections with a table are targets, as in
    // soft-delete-cleanup. Custom projections and unmanaged tables (such as
    // sessions) are excluded.
    if (proj.isImplicit !== true || typeof proj.source !== "string" || !proj.table) continue;
    const entityName = proj.source;

    const resolved = await resolveRetentionPolicyForTenant({
      db,
      registry,
      tenantId,
      entityName,
      preloadedTenantPreset,
      preloadedOverride: overrideByEntity.get(entityName) ?? null,
    });
    const policy = resolved.policy;
    if (!policy) continue;
    const entity = registry.getEntity(entityName);
    if (!entity) continue;

    const declaredReference = policy.reference ?? DEFAULT_REFERENCE_FIELD;
    const referenceField = FRAMEWORK_REFERENCE_ALIAS[declaredReference] ?? declaredReference;

    if (propertyOf(proj.table, referenceField) === undefined) {
      skipped.push({ entityName, reason: "missing_reference_column" });
      continue;
    }

    const cutoff = computeCutoff(policy.keepFor, now);
    const where: WhereObject = { [referenceField]: { lt: cutoff } };
    // Apply tenant scoping only when the table has a tenantId column, as in
    // soft-delete-cleanup. Without this filter, one tenant could affect another
    // tenant's rows.
    if (propertyOf(proj.table, "tenantId") !== undefined) {
      where["tenantId"] = tenantId;
    }

    switch (policy.strategy) {
      case "hardDelete": {
        const executor = createEventStoreExecutor(proj.table, entity, { entityName });
        const filePlan = planFileFields(entity.fields);
        if (filePlan.singleFields.length === 0 && filePlan.multiFields.length === 0) {
          hardDeleted += await purgeMatchingRows(db, proj.table, where, batchLimit, (id) =>
            forgetRowAndEraseKeys({
              db,
              executor,
              entity,
              entityName,
              tenantId,
              systemUser,
              rowId: id,
              row: { id },
              kms,
              registry,
            }),
          );
          break;
        }
        const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
          entityName: "fileRef",
        });
        hardDeleted += await purgeHardDeleteRowsWithFiles({
          db,
          table: proj.table,
          fileHolders,
          where,
          batchLimit,
          tenantId,
          entityName,
          entity,
          files: args.files,
          entityExecutor: executor,
          fileRefExecutor,
          systemUser,
          tdb,
          kms,
          registry,
          skipped,
        });
        break;
      }
      case "softDelete": {
        if (
          propertyOf(proj.table, "isDeleted") === undefined ||
          propertyOf(proj.table, "deletedAt") === undefined
        ) {
          skipped.push({ entityName, reason: "missing_softdelete_columns" });
          break;
        }
        const executor = createEventStoreExecutor(proj.table, entity, { entityName });
        softDeleted += await purgeMatchingRows(
          db,
          proj.table,
          { ...where, isDeleted: false },
          batchLimit,
          (id) =>
            executor.delete({ id }, systemUser, tdb, { writePurpose: WritePurposes.retention }),
        );
        break;
      }
      // blockDelete = Legal-Hold: rows stay untouched during keepFor (the
      // cutoff-WHERE guarantees that), user-forget anonymizes instead of
      // deleting (run-forget-cleanup maps blockDelete → anonymize). AFTER the
      // hold expires the anonymize-field functions run — business data stays,
      // the person link goes (fields.ts contract). Same executor path as the
      // anonymize strategy, so both cases share it.
      case "anonymize":
      case "blockDelete": {
        const targets = await resolveAnonymizeTargets(entity.fields);
        if (!targets) {
          // blockDelete without anonymize fields is a pure hold only while the
          // entity has no field that CAN carry anonymize: a subjectRef-only
          // person link outlives the hold and is cut by the user-data forget
          // hook. A personal field lacking its anonymize function would stay
          // stored past the hold, so that case is still reported.
          if (policy.strategy === "anonymize" || entityHasAnonymizableSubjectField(entity.fields)) {
            skipped.push({ entityName, reason: "missing_anonymize_fields" });
          }
          break;
        }
        const executor = createEventStoreExecutor(proj.table, entity, { entityName });
        anonymized += await anonymizeMatchingRows(
          db,
          proj.table,
          where,
          batchLimit,
          targets,
          (id, changes) =>
            executor.update({ id, changes }, systemUser, tdb, {
              skipOptimisticLock: true,
              writePurpose: WritePurposes.retention,
            }),
        );
        break;
      }
    }
  }

  return { hardDeleted, softDeleted, anonymized, skipped };
}
