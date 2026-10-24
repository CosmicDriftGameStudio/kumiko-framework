// Moves legacy tenant, tenant-membership and user streams onto the tenant their
// aggregate type now addresses (SYSTEM_TENANT_ID or the membership's payload tenant), then
// repairs the derived state (stale search docs, projection rows, index).
//
// There is no completion marker: every boot searches for legacy streams, so streams that
// older pods write during a rolling deploy are fixed on the next boot. The search only reads
// events of other tenants than the target (shared/stream-tenant-backfill.ts), which is cheap
// when nothing is left. Once the scan finds work a part writes a "derived-pending" row (a clean boot writes nothing); while it exists,
// rebuild and reindex run even if no stream moves, so a crash after the moves cannot leave
// stale rows behind. Failures are logged and retried on the next boot.
// A process that has no search adapter although the entity is searchable leaves the work to
// one that has: moving streams without cleaning the old buckets would orphan search docs.

import { backfillTenantStreamTenants } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { backfillUserStreamTenantsWithDerivedState } from "@cosmicdrift/kumiko-bundled-features/user";
import { resolveBaseDbAndSearchAdapter } from "@cosmicdrift/kumiko-framework/api";
import {
  type DbConnection,
  deleteMany,
  fetchOne,
  insertOne,
  listEventTenantIds,
  withSessionAdvisoryLock,
} from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { createEsOperationsTable, esOperationsTable } from "@cosmicdrift/kumiko-framework/es-ops";
import { runInSystemRowLevelSecurityScope } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import type { SearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import { type DatabaseWaitClock, waitUntilDatabaseReachable } from "./wait-for-database.ts";

export const STREAM_TENANT_BACKFILL_LOCK_KEY = 0x73_74_62_66; // 'stbf'

export type StreamBackfillPart = "user" | "tenant";

export function streamBackfillPendingId(part: StreamBackfillPart): string {
  return `stream-tenant-backfill:${part}:derived-pending`;
}

export type StreamBackfillPartOutcome =
  | "feature-missing"
  | "no-search-adapter"
  | "completed"
  | "failed";

export type StreamTenantBackfillOutcome = {
  readonly user: StreamBackfillPartOutcome;
  readonly tenant: StreamBackfillPartOutcome;
  readonly aggregatesMigrated: number;
};

type PartRun = {
  readonly failures: readonly BackfillFailure[];
  readonly aggregatesMigrated: number;
};
type BackfillFailure = {
  readonly aggregateId: string;
  readonly step: string;
  readonly error: string;
};
type Log = ReturnType<typeof createFallbackLogger>;

type StepDeps = {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly searchAdapter: SearchAdapter | undefined;
  readonly log: Log;
  readonly scanTenantIds: readonly string[];
};

export async function runStreamTenantBackfillOnBoot(opts: {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly extraContext: object;
  readonly processName: string;
  readonly databaseWait?: DatabaseWaitClock;
  readonly log?: Log;
}): Promise<StreamTenantBackfillOutcome> {
  const { db, registry, processName } = opts;
  const log = opts.log ?? createFallbackLogger("stream-tenant-backfill");
  const parts = (["user", "tenant"] as const).filter((part) => registry.features.has(part));
  const { searchAdapter } = resolveBaseDbAndSearchAdapter(opts.extraContext, registry);

  if (parts.length === 0) return outcomeOf(parts, {}, 0);

  return waitUntilDatabaseReachable(
    () =>
      runInSystemRowLevelSecurityScope(
        "stream tenant backfill moves streams across tenants",
        async () => {
          await createEsOperationsTable(db);
          return withSessionAdvisoryLock(db, STREAM_TENANT_BACKFILL_LOCK_KEY, async () => {
            const deps: StepDeps = {
              db,
              registry,
              searchAdapter,
              log,
              scanTenantIds: await listEventTenantIds(db),
            };
            const outcomes: Partial<Record<StreamBackfillPart, StreamBackfillPartOutcome>> = {};
            let migrated = 0;
            for (const part of parts) {
              const result = await runPart(part, deps);
              outcomes[part] = result.outcome;
              migrated += result.aggregatesMigrated;
            }
            return outcomeOf(parts, outcomes, migrated);
          });
        },
      ),
    { ...opts.databaseWait, processName, target: "database (stream tenant backfill)" },
  );
}

function outcomeOf(
  parts: readonly StreamBackfillPart[],
  outcomes: Partial<Record<StreamBackfillPart, StreamBackfillPartOutcome>>,
  aggregatesMigrated: number,
): StreamTenantBackfillOutcome {
  const of = (part: StreamBackfillPart): StreamBackfillPartOutcome =>
    parts.includes(part) ? (outcomes[part] ?? "completed") : "feature-missing";
  return { user: of("user"), tenant: of("tenant"), aggregatesMigrated };
}

async function operationExists(db: DbConnection, id: string): Promise<boolean> {
  return (await fetchOne(db, esOperationsTable, { id })) !== undefined;
}

async function runPart(
  part: StreamBackfillPart,
  deps: StepDeps,
): Promise<{ outcome: StreamBackfillPartOutcome; aggregatesMigrated: number }> {
  const { db, registry, searchAdapter, log } = deps;
  const entity = part === "user" ? "user" : "tenant";
  const searchable =
    registry.getSearchableFields(entity).length > 0 ||
    registry.getSearchPayloadExtensions(entity).length > 0;
  const blockedWithoutAdapter = searchable && !searchAdapter;
  const warnBlocked = () =>
    log.warn(
      `stream tenant backfill (${part}) has work but "${entity}" is searchable and this process has no search adapter; a process with one runs it`,
    );

  const pendingId = streamBackfillPendingId(part);
  const wasPending = await operationExists(db, pendingId);
  if (wasPending && blockedWithoutAdapter) {
    warnBlocked();
    return { outcome: "no-search-adapter", aggregatesMigrated: 0 };
  }

  // A clean boot writes nothing: the pending row appears only once the scan found work.
  let pendingExists = wasPending;
  let skipped = false;
  const onFirstCandidate = async (): Promise<"proceed" | "skip"> => {
    if (skipped || blockedWithoutAdapter) {
      if (!skipped) warnBlocked();
      skipped = true;
      return "skip";
    }
    if (!pendingExists) {
      await recordPending(db, pendingId);
      pendingExists = true;
    }
    return "proceed";
  };

  // A throw (transient connection error) reaches waitUntilDatabaseReachable; the pending row stays for the retry.
  const run = await runBackfill(part, deps, wasPending ? "always" : "if-moved", onFirstCandidate);
  if (skipped) return { outcome: "no-search-adapter", aggregatesMigrated: 0 };
  for (const failure of run.failures) {
    log.error(`stream tenant backfill (${part}) failed; it is retried on the next boot`, {
      aggregateId: failure.aggregateId,
      step: failure.step,
      error: failure.error,
    });
  }
  if (run.failures.length > 0) {
    // Moves that keep failing (a broken aggregate) must not force rebuild and reindex on every
    // boot: the pending row only guards the derived steps, which succeeded here.
    if (pendingExists && !run.failures.some(isDerivedStateFailure)) {
      await clearPending(db, pendingId);
    }
    return { outcome: "failed", aggregatesMigrated: run.aggregatesMigrated };
  }

  if (pendingExists) await clearPending(db, pendingId);
  if (run.aggregatesMigrated > 0) {
    log.info(`stream tenant backfill (${part}) moved streams`, {
      aggregatesMigrated: run.aggregatesMigrated,
    });
  }
  return { outcome: "completed", aggregatesMigrated: run.aggregatesMigrated };
}

// Step names of rebuildAndReindex in bundled-features/shared/stream-tenant-derived-state.ts.
function isDerivedStateFailure(failure: BackfillFailure): boolean {
  return failure.step === "rebuild" || failure.step === "reindex";
}

async function clearPending(db: DbConnection, pendingId: string): Promise<void> {
  await deleteMany(db, esOperationsTable, { id: pendingId });
}

async function recordPending(db: DbConnection, id: string): Promise<void> {
  await insertOne(db, esOperationsTable, {
    id,
    operationType: "stream-migration",
    durationMs: 0,
    appliedBy: "boot",
  });
}

async function runBackfill(
  part: StreamBackfillPart,
  deps: StepDeps,
  derived: "if-moved" | "always",
  onFirstCandidate: () => Promise<"proceed" | "skip">,
): Promise<PartRun> {
  const { db, registry, searchAdapter, scanTenantIds } = deps;
  const common = {
    db,
    registry,
    derived,
    onFirstCandidate,
    ...(searchAdapter && { searchAdapter }),
    scanTenantIds,
  };
  if (part === "user") {
    const result = await backfillUserStreamTenantsWithDerivedState(common);
    return { failures: result.failures, aggregatesMigrated: result.streams.aggregatesMigrated };
  }
  const result = await backfillTenantStreamTenants(common);
  return {
    failures: result.failures,
    aggregatesMigrated: result.tenants.aggregatesMigrated + result.memberships.aggregatesMigrated,
  };
}
