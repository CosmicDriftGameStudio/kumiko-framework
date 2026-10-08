// Boot-time PII backfill for kumiko_events: when a field gains a PII annotation
// after events were already stored, the rebuild copies payloads unchanged, so
// old events stay plaintext until they are re-encrypted in place. This runs the
// batch primitive from backfill-pii.ts once per annotation state (fingerprint),
// then cheap catch-up passes, and rebuilds the projections whose source events
// changed (including multi-stream projections with their own table) so
// ciphertext and blind-index columns get materialized.

import { createHash } from "node:crypto";
import { configuredEventPiiCatalog } from "../crypto/event-pii.js";
import { isLocalKeyKmsAdapter } from "../crypto/kms-adapter.js";
import { configuredPiiSubjectKms } from "../crypto/pii-field-encryption.js";
import { collectPiiSubjectFields } from "../crypto/subject-resolver.js";
import type { DbConnection, DbRunner } from "../db/connection.js";
import { bigint, instant, table as pgTable, sql, text } from "../db/dialect.js";
import { extractTableName } from "../db/index.js";
import { acquireNamespacedAdvisoryLock } from "../db/queries/advisory-lock.js";
import {
  backfillEventPiiEncryptionBatch,
  type PiiBackfillBatchResult,
  type PiiBackfillFailure,
  type PiiBackfillScanCache,
} from "../db/queries/backfill-pii.js";
import {
  type PiiBackfillStateRow,
  persistPiiBackfillState,
  readPiiBackfillState,
} from "../db/queries/pii-backfill-state.js";
import { upsertOnConflict } from "../db/query.js";
import { tableExists } from "../db/schema-inspection.js";
import type { Registry } from "../engine/types/index.js";
import type { Logger } from "../logging/types.js";
import { createFallbackLogger } from "../logging/utils.js";
import { unsafePushTables } from "../stack/index.js";
import {
  clearPendingRebuilds,
  createPendingRebuildsTable,
  listPendingRebuildRows,
  pendingRebuildsTable,
  rebuildProjectionOrMultiStream,
} from "./pending-rebuilds.js";
import { buildProjectionTableIndex } from "./projection-table-index.js";

const PII_EVENT_BACKFILL_LOCK_NAMESPACE = 0x70_69_69_62; // 'piib'
const PII_EVENT_BACKFILL_LOCK_KEY = "pii-event-backfill";
const PII_BACKFILL_MIGRATION_PREFIX = "pii-backfill:";
const DEFAULT_BATCH_SIZE = 500;
const MAX_LOGGED_FAILURE_IDS = 50;

// Events can commit with an id lower than an already-scanned one (late commits),
// and old pods in a rolling deploy keep writing the newly annotated field as
// plaintext. The transformation is idempotent, so overlap only costs reads.
const CATCH_UP_OVERLAP_EVENT_IDS = 1000n;

export const piiBackfillStateTable = pgTable("kumiko_pii_backfill_state", {
  fingerprint: text("fingerprint").primaryKey(),
  cursorEventId: bigint("cursor_event_id", { mode: "bigint" }).notNull().default(0),
  completedAt: instant("completed_at", { precision: 3 }),
  updatedAt: instant("updated_at", { precision: 3 }).notNull().default(sql`now()`),
});

export async function createPiiBackfillStateTable(db: DbConnection): Promise<void> {
  // skip: table already exists — boot runs on every replica
  if (await tableExists(db, "public.kumiko_pii_backfill_state")) return;
  await unsafePushTables(db, { kumikoPiiBackfillState: piiBackfillStateTable });
}

// Replicas boot concurrently: two of them can both pass the tableExists gate and
// one CREATE then fails. The table existing afterwards means the other won.
async function ensureInfraTable(
  db: DbConnection,
  tableName: string,
  create: (db: DbConnection) => Promise<void>,
): Promise<void> {
  try {
    await create(db);
  } catch (e) {
    if (!(await tableExists(db, `public.${tableName}`))) throw e;
  }
}

