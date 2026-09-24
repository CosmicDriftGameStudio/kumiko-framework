// Retention-Cleanup-Runner (S2.D2b) — pure Function, vom retention-cleanup-Cron
// pro fan-out-Tenant aufgerufen.
//
// Iteriert alle implicit-Entity-Projektionen, loest pro Entity die effektive
// Retention-Policy (3-Schicht-Resolver, siehe resolver.ts) und wendet die
// Strategy auf Rows an deren reference-Timestamp aelter als der keepFor-Cutoff
// ist:
//
//   - hardDelete  → executor.forget pro Row (Event → rebuild-safe hard purge).
//                   Entities with file/image/files/images fields: bytes first
//                   (incl. derivatives), then the fileRef row(s), then the row;
//                   shared fileRefs (other owner, other row of the same table)
//                   stay untouched.
//   - softDelete  → executor.delete pro Row (Event → rebuild-safe soft-delete),
//                   nur auf noch-nicht-geloeschte (isDeleted:false-Filter)
//   - anonymize   → executor.update pro Row mit den Werten der per-Feld
//                   anonymize-Funktionen; Row bleibt (fields.ts-Contract)
//   - blockDelete → waehrend keepFor unangetastet (Aufbewahrungs-Pflicht;
//                   user-forget loest anonymize aus). NACH Ablauf laufen die
//                   anonymize-Funktionen — Geschaeftsdaten bleiben, Personen-
//                   Bezug raus (fields.ts:44-47).
//
// Über den Executor statt Batch-deleteMany/updateMany: ein eventloser Batch-Write
// auf die (erased) Projektions-Tabelle wird beim Projection-Rebuild
// gewischt/resurrektiert — das #648-Loch. Kosten: N Events pro Cleanup statt ein
// Batch-Statement (per-Row-Ceiling, Batch-Event-Variante als Follow-up).
//
// **Schaerfer als soft-delete-cleanup:** dieser Cron hardDeleted LIVE Rows
// (keyed auf reference, Default createdAt), nicht bereits-soft-geloeschte.
// Darum die Spalten-Existenz-Pruefung vor jedem WHERE — eine fehlende/vertippte
// reference-Spalte wuerde sonst ein malformed/all-matching WHERE ergeben und
// pauschal loeschen.
//
// **anonymize-Idempotenz ohne Marker-Spalte:** die anonymize-Funktionen sind
// row-unabhaengig (`() => unknown`) — einmal pro Entity ausgewertet ergeben
// sie die Ziel-Werte. Eine Row die sie schon traegt wird uebersprungen, der
// taegliche Re-Lauf appended also null Events. Der WHERE matcht anonymisierte
// Rows weiter (reference bleibt alt), deshalb id-Cursor-Paging statt einer
// einzelnen Page — sonst verstopfen erledigte Rows das batchLimit-Fenster.

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbRunner,
  type TenantDb,
  type WhereObject,
} from "@cosmicdrift/kumiko-framework/db";
import { deleteStoredFileAndDerivatives } from "@cosmicdrift/kumiko-framework/derivatives";
import {
  createSystemUser,
  type EntityId,
  type Registry,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  type FileContext,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { computeCutoff, type Instant } from "./keep-for";
import type { RetentionPresetKey } from "./presets";
import { resolveRetentionPolicyForTenant } from "./resolve-for-tenant";
import { tenantRetentionOverrideTable } from "./schema/tenant-retention-override";

const DEFAULT_BATCH_LIMIT = 1000;
const DEFAULT_REFERENCE_FIELD = "createdAt";

// Der Boot-Validator (boot-validator/pii-retention.ts FRAMEWORK_TIMESTAMP_FIELDS)
// erlaubt diese Aliase als retention.reference, auch wenn sie nicht in
// entity.fields deklariert sind — die physischen Spalten heissen aber anders
// (table-builder.ts: inserted_at/modified_at). Hier zur Cleanup-Zeit auf das
// echte Entity-Feld mappen, sonst trifft die Spalten-Existenz-Pruefung unten
// und der Cron wuerde lautlos nichts tun. deletedAt/lastSeenAt sind echte
// Felder (softDelete bzw. session) und brauchen keine Uebersetzung.
const FRAMEWORK_REFERENCE_ALIAS: Readonly<Record<string, string>> = {
  createdAt: "insertedAt",
  updatedAt: "modifiedAt",
};

export interface RunRetentionCleanupArgs {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  /** Layer-2 Preset (aus resolveTenantRetentionPreset). null = nur Layer 1/3. */
  readonly tenantPreset: RetentionPresetKey | null;
  /** Now-Injection — Tests pinnen den Wert ohne Date-Mock (Pattern keep-for.ts). */
  readonly now: Instant;
  readonly batchLimit?: number;
  /** Storage access for hardDelete entities with file/image/files/images fields.
   *  Missing while fileRefs are due → the row stays (skipped "missing_file_storage"),
   *  fail-closed instead of orphaning bytes. */
  readonly files?: FileContext;
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
  /** Anomalien: Policy referenziert eine Spalte die die Tabelle nicht hat, oder anonymize ohne anonymize-Felder. */
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

// --- hardDelete + file-fields (kumiko-framework#3089) ---

type FileFieldPlan = {
  /** type file|image — stores the fileRef-id directly in the entity column. */
  readonly singleFields: readonly string[];
  /** type files|images — no entity column, resolved via file_refs. */
  readonly multiFields: readonly string[];
};

const NO_FILE_FIELDS: FileFieldPlan = { singleFields: [], multiFields: [] };

// file/image = single-column fields (fileRef-id lives directly in the entity
// row); files/images = plural, no column, resolved via file_refs. Same set
// as boot-validator/entity-handler.ts FILE_FIELD_TYPES and engine's
// isFileField — inlined here rather than importing across the package
// barrel since this module already needs the single/multi split, not just
// membership.
function planFileFields(fields: Readonly<Record<string, unknown>>): FileFieldPlan {
  const singleFields: string[] = [];
  const multiFields: string[] = [];
  for (const [name, field] of Object.entries(fields)) {
    const type = (field as { readonly type?: unknown }).type; // @cast-boundary schema-walk
    if (type === "file" || type === "image") singleFields.push(name);
    else if (type === "files" || type === "images") multiFields.push(name);
  }
  return singleFields.length > 0 || multiFields.length > 0
    ? { singleFields, multiFields }
    : NO_FILE_FIELDS;
}

// Every fileRef-id a row's file/image/files/images-fields reference: single
// fields hold the id in their own column, plural fields have no column and
// resolve via file_refs (tenantId, entityType, entityId, fieldName).
async function collectFileRefIds(
  db: DbRunner,
  tenantId: TenantId,
  entityName: string,
  row: Record<string, unknown>,
  plan: FileFieldPlan,
): Promise<readonly string[]> {
  const ids = new Set<string>();
  for (const field of plan.singleFields) {
    const value = row[field];
    if (typeof value === "string" && value.length > 0) ids.add(value);
  }
  if (plan.multiFields.length > 0) {
    const refRows = await selectMany<{ id: string }>(db, fileRefsTable, {
      tenantId,
      entityType: entityName,
      entityId: String(row["id"]),
      fieldName: { in: plan.multiFields },
    });
    for (const r of refRows) ids.add(r.id);
  }
  return Array.from(ids);
}

// A fileRef is bound to a DIFFERENT entity/record than the row currently
// being purged — its binding (entityType/entityId), not the row's own
// single-field column, decides ownership. A single-field value can point at
// a fileRef uploaded/attached elsewhere; that fileRef's bytes belong to
// whatever it's actually bound to, not to this row.
function isFileRefBoundElsewhere(
  fileRef: Record<string, unknown>,
  entityName: string,
  rowId: string,
): boolean {
  const entityType = fileRef["entityType"];
  const entityId = fileRef["entityId"];
  if (typeof entityType === "string" && entityType !== entityName) return true;
  if (typeof entityId === "string" && entityId !== rowId) return true;
  return false;
}

// A single-field fileRef-id can be shared by more than one row of the SAME
// table (e.g. a stock-photo re-picked across records). Purging its bytes
// would corrupt the row that isn't being deleted. Bounded by batchLimit rows
// per run and singleFields.length queries per fileRef — the same per-row
// event-cost tradeoff as the rest of this cron (see header).
async function isFileRefSharedByOtherRow(
  db: DbRunner,
  table: Parameters<typeof selectMany>[1],
  tableHasTenantId: boolean,
  tenantId: TenantId,
  rowId: string,
  singleFields: readonly string[],
  fileRefId: string,
): Promise<boolean> {
  for (const field of singleFields) {
    const where: WhereObject = { [field]: fileRefId, id: { ne: rowId } };
    if (tableHasTenantId) where["tenantId"] = tenantId;
    const others = await selectMany(db, table, where, { limit: 1 });
    if (others.length > 0) return true;
  }
  return false;
}

// hardDelete for ONE row of an entity that has file/image/files/images
// fields: delete the un-shared fileRefs' bytes (+ derivatives) first, then
// their fileRef rows, then the entity row itself — bytes before rows so a
// crash mid-way leaves an orphaned fileRef pointing at already-gone bytes
// (safe: a later run's provider.delete is idempotent) rather than a gone
// fileRef whose bytes leak forever.
async function purgeHardDeleteRowWithFiles(args: {
  readonly db: DbRunner;
  readonly table: Parameters<typeof selectMany>[1];
  readonly tableHasTenantId: boolean;
  readonly tenantId: TenantId;
  readonly entityName: string;
  readonly row: Record<string, unknown>;
  readonly plan: FileFieldPlan;
  readonly files: FileContext | undefined;
  readonly entityExecutor: ReturnType<typeof createEventStoreExecutor>;
  readonly fileRefExecutor: ReturnType<typeof createEventStoreExecutor>;
  readonly systemUser: SessionUser;
  readonly tdb: TenantDb;
  readonly onSkip: (reason: "missing_file_storage" | "file_delete_failed") => void;
}): Promise<boolean> {
  const rowId = String(args.row["id"]);
  const fileRefIds = await collectFileRefIds(
    args.db,
    args.tenantId,
    args.entityName,
    args.row,
    args.plan,
  );
  if (fileRefIds.length === 0) {
    return (
      await args.entityExecutor.forget(
        { id: args.row["id"] as EntityId },
        args.systemUser,
        args.tdb,
      )
    ).isSuccess;
  }

  const fileRefRows = await selectMany<Record<string, unknown>>(args.db, fileRefsTable, {
    id: { in: fileRefIds },
    tenantId: args.tenantId,
  });

  const toDelete: Record<string, unknown>[] = [];
  for (const fileRef of fileRefRows) {
    if (isFileRefBoundElsewhere(fileRef, args.entityName, rowId)) continue;
    const shared = await isFileRefSharedByOtherRow(
      args.db,
      args.table,
      args.tableHasTenantId,
      args.tenantId,
      rowId,
      args.plan.singleFields,
      String(fileRef["id"]),
    );
    if (shared) continue;
    toDelete.push(fileRef);
  }

  if (toDelete.length === 0) {
    return (
      await args.entityExecutor.forget(
        { id: args.row["id"] as EntityId },
        args.systemUser,
        args.tdb,
      )
    ).isSuccess;
  }

  if (!args.files) {
    args.onSkip("missing_file_storage");
    return false;
  }
  const files = args.files;
  const store = { list: files.list, delete: (key: string) => files.ref(key).delete() };

  let anyFailed = false;
  for (const fileRef of toDelete) {
    const key = fileRef["storageKey"];
    if (typeof key !== "string" || key.length === 0) continue;
    const failedKeys = await deleteStoredFileAndDerivatives(
      key,
      store,
      "data-retention:hardDelete",
    );
    if (failedKeys.length > 0) {
      anyFailed = true;
      // biome-ignore lint/suspicious/noConsole: operator-visibility for storage-cleanup failures
      console.warn(
        `[data-retention:hardDelete] tenant=${args.tenantId} entity=${args.entityName} row=${rowId} storage delete failed keys=${failedKeys.join(",")}`,
      );
    }
  }
  if (anyFailed) {
    args.onSkip("file_delete_failed");
    return false;
  }

  for (const fileRef of toDelete) {
    const res = await args.fileRefExecutor.forget(
      { id: fileRef["id"] as EntityId },
      args.systemUser,
      args.tdb,
    );
    if (!res.isSuccess) {
      args.onSkip("file_delete_failed");
      return false;
    }
  }

  return (
    await args.entityExecutor.forget({ id: args.row["id"] as EntityId }, args.systemUser, args.tdb)
  ).isSuccess;
}

// hardDelete page for an entity WITH file/image/files/images fields — loads
// full rows (not just id) so file-field values are available, and reports
// each skip reason at most once per entity per run (repeat skips would just
// be noise; the per-row failure is already warned above).
async function purgeHardDeleteRowsWithFiles(args: {
  readonly db: DbRunner;
  readonly table: Parameters<typeof selectMany>[1];
  readonly tableHasTenantId: boolean;
  readonly where: WhereObject;
  readonly batchLimit: number;
  readonly tenantId: TenantId;
  readonly entityName: string;
  readonly plan: FileFieldPlan;
  readonly files: FileContext | undefined;
  readonly entityExecutor: ReturnType<typeof createEventStoreExecutor>;
  readonly fileRefExecutor: ReturnType<typeof createEventStoreExecutor>;
  readonly systemUser: SessionUser;
  readonly tdb: TenantDb;
  readonly skipped: RetentionCleanupSkip[];
}): Promise<number> {
  const rows = await selectMany<Record<string, unknown>>(args.db, args.table, args.where, {
    limit: args.batchLimit,
  });
  const reasonsSeen = new Set<RetentionCleanupSkip["reason"]>();
  const onSkip = (reason: "missing_file_storage" | "file_delete_failed") => {
    if (reasonsSeen.has(reason)) return;
    reasonsSeen.add(reason);
    args.skipped.push({ entityName: args.entityName, reason });
  };

  let count = 0;
  for (const row of rows) {
    const ok = await purgeHardDeleteRowWithFiles({
      db: args.db,
      table: args.table,
      tableHasTenantId: args.tableHasTenantId,
      tenantId: args.tenantId,
      entityName: args.entityName,
      row,
      plan: args.plan,
      files: args.files,
      entityExecutor: args.entityExecutor,
      fileRefExecutor: args.fileRefExecutor,
      systemUser: args.systemUser,
      tdb: args.tdb,
      onSkip,
    });
    if (ok) count++;
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
  const { db, registry, tenantId, tenantPreset, now } = args;
  const batchLimit = args.batchLimit ?? DEFAULT_BATCH_LIMIT;

  let hardDeleted = 0;
  let softDeleted = 0;
  let anonymized = 0;
  const skipped: RetentionCleanupSkip[] = [];

  // Retention writes go through the executor (events) so a projection rebuild
  // replays the cleanup — a batch deleteMany/updateMany on the (erased)
  // projection table is eventless and gets wiped/resurrected on rebuild (the
  // #648 hole this closes). The cron acts as the system actor; the WHERE already
  // tenant-scopes, so a system-mode TenantDb (no extra filter) is correct.
  // ponytail: per-row events, one batchLimit-sized page per entity per run —
  // the daily cron converges (hardDelete removes rows, softDelete's isDeleted
  // filter shrinks the set). A single batched forget/delete event is a follow-up.
  const systemUser = createSystemUser(tenantId);
  const tdb = createTenantDb(db, tenantId, "system");

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
    // Nur implicit-Entity-Projektionen mit Tabelle — wie soft-delete-cleanup.
    // Custom-Projektionen + unmanaged-Tables (z.B. sessions) sind kein Target.
    if (proj.isImplicit !== true || typeof proj.source !== "string" || !proj.table) continue;
    const entityName = proj.source;

    const resolved = await resolveRetentionPolicyForTenant({
      db,
      registry,
      tenantId,
      entityName,
      tenantPreset,
      preloadedOverride: overrideByEntity.get(entityName) ?? null,
    });
    const policy = resolved.policy;
    if (!policy) continue;
    const entity = registry.getEntity(entityName);
    if (!entity) continue;

    const table = proj.table as Record<string, unknown>; // @cast-boundary column-presence probe
    const declaredReference = policy.reference ?? DEFAULT_REFERENCE_FIELD;
    const referenceField = FRAMEWORK_REFERENCE_ALIAS[declaredReference] ?? declaredReference;

    if (table[referenceField] === undefined) {
      skipped.push({ entityName, reason: "missing_reference_column" });
      continue;
    }

    const cutoff = computeCutoff(policy.keepFor, now);
    const where: WhereObject = { [referenceField]: { lt: cutoff } };
    // Tenant-Scope nur wenn die Tabelle eine tenantId-Spalte hat — identisch zu
    // soft-delete-cleanup. Ohne diesen Filter wuerde ein Tenant die Rows eines
    // anderen treffen.
    if (table["tenantId"] !== undefined) {
      where["tenantId"] = tenantId;
    }

    switch (policy.strategy) {
      case "hardDelete": {
        const executor = createEventStoreExecutor(proj.table, entity, { entityName });
        const filePlan = planFileFields(entity.fields);
        if (filePlan.singleFields.length === 0 && filePlan.multiFields.length === 0) {
          hardDeleted += await purgeMatchingRows(db, proj.table, where, batchLimit, (id) =>
            executor.forget({ id }, systemUser, tdb),
          );
          break;
        }
        const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
          entityName: "fileRef",
        });
        hardDeleted += await purgeHardDeleteRowsWithFiles({
          db,
          table: proj.table,
          tableHasTenantId: table["tenantId"] !== undefined,
          where,
          batchLimit,
          tenantId,
          entityName,
          plan: filePlan,
          files: args.files,
          entityExecutor: executor,
          fileRefExecutor,
          systemUser,
          tdb,
          skipped,
        });
        break;
      }
      case "softDelete": {
        if (table["isDeleted"] === undefined || table["deletedAt"] === undefined) {
          skipped.push({ entityName, reason: "missing_softdelete_columns" });
          break;
        }
        const executor = createEventStoreExecutor(proj.table, entity, { entityName });
        softDeleted += await purgeMatchingRows(
          db,
          proj.table,
          { ...where, isDeleted: false },
          batchLimit,
          (id) => executor.delete({ id }, systemUser, tdb),
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
          skipped.push({ entityName, reason: "missing_anonymize_fields" });
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
            executor.update({ id, changes }, systemUser, tdb, { skipOptimisticLock: true }),
        );
        break;
      }
    }
  }

  return { hardDeleted, softDeleted, anonymized, skipped };
}
