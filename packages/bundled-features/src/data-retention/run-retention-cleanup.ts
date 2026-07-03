// Retention-Cleanup-Runner (S2.D2b) — pure Function, vom retention-cleanup-Cron
// pro fan-out-Tenant aufgerufen.
//
// Iteriert alle implicit-Entity-Projektionen, loest pro Entity die effektive
// Retention-Policy (3-Schicht-Resolver, siehe resolver.ts) und wendet die
// Strategy auf Rows an deren reference-Timestamp aelter als der keepFor-Cutoff
// ist:
//
//   - hardDelete  → executor.forget pro Row (Event → rebuild-safe hard purge)
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
  type WhereObject,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type EntityId,
  type Registry,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
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
}

export interface RetentionCleanupSkip {
  readonly entityName: string;
  readonly reason:
    | "missing_reference_column"
    | "missing_softdelete_columns"
    | "missing_anonymize_fields";
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
        hardDeleted += await purgeMatchingRows(db, proj.table, where, batchLimit, (id) =>
          executor.forget({ id }, systemUser, tdb),
        );
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