export function piiAnnotationEntries(registry: Registry): readonly string[] {
  const entries: string[] = [];
  for (const [name, entity] of registry.getAllEntities()) {
    for (const field of collectPiiSubjectFields(entity)) entries.push(`entity:${name}.${field}`);
  }
  for (const [eventType, fields] of configuredEventPiiCatalog()) {
    for (const field of Object.keys(fields)) entries.push(`event:${eventType}.${field}`);
  }
  return entries.sort();
}

export function piiAnnotationFingerprint(registry: Registry): string {
  return createHash("sha256").update(piiAnnotationEntries(registry).join("\n")).digest("hex");
}

export type PiiEventBackfillOptions = {
  readonly signal?: AbortSignal;
  readonly batchSize?: number;
  readonly logger?: Pick<Logger, "error"> & Partial<Pick<Logger, "warn" | "debug">>;
};

export type PiiRebuildRun = {
  readonly rebuilt: readonly { readonly projection: string; readonly eventsProcessed: number }[];
  // Stay queued and are retried on the next boot.
  readonly failed: readonly { readonly projection: string; readonly error: string }[];
  // Queued by this backfill but without a projection in this process; left queued.
  readonly skippedTables: readonly string[];
};

export type PiiEventBackfillResult =
  | { readonly status: "skipped"; readonly reason: "no_kms" | "no_pii" }
  | {
      readonly status: "ran";
      readonly mode: "full" | "catch-up";
      readonly aborted: boolean;
      readonly scannedEvents: number;
      readonly updatedEvents: number;
      readonly encryptedFields: number;
      readonly erasedFields: number;
      readonly failures: readonly PiiBackfillFailure[];
      readonly queuedTables: readonly string[];
      readonly rebuild: PiiRebuildRun | null;
    };

async function queueRebuildTables(
  db: DbRunner,
  tableNames: readonly string[],
  migrationId: string,
): Promise<void> {
  for (const tableName of tableNames) {
    await upsertOnConflict(
      db,
      pendingRebuildsTable,
      { tableName, migrationId },
      { conflictKeys: ["tableName"], update: { migrationId } },
    );
  }
}

function affectedProjectionTables(
  registry: Registry,
  touchedAggregateTypes: ReadonlySet<string>,
  touchedEventTypes: ReadonlySet<string>,
): readonly string[] {
  const tables = new Set<string>();
  for (const [name, def] of registry.getAllProjections()) {
    const sources = [
      ...(Array.isArray(def.source) ? def.source : [def.source]),
      ...(def.extraSources ?? []),
    ];
    const isAffected =
      sources.some((source) => touchedAggregateTypes.has(source)) ||
      Object.keys(def.apply).some((eventType) => touchedEventTypes.has(eventType));
    if (isAffected) tables.add(extractTableName(def.table, `pii-event-backfill(${name})`));
  }
  // MSP apply gets the raw event payloads, so their tables hold plaintext until rebuilt.
  for (const [name, def] of registry.getAllMultiStreamProjections()) {
    if (def.table === undefined) continue;
    if (Object.keys(def.apply).some((eventType) => touchedEventTypes.has(eventType))) {
      tables.add(extractTableName(def.table, `pii-event-backfill(${name})`));
    }
  }
  return [...tables];
}

type BatchStep = {
  readonly batch: PiiBackfillBatchResult;
  readonly tables: readonly string[];
};

type RunProgress = {
  scanCursor: bigint;
  failureSeen: boolean;
  readonly scanCache: PiiBackfillScanCache;
  readonly totals: {
    scannedEvents: number;
    updatedEvents: number;
    encryptedFields: number;
    erasedFields: number;
  };
  readonly failures: PiiBackfillFailure[];
  readonly queuedTables: Set<string>;
};

type RunContext = {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly fingerprint: string;
  readonly migrationId: string;
  readonly mode: "full" | "catch-up";
  readonly batchSize: number;
};

function initialScanCursor(state: PiiBackfillStateRow | null): {
  mode: "full" | "catch-up";
  scanCursor: bigint;
} {
  const cursor = BigInt(state?.cursor ?? "0");
  if (state?.completed !== true) return { mode: "full", scanCursor: cursor };
  return {
    mode: "catch-up",
    scanCursor: cursor > CATCH_UP_OVERLAP_EVENT_IDS ? cursor - CATCH_UP_OVERLAP_EVENT_IDS : 0n,
  };
}

