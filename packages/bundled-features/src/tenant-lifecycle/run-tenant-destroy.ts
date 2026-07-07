import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type Registry,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  append,
  loadAggregate,
  VersionConflictError,
} from "@cosmicdrift/kumiko-framework/event-store";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { tenantEntity, tenantTable } from "../tenant/schema/tenant";
import {
  TENANT_AGGREGATE_TYPE,
  TENANT_DESTRUCTION_COMPLETED_EVENT_QN,
  TENANT_DESTRUCTION_FAILED_EVENT_QN,
  TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_FAILED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_STARTED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT,
  TENANT_DESTRUCTION_STARTED_EVENT_SHORT,
} from "./constants";
import { type DestructionStageCtx, isDestructionPipelineComplete, pickNextStage } from "./stages";

const tenantCrud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

const FEATURE_PREFIX = "tenant-lifecycle:event:";

type StageEventName =
  | typeof TENANT_DESTRUCTION_STARTED_EVENT_SHORT
  | typeof TENANT_DESTRUCTION_STAGE_STARTED_EVENT_SHORT
  | typeof TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT
  | typeof TENANT_DESTRUCTION_STAGE_FAILED_EVENT_SHORT
  | typeof TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_SHORT;

function qualified(short: StageEventName): string {
  return `${FEATURE_PREFIX}${short}`;
}

function replayStageState(
  events: ReadonlyArray<{ type: string; payload: Record<string, unknown> }>,
): {
  completed: Set<string>;
  abandoned: Set<string>;
  attemptsByStage: Map<string, number>;
} {
  const completed = new Set<string>();
  const abandoned = new Set<string>();
  const attemptsByStage = new Map<string, number>();
  for (const event of events) {
    const payload = event.payload;
    const stage = String(payload["stage"] ?? "");
    if (event.type === qualified(TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT)) {
      completed.add(stage);
      continue;
    }
    if (event.type === qualified(TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_SHORT)) {
      abandoned.add(stage);
      continue;
    }
    if (event.type === qualified(TENANT_DESTRUCTION_STAGE_FAILED_EVENT_SHORT)) {
      const prev = attemptsByStage.get(stage) ?? 0;
      attemptsByStage.set(stage, Math.max(prev, Number(payload["attempts"] ?? prev + 1)));
    }
  }
  return { completed, abandoned, attemptsByStage };
}

function lastEventVersion(events: ReadonlyArray<{ version: number }>): number {
  const last = events.at(-1);
  return last?.version ?? 0;
}

function stageOutcomeRecorded(
  events: ReadonlyArray<{ type: string; payload: Record<string, unknown> }>,
  stageName: string,
  outcomeShort:
    | typeof TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT
    | typeof TENANT_DESTRUCTION_STAGE_FAILED_EVENT_SHORT
    | typeof TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_SHORT,
): boolean {
  return events.some(
    (event) => event.type === qualified(outcomeShort) && event.payload["stage"] === stageName,
  );
}

async function appendTenantStageEvent(
  db: DbRunner,
  tenantId: TenantId,
  type: string,
  payload: Record<string, unknown>,
  expectedVersion: number,
): Promise<void> {
  await append(db, {
    aggregateId: tenantId,
    aggregateType: TENANT_AGGREGATE_TYPE,
    tenantId,
    expectedVersion,
    type,
    payload,
    metadata: {
      userId: "system",
      requestId: `tenant-lifecycle:${type}`,
    },
  });
}

async function appendTenantStageEventIdempotent(
  db: DbRunner,
  tenantId: TenantId,
  type: string,
  payload: Record<string, unknown>,
  expectedVersion: number,
  alreadyRecorded: boolean,
): Promise<number> {
  if (alreadyRecorded) {
    const events = await loadAggregate(db, tenantId, tenantId);
    return lastEventVersion(events);
  }
  try {
    await appendTenantStageEvent(db, tenantId, type, payload, expectedVersion);
  } catch (err) {
    if (!(err instanceof VersionConflictError)) throw err;
    const events = await loadAggregate(db, tenantId, tenantId);
    const stage = String(payload["stage"] ?? "");
    if (stageOutcomeRecorded(events, stage, TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT)) {
      return lastEventVersion(events);
    }
    throw err;
  }
  const events = await loadAggregate(db, tenantId, tenantId);
  return lastEventVersion(events);
}

async function markTenantDestroyFailed(db: DbRunner, tenantId: TenantId): Promise<void> {
  const user = createSystemUser(tenantId);
  const scopedDb = createTenantDb(db, tenantId, "system");
  await tenantCrud.update(
    {
      id: tenantId,
      changes: { status: "destroyFailed" },
    },
    user,
    scopedDb,
    { skipOptimisticLock: true },
  );
}

async function haltPipelineOnAbandon(args: {
  readonly db: DbRunner;
  readonly tenantId: TenantId;
  readonly stage: string;
  readonly attempts: number;
  readonly error: string;
  readonly expectedVersion: number;
}): Promise<void> {
  const T = getTemporal();
  const failedAt = T.Now.instant();
  await appendTenantStageEvent(
    args.db,
    args.tenantId,
    qualified(TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_SHORT),
    { stage: args.stage, attempts: args.attempts, error: args.error },
    args.expectedVersion,
  );
  const eventsAfterAbandon = await loadAggregate(args.db, args.tenantId, args.tenantId);
  const versionAfterAbandon = lastEventVersion(eventsAfterAbandon);
  await appendTenantStageEvent(
    args.db,
    args.tenantId,
    TENANT_DESTRUCTION_FAILED_EVENT_QN,
    { stage: args.stage, error: args.error, failedAt: failedAt.toString() },
    versionAfterAbandon,
  );
  await markTenantDestroyFailed(args.db, args.tenantId);
}

