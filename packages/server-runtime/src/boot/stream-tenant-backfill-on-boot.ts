// Moves legacy tenant, tenant-membership and user streams onto the tenant their
// aggregate type now addresses (SYSTEM_TENANT_ID or the membership's payload tenant), then
// repairs the derived state (stale search docs, projection rows, index).
//
// Completion is a marker row in kumiko_es_operations. A part with a marker costs one
// primary-key lookup and nothing else. Before its first move a part writes a
// "derived-pending" row; while that row exists, rebuild and reindex run even if no stream
// moves, so a crash after the moves cannot leave stale rows behind. The marker is only written
// after a run without failures; failures are logged and retried on the next boot.
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

export const SKIP_STREAM_TENANT_BACKFILL_ENV = "KUMIKO_SKIP_STREAM_TENANT_BACKFILL";
export const STREAM_TENANT_BACKFILL_LOCK_KEY = 0x73_74_62_66; // 'stbf'

export type StreamBackfillPart = "user" | "tenant";

export function streamBackfillMarkerId(part: StreamBackfillPart): string {
  return `stream-tenant-backfill:${part}`;
}
export function streamBackfillPendingId(part: StreamBackfillPart): string {
  return `${streamBackfillMarkerId(part)}:derived-pending`;
}

export type StreamBackfillPartOutcome =
  | "feature-missing"
  | "no-search-adapter"
  | "marker-hit"
  | "completed"
  | "failed";

export type StreamTenantBackfillOutcome = {
  readonly skippedByEnv: boolean;
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
  readonly envSource: Readonly<Record<string, string | undefined>>;
  readonly processName: string;
  readonly databaseWait?: DatabaseWaitClock;
  readonly log?: Log;
}): Promise<StreamTenantBackfillOutcome> {
  const { db, registry, envSource, processName } = opts;
  const skipped: StreamTenantBackfillOutcome = {
    skippedByEnv: true,
    user: "marker-hit",
    tenant: "marker-hit",
    aggregatesMigrated: 0,
  };
  if (envSource[SKIP_STREAM_TENANT_BACKFILL_ENV] === "1") {
    // skip: operator opted out via KUMIKO_SKIP_STREAM_TENANT_BACKFILL
    return skipped;
  }
  const log = opts.log ?? createFallbackLogger("stream-tenant-backfill");
  const parts = (["user", "tenant"] as const).filter((part) => registry.features.has(part));
  const { searchAdapter } = resolveBaseDbAndSearchAdapter(opts.extraContext, registry);

  return waitUntilDatabaseReachable(
    () =>
      runInSystemRowLevelSecurityScope(
        "stream tenant backfill moves streams across tenants",
        async () => {
          await createEsOperationsTable(db);
          if ((await Promise.all(parts.map((part) => markerExists(db, part)))).every(Boolean)) {
            return outcomeOf(parts, {}, 0);
          }
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
    parts.includes(part) ? (outcomes[part] ?? "marker-hit") : "feature-missing";
  return { skippedByEnv: false, user: of("user"), tenant: of("tenant"), aggregatesMigrated };
}

async function markerExists(db: DbConnection, part: StreamBackfillPart): Promise<boolean> {
  return await operationExists(db, streamBackfillMarkerId(part));
}

async function operationExists(db: DbConnection, id: string): Promise<boolean> {
  return (await fetchOne(db, esOperationsTable, { id })) !== undefined;
}

async function runPart(
  part: StreamBackfillPart,
  deps: StepDeps,
): Promise<{ outcome: StreamBackfillPartOutcome; aggregatesMigrated: number }> {
  const { db, registry, searchAdapter, log } = deps;
  // Re-check under the lock: a parallel boot may have finished the part meanwhile.
  if (await markerExists(db, part)) return { outcome: "marker-hit", aggregatesMigrated: 0 };
  const entity = part === "user" ? "user" : "tenant";
  const searchable =
    registry.getSearchableFields(entity).length > 0 ||
    registry.getSearchPayloadExtensions(entity).length > 0;
  if (searchable && !searchAdapter) {
    log.warn(
      `stream tenant backfill (${part}) skipped: "${entity}" is searchable but this process has no search adapter; a process with one runs it`,
    );
    return { outcome: "no-search-adapter", aggregatesMigrated: 0 };
  }

  const started = Date.now();
  const pendingId = streamBackfillPendingId(part);
  const wasPending = await operationExists(db, pendingId);
  if (!wasPending) await recordOperation(db, pendingId, started);
  const derived = wasPending ? "always" : "if-moved";

  // A throw (transient connection error) reaches waitUntilDatabaseReachable; the pending row stays for the retry.
  const run = await runBackfill(part, deps, derived);
  for (const failure of run.failures) {
    log.error(`stream tenant backfill (${part}) failed; it will be retried on the next boot`, {
      aggregateId: failure.aggregateId,
      step: failure.step,
      error: failure.error,
    });
  }
  if (run.failures.length > 0) {
    // Moves that keep failing (a broken aggregate) must not force rebuild and reindex on every
    // boot: the pending row only guards the derived steps, which succeeded here.
    if (!run.failures.some(isDerivedStateFailure)) await clearPending(db, pendingId);
    return { outcome: "failed", aggregatesMigrated: run.aggregatesMigrated };
  }

  await recordOperation(db, streamBackfillMarkerId(part), started);
  await clearPending(db, pendingId);
  log.info(`stream tenant backfill (${part}) completed`, {
    aggregatesMigrated: run.aggregatesMigrated,
  });
  return { outcome: "completed", aggregatesMigrated: run.aggregatesMigrated };
}

// Step names of rebuildAndReindex in bundled-features/shared/stream-tenant-derived-state.ts.
function isDerivedStateFailure(failure: BackfillFailure): boolean {
  return failure.step === "rebuild" || failure.step === "reindex";
}

async function clearPending(db: DbConnection, pendingId: string): Promise<void> {
  await deleteMany(db, esOperationsTable, { id: pendingId });
}

async function recordOperation(db: DbConnection, id: string, startedAtMs: number): Promise<void> {
  await insertOne(db, esOperationsTable, {
    id,
    operationType: "stream-migration",
    durationMs: Date.now() - startedAtMs,
    appliedBy: "boot",
  });
}

async function runBackfill(
  part: StreamBackfillPart,
  deps: StepDeps,
  derived: "if-moved" | "always",
): Promise<PartRun> {
  const { db, registry, searchAdapter, scanTenantIds } = deps;
  const common = {
    db,
    registry,
    derived,
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