// One transaction per batch: the advisory lock serializes pods, and the payload
// is re-read inside it so a value is never encrypted twice and two backfills
// never mint the same DEK. Returns null when another pod already finished a full run.
async function runOneBatch(ctx: RunContext, progress: RunProgress): Promise<BatchStep | null> {
  return ctx.db.begin(async (tx: DbRunner) => {
    await acquireNamespacedAdvisoryLock(
      tx,
      PII_EVENT_BACKFILL_LOCK_NAMESPACE,
      PII_EVENT_BACKFILL_LOCK_KEY,
    );
    const state = await readPiiBackfillState(tx, ctx.fingerprint);
    if (ctx.mode === "full" && state?.completed === true) return null;
    const startCursor =
      ctx.mode === "full" && state
        ? maxBigInt(progress.scanCursor, BigInt(state.cursor))
        : progress.scanCursor;

    const batch = await backfillEventPiiEncryptionBatch(tx, ctx.registry, {
      afterEventId: startCursor,
      batchSize: ctx.batchSize,
      resolveOwnerFromProjection: true,
      scanCache: progress.scanCache,
    });

    const batchTouchedEventTypes = new Set(batch.touchedEventTypes);
    const tables =
      batch.updatedEvents > 0
        ? affectedProjectionTables(
            ctx.registry,
            new Set(batch.touchedAggregateTypes),
            batchTouchedEventTypes,
          )
        : [];
    if (tables.length > 0) await queueRebuildTables(tx, tables, ctx.migrationId);

    if (!progress.failureSeen) {
      const completesRun = batch.scannedAll && batch.failures.length === 0;
      await persistPiiBackfillState(
        tx,
        ctx.fingerprint,
        persistableCursor(batch, startCursor),
        completesRun,
      );
    }
    return { batch, tables };
  });
}

function recordBatch(progress: RunProgress, step: BatchStep): void {
  const { batch } = step;
  progress.totals.scannedEvents += batch.scannedEvents;
  progress.totals.updatedEvents += batch.updatedEvents;
  progress.totals.encryptedFields += batch.encryptedFields;
  progress.totals.erasedFields += batch.erasedFields;
  progress.failures.push(...batch.failures);
  for (const table of step.tables) progress.queuedTables.add(table);
  if (batch.failures.length > 0) progress.failureSeen = true;
}

// Returns true when the run was aborted between batches.
async function scanAllBatches(
  ctx: RunContext,
  progress: RunProgress,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  for (;;) {
    if (signal?.aborted) return true;
    const step = await runOneBatch(ctx, progress);
    if (step === null) return false;
    recordBatch(progress, step);
    if (step.batch.lastEventId === null || step.batch.scannedAll) return false;
    progress.scanCursor = BigInt(step.batch.lastEventId);
  }
}

function reportRunOutcome(
  log: ReturnType<typeof createFallbackLogger>,
  progress: RunProgress,
): void {
  if (progress.failures.length > 0) {
    log.error(
      `${progress.failures.length} event(s) could not be PII-encrypted and will be retried on the next boot; ` +
        "every boot rescans from the first failed event until it is fixed, or erased via " +
        "backfillEventPiiEncryption(..., { eraseUnresolvableSubjects: true }) for unresolvable subjects",
      {
        failureCount: progress.failures.length,
        eventIds: progress.failures.slice(0, MAX_LOGGED_FAILURE_IDS).map((f) => f.eventId),
      },
    );
  }
}