async function maybeAppendDestructionCompleted(
  db: DbRunner,
  tenantId: TenantId,
  completed: ReadonlySet<string>,
): Promise<void> {
  if (!isDestructionPipelineComplete(completed)) {
    // skip: pipeline still has pending stages
    return;
  }
  const events = await loadAggregate(db, tenantId, tenantId);
  if (events.some((event) => event.type === TENANT_DESTRUCTION_COMPLETED_EVENT_QN)) {
    // skip: idempotent — completion event already recorded
    return;
  }
  const T = getTemporal();
  await appendTenantStageEvent(
    db,
    tenantId,
    TENANT_DESTRUCTION_COMPLETED_EVENT_QN,
    { destroyedAt: T.Now.instant().toString() },
    lastEventVersion(events),
  );
}

export async function runNextDestructionStage(args: {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  readonly log?: (message: string) => void;
}): Promise<{ readonly done: boolean; readonly error?: string; readonly halted?: boolean }> {
  const events = await loadAggregate(args.db, args.tenantId, args.tenantId);
  const { completed, abandoned, attemptsByStage } = replayStageState(events);

  if (abandoned.size > 0) {
    return { done: false, error: "pipeline_abandoned", halted: true };
  }

  const next = pickNextStage(completed, abandoned);
  if (!next) {
    await maybeAppendDestructionCompleted(args.db, args.tenantId, completed);
    return { done: isDestructionPipelineComplete(completed) };
  }

  const priorAttempts = attemptsByStage.get(next.name) ?? 0;
  const attempt = priorAttempts + 1;
  const ctx: DestructionStageCtx = {
    db: args.db,
    registry: args.registry,
    tenantId: args.tenantId,
    log: args.log,
  };

  let version = lastEventVersion(events);
  version = await appendTenantStageEventIdempotent(
    args.db,
    args.tenantId,
    qualified(TENANT_DESTRUCTION_STAGE_STARTED_EVENT_SHORT),
    { stage: next.name, attempts: attempt },
    version,
    stageOutcomeRecorded(events, next.name, TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT),
  );

  try {
    await next.run(ctx);
    version = await appendTenantStageEventIdempotent(
      args.db,
      args.tenantId,
      qualified(TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT),
      { stage: next.name, attempts: attempt },
      version,
      stageOutcomeRecorded(
        await loadAggregate(args.db, args.tenantId, args.tenantId),
        next.name,
        TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT,
      ),
    );

    const completedAfter = new Set([...completed, next.name]);
    await maybeAppendDestructionCompleted(args.db, args.tenantId, completedAfter);
    return { done: isDestructionPipelineComplete(completedAfter) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isFinal = attempt >= next.maxAttempts;
    if (isFinal) {
      await haltPipelineOnAbandon({
        db: args.db,
        tenantId: args.tenantId,
        stage: next.name,
        attempts: attempt,
        error: message,
        expectedVersion: version,
      });
      return { done: false, error: message, halted: true };
    }
    await appendTenantStageEvent(
      args.db,
      args.tenantId,
      qualified(TENANT_DESTRUCTION_STAGE_FAILED_EVENT_SHORT),
      { stage: next.name, attempts: attempt, error: message },
      version,
    );
    return { done: false, error: message };
  }
}

/** Cron entry: start destruction for tenants past grace, then advance stages. */
export async function runTenantDestructionSweep(args: {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly now?: Temporal.Instant;
}): Promise<{ readonly triggered: number; readonly advanced: number }> {
  const T = getTemporal();
  const now = args.now ?? T.Now.instant();
  const due = await selectMany<{ id: string }>(args.db, tenantTable, {
    status: "destroyRequested",
    gracePeriodEnd: { lte: now },
  });

  let triggered = 0;
  for (const row of due) {
    const tenantId = row.id as TenantId;
    const events = await loadAggregate(args.db, tenantId, tenantId);
    const version = lastEventVersion(events);
    await appendTenantStageEvent(
      args.db,
      tenantId,
      qualified(TENANT_DESTRUCTION_STARTED_EVENT_SHORT),
      { startedAt: now.toString() },
      version,
    );
    const user = createSystemUser(tenantId);
    const scopedDb = createTenantDb(args.db, tenantId, "system");
    await tenantCrud.update(
      {
        id: tenantId,
        changes: { status: "destroying", destroyStartedAt: now },
      },
      user,
      scopedDb,
      { skipOptimisticLock: true },
    );
    triggered++;
  }

  let advanced = 0;
  const destroying = await selectMany<{ id: string }>(args.db, tenantTable, {
    status: "destroying",
  });
  for (const row of destroying) {
    const result = await runNextDestructionStage({
      db: args.db,
      registry: args.registry,
      tenantId: row.id as TenantId,
    });
    if (!result.error && !result.halted) advanced++;
  }

  return { triggered, advanced };
}

export async function resolveTenantLifecycleGate(
  db: DbRunner,
  tenantId: TenantId,
): Promise<{ status: string; gracePeriodEnd: string | null } | null> {
  const rows = await selectMany<{ status: string; gracePeriodEnd: Temporal.Instant | null }>(
    db,
    tenantTable,
    { id: tenantId },
  );
  const row = rows[0];
  if (!row) return null;
  return {
    status: row.status,
    gracePeriodEnd: row.gracePeriodEnd?.toString() ?? null,
  };
}