export async function runPiiEventBackfill(
  db: DbConnection,
  registry: Registry,
  options: PiiEventBackfillOptions = {},
): Promise<PiiEventBackfillResult> {
  const log = createFallbackLogger("pii-event-backfill", options.logger);
  const kms = configuredPiiSubjectKms();
  if (!kms || !isLocalKeyKmsAdapter(kms)) return { status: "skipped", reason: "no_kms" };
  if (piiAnnotationEntries(registry).length === 0) {
    return { status: "skipped", reason: "no_pii" };
  }

  const fingerprint = piiAnnotationFingerprint(registry);
  await ensureInfraTable(db, "kumiko_pii_backfill_state", createPiiBackfillStateTable);
  await ensureInfraTable(db, "kumiko_pending_rebuilds", createPendingRebuildsTable);

  const { mode, scanCursor } = initialScanCursor(await readPiiBackfillState(db, fingerprint));
  const ctx: RunContext = {
    db,
    registry,
    fingerprint,
    // The per-run suffix keeps a peer replica's re-queue of the same table (new
    // migration_id via the upsert) from being deleted by this run's clear.
    migrationId: `${PII_BACKFILL_MIGRATION_PREFIX}${fingerprint.slice(0, 12)}:${crypto.randomUUID()}`,
    mode,
    batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
  };
  const progress: RunProgress = {
    scanCursor,
    failureSeen: false,
    scanCache: {},
    totals: { scannedEvents: 0, updatedEvents: 0, encryptedFields: 0, erasedFields: 0 },
    failures: [],
    queuedTables: new Set(),
  };

  const aborted = await scanAllBatches(ctx, progress, options.signal);
  reportRunOutcome(log, progress);

  const rebuild = aborted ? null : await rebuildQueuedTables(db, registry, options.signal, log);
  const queuedTables = [...progress.queuedTables];
  log.debug("PII event backfill finished", {
    mode,
    aborted,
    ...progress.totals,
    failureCount: progress.failures.length,
    queuedTables,
  });
  return {
    status: "ran",
    mode,
    aborted,
    ...progress.totals,
    failures: progress.failures,
    queuedTables,
    rebuild,
  };
}

// Never advance past a failed event so the next boot retries it.
function persistableCursor(batch: PiiBackfillBatchResult, startCursor: bigint): bigint {
  if (batch.firstFailedEventId !== null) {
    const beforeFailure = BigInt(batch.firstFailedEventId) - 1n;
    return beforeFailure > startCursor ? beforeFailure : startCursor;
  }
  return batch.lastEventId === null ? startCursor : BigInt(batch.lastEventId);
}

function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

// Only our own queue rows: runPendingRebuilds would drain the whole queue and
// silently clear entries this process cannot map (a worker with a narrower
// feature set would swallow rebuilds queued by the API pod or by schema apply).
async function rebuildQueuedTables(
  db: DbConnection,
  registry: Registry,
  signal: AbortSignal | undefined,
  log: ReturnType<typeof createFallbackLogger>,
): Promise<PiiRebuildRun | null> {
  const ownRows = (await listPendingRebuildRows(db)).filter((row) =>
    row.migrationId.startsWith(PII_BACKFILL_MIGRATION_PREFIX),
  );
  if (ownRows.length === 0) return null;

  const tableToProjection = buildProjectionTableIndex(registry);
  const rowsByProjection = new Map<string, (typeof ownRows)[number][]>();
  const skippedTables: string[] = [];
  for (const row of ownRows) {
    const projection = tableToProjection.get(row.tableName);
    if (projection === undefined) {
      skippedTables.push(row.tableName);
      continue;
    }
    rowsByProjection.set(projection, [...(rowsByProjection.get(projection) ?? []), row]);
  }
  if (skippedTables.length > 0) {
    log.warn(
      "Queued tables have no projection in this process and stay queued for a process that mounts them",
      { tables: skippedTables },
    );
  }

  const rebuilt: { projection: string; eventsProcessed: number }[] = [];
  const failed: { projection: string; error: string }[] = [];
  for (const [projection, rows] of rowsByProjection) {
    if (signal?.aborted) break;
    try {
      const result = await rebuildProjectionOrMultiStream(projection, {
        db,
        registry,
        ...(signal && { signal }),
      });
      await clearPendingRebuilds(db, rows);
      rebuilt.push({ projection, eventsProcessed: result.eventsProcessed });
    } catch (e) {
      failed.push({ projection, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (failed.length > 0) {
    log.error(
      "Projection rebuild after PII backfill failed; tables stay queued and are retried on the next boot",
      { failed },
    );
  }
  return { rebuilt, failed, skippedTables };
}
