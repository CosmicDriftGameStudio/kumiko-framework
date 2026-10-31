/// <reference types="temporal-polyfill/global" preserve="true" />
import type { DbRunner, TenantDb, WhereObject } from "@cosmicdrift/kumiko-framework/db";
import {
  createEventStoreExecutor,
  createTenantDb,
  fetchOne,
  selectMany,
  WritePurposes,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type EscapeHatchAuditSink,
  type Registry,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  append,
  loadAggregate,
  type StoredEvent,
  VersionConflictError,
} from "@cosmicdrift/kumiko-framework/event-store";
import type { FileProviderResolver } from "@cosmicdrift/kumiko-framework/files";
import type { Logger } from "@cosmicdrift/kumiko-framework/logging";
import type { SearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { tenantHasBlockDeleteRows } from "../data-retention/index.ts";
import type { TenantDestructionHoldProvider } from "../shared/index.ts";
import { type TenantLifecycleStatus, tenantEntity, tenantTable } from "../tenant/index.ts";
import {
  DESTRUCTION_STAGE_MAX_PENDING_MS,
  DESTRUCTION_STAGE_MIN_SLICE_MS,
  DESTRUCTION_STAGE_TICK_BUDGET_MS,
  TENANT_AGGREGATE_TYPE,
  TENANT_DESTRUCTION_COMPLETED_EVENT_QN,
  TENANT_DESTRUCTION_FAILED_EVENT_QN,
  TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_FAILED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_PROGRESSED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_STARTED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT,
  TENANT_DESTRUCTION_STARTED_EVENT_SHORT,
} from "./constants.ts";
import { invalidateTenantLifecycleGate, TEARDOWN_GATE_SETTLE_MS } from "./lifecycle-gate.ts";
import {
  type DestructionStage,
  type DestructionStageCtx,
  isDestructionPipelineComplete,
  pickNextStage,
} from "./stages.ts";

const tenantCrud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

const FEATURE_PREFIX = "tenant-lifecycle:event:";

type StageEventName =
  | typeof TENANT_DESTRUCTION_STARTED_EVENT_SHORT
  | typeof TENANT_DESTRUCTION_STAGE_STARTED_EVENT_SHORT
  | typeof TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT
  | typeof TENANT_DESTRUCTION_STAGE_FAILED_EVENT_SHORT
  | typeof TENANT_DESTRUCTION_STAGE_PROGRESSED_EVENT_SHORT
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

// A progressed event as the stage's latest lifecycle event means the previous
// tick handed over mid-stage; its stage-started is still the open one.
function isStageContinuation(
  events: ReadonlyArray<{ type: string; payload: Record<string, unknown> }>,
  stageName: string,
): boolean {
  const stageEventTypes = new Set([
    qualified(TENANT_DESTRUCTION_STAGE_STARTED_EVENT_SHORT),
    qualified(TENANT_DESTRUCTION_STAGE_PROGRESSED_EVENT_SHORT),
    qualified(TENANT_DESTRUCTION_STAGE_FAILED_EVENT_SHORT),
  ]);
  const lastStageEvent = events.findLast(
    (event) => stageEventTypes.has(event.type) && event.payload["stage"] === stageName,
  );
  return lastStageEvent?.type === qualified(TENANT_DESTRUCTION_STAGE_PROGRESSED_EVENT_SHORT);
}

// Stage-started events written before startedAt existed fall back to their append time.
function currentAttemptStartedAt(
  events: readonly StoredEvent[],
  stageName: string,
): Temporal.Instant | undefined {
  const started = events.findLast(
    (event) =>
      event.type === qualified(TENANT_DESTRUCTION_STAGE_STARTED_EVENT_SHORT) &&
      event.payload["stage"] === stageName,
  );
  if (!started) return undefined;
  const startedAt = started.payload["startedAt"];
  return typeof startedAt === "string" ? getTemporal().Instant.from(startedAt) : started.createdAt;
}

function isPendingWindowOpen(
  events: readonly StoredEvent[],
  stageName: string,
  now: Temporal.Instant,
): boolean {
  const startedAt = currentAttemptStartedAt(events, stageName);
  return (
    startedAt !== undefined &&
    now.epochMilliseconds - startedAt.epochMilliseconds <= DESTRUCTION_STAGE_MAX_PENDING_MS
  );
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
    tenantId: SYSTEM_TENANT_ID,
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
    const events = await loadAggregate(db, tenantId, SYSTEM_TENANT_ID);
    return lastEventVersion(events);
  }
  try {
    await appendTenantStageEvent(db, tenantId, type, payload, expectedVersion);
  } catch (err) {
    if (!(err instanceof VersionConflictError)) throw err;
    const events = await loadAggregate(db, tenantId, SYSTEM_TENANT_ID);
    const stage = String(payload["stage"] ?? "");
    if (stageOutcomeRecorded(events, stage, TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT)) {
      // skip: idempotent retry — stage already recorded before version conflict
      return lastEventVersion(events);
    }
    throw err;
  }
  const events = await loadAggregate(db, tenantId, SYSTEM_TENANT_ID);
  return lastEventVersion(events);
}

async function setTenantLifecycleStatus(
  db: DbRunner,
  tenantId: TenantId,
  status: TenantLifecycleStatus,
): Promise<void> {
  const user = createSystemUser(tenantId);
  const scopedDb = createTenantDb({
    db,
    tenantId,
    mode: "system",
    reason: "tenant destruction updates the tenant being destroyed, outside its request scope",
  });
  await tenantCrud.update(
    {
      id: tenantId,
      changes: { status },
    },
    user,
    scopedDb,
    { skipOptimisticLock: true, writePurpose: WritePurposes.erasure },
  );
  invalidateTenantLifecycleGate(tenantId);
}

// True while the tenant still owns rows whose blockDelete retention has not run out.
async function tenantOwnsRetentionHeldRows(args: {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  readonly now: Temporal.Instant;
}): Promise<boolean> {
  if (!args.registry.features.has("data-retention")) return false;
  return await tenantHasBlockDeleteRows(args);
}

async function haltPipelineOnAbandon(args: {
  readonly db: DbRunner;
  readonly tenantId: TenantId;
  readonly stage: string;
  readonly attempts: number;
  readonly error: string;
}): Promise<void> {
  const T = getTemporal();
  const failedAt = T.Now.instant();
  // Reload fresh instead of trusting a caller-supplied version: the failed
  // stage's own run() may have appended to this same aggregate (e.g.
  // tombstoneTenantRow's tenantCrud.update) before throwing, so any version
  // captured earlier in the pipeline is stale and would VersionConflict here.
  const eventsBeforeAbandon = await loadAggregate(args.db, args.tenantId, SYSTEM_TENANT_ID);
  await appendTenantStageEvent(
    args.db,
    args.tenantId,
    qualified(TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_SHORT),
    { stage: args.stage, attempts: args.attempts, error: args.error },
    lastEventVersion(eventsBeforeAbandon),
  );
  const eventsAfterAbandon = await loadAggregate(args.db, args.tenantId, SYSTEM_TENANT_ID);
  const versionAfterAbandon = lastEventVersion(eventsAfterAbandon);
  await appendTenantStageEvent(
    args.db,
    args.tenantId,
    TENANT_DESTRUCTION_FAILED_EVENT_QN,
    { stage: args.stage, error: args.error, failedAt: failedAt.toString() },
    versionAfterAbandon,
  );
  await setTenantLifecycleStatus(args.db, args.tenantId, "destroyFailed");
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
  const events = await loadAggregate(db, tenantId, SYSTEM_TENANT_ID);
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

type StageTickResult = {
  readonly done: boolean;
  readonly error?: string;
  readonly halted?: boolean;
  readonly progressed?: boolean;
  readonly pending?: boolean;
  readonly held?: boolean;
};

// `version` differs per caller: the catch path appends against the pre-run
// version, the no-progress path against the version reloaded after run().
async function recordFailedStageAttempt(args: {
  readonly db: DbRunner;
  readonly tenantId: TenantId;
  readonly stage: DestructionStage;
  readonly attempt: number;
  readonly error: string;
  readonly version: number;
}): Promise<StageTickResult> {
  if (args.attempt >= args.stage.maxAttempts) {
    await haltPipelineOnAbandon({
      db: args.db,
      tenantId: args.tenantId,
      stage: args.stage.name,
      attempts: args.attempt,
      error: args.error,
    });
    return { done: false, error: args.error, halted: true };
  }
  await appendTenantStageEvent(
    args.db,
    args.tenantId,
    qualified(TENANT_DESTRUCTION_STAGE_FAILED_EVENT_SHORT),
    { stage: args.stage.name, attempts: args.attempt, error: args.error },
    args.version,
  );
  return { done: false, error: args.error };
}

// A tick that neither finishes nor processes anything would otherwise loop forever,
// because progressed events do not count as attempts. A pending tick still appends a
// progressed event: without it the next tick would open a new stage-started and the
// pending window would never close.
async function recordIdleStageTick(args: {
  readonly db: DbRunner;
  readonly tenantId: TenantId;
  readonly stage: DestructionStage;
  readonly attempt: number;
  readonly pending: boolean;
  readonly events: readonly StoredEvent[];
  readonly now: Temporal.Instant;
}): Promise<StageTickResult> {
  if (args.pending && isPendingWindowOpen(args.events, args.stage.name, args.now)) {
    await appendTenantStageEvent(
      args.db,
      args.tenantId,
      qualified(TENANT_DESTRUCTION_STAGE_PROGRESSED_EVENT_SHORT),
      { stage: args.stage.name, attempts: args.attempt, processed: 0, pending: true },
      lastEventVersion(args.events),
    );
    return { done: false, pending: true };
  }
  return await recordFailedStageAttempt({
    db: args.db,
    tenantId: args.tenantId,
    stage: args.stage,
    attempt: args.attempt,
    error: args.pending
      ? `stage "${args.stage.name}" still pending after ${DESTRUCTION_STAGE_MAX_PENDING_MS / 60_000} min`
      : `stage "${args.stage.name}" made no progress`,
    version: lastEventVersion(args.events),
  });
}

export async function runNextDestructionStage(args: {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  readonly log?: (message: string) => void;
  readonly fileProviderResolver?: FileProviderResolver;
  readonly searchAdapter?: SearchAdapter;
  readonly escapeHatchAuditSink?: EscapeHatchAuditSink;
  readonly escapeHatchAuditLog?: Logger;
  readonly actor?: string;
  readonly deadlineAt?: number;
  readonly now?: Temporal.Instant;
}): Promise<StageTickResult> {
  const now = args.now ?? getTemporal().Now.instant();
  const events = await loadAggregate(args.db, args.tenantId, SYSTEM_TENANT_ID);
  const { completed, abandoned, attemptsByStage } = replayStageState(events);

  if (abandoned.size > 0) {
    return { done: false, error: "pipeline_abandoned", halted: true };
  }

  const next = pickNextStage(completed, abandoned);
  if (!next) {
    await maybeAppendDestructionCompleted(args.db, args.tenantId, completed);
    return { done: isDestructionPipelineComplete(completed) };
  }

  // Parking is no stage attempt: no stage-started event, no attempt count, no failure.
  if (
    next.name === "tenant-row" &&
    (await tenantOwnsRetentionHeldRows({
      db: args.db,
      registry: args.registry,
      tenantId: args.tenantId,
      now,
    }))
  ) {
    await setTenantLifecycleStatus(args.db, args.tenantId, "destroyHeld");
    return { done: false, held: true };
  }

  const priorAttempts = attemptsByStage.get(next.name) ?? 0;
  const attempt = priorAttempts + 1;
  const ctx: DestructionStageCtx = {
    db: args.db,
    registry: args.registry,
    tenantId: args.tenantId,
    log: args.log,
    fileProviderResolver: args.fileProviderResolver,
    searchAdapter: args.searchAdapter,
    escapeHatchAuditSink: args.escapeHatchAuditSink,
    escapeHatchAuditLog: args.escapeHatchAuditLog,
    actor: args.actor,
    deadlineAt: args.deadlineAt ?? Date.now() + DESTRUCTION_STAGE_TICK_BUDGET_MS,
    now,
  };

  let version = lastEventVersion(events);
  if (!isStageContinuation(events, next.name)) {
    version = await appendTenantStageEventIdempotent(
      args.db,
      args.tenantId,
      qualified(TENANT_DESTRUCTION_STAGE_STARTED_EVENT_SHORT),
      { stage: next.name, attempts: attempt, startedAt: now.toString() },
      version,
      stageOutcomeRecorded(events, next.name, TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT),
    );
  }

  try {
    const outcome = await next.run(ctx);
    // next.run() may itself have appended events to this aggregate (e.g.
    // tombstoneTenantRow updates the tenant row on the same stream) — reload
    // the version fresh instead of trusting the pre-run `version`, or this
    // append throws VersionConflictError on every stage whose run() writes.
    const eventsAfterRun = await loadAggregate(args.db, args.tenantId, SYSTEM_TENANT_ID);
    if (!outcome.done && outcome.processed === 0) {
      return await recordIdleStageTick({
        db: args.db,
        tenantId: args.tenantId,
        stage: next,
        attempt,
        pending: outcome.pending === true,
        events: eventsAfterRun,
        now,
      });
    }
    if (!outcome.done) {
      await appendTenantStageEvent(
        args.db,
        args.tenantId,
        qualified(TENANT_DESTRUCTION_STAGE_PROGRESSED_EVENT_SHORT),
        { stage: next.name, attempts: attempt, processed: outcome.processed },
        lastEventVersion(eventsAfterRun),
      );
      return { done: false, progressed: true };
    }
    version = await appendTenantStageEventIdempotent(
      args.db,
      args.tenantId,
      qualified(TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT),
      { stage: next.name, attempts: attempt },
      lastEventVersion(eventsAfterRun),
      stageOutcomeRecorded(
        eventsAfterRun,
        next.name,
        TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT,
      ),
    );

    const completedAfter = new Set([...completed, next.name]);
    await maybeAppendDestructionCompleted(args.db, args.tenantId, completedAfter);
    return { done: isDestructionPipelineComplete(completedAfter) };
  } catch (err) {
    return await recordFailedStageAttempt({
      db: args.db,
      tenantId: args.tenantId,
      stage: next,
      attempt,
      error: err instanceof Error ? err.message : String(err),
      version,
    });
  }
}

function destroyRequestedDueWhere(now: Temporal.Instant): WhereObject {
  return {
    status: "destroyRequested",
    gracePeriodEnd: { lte: now.subtract({ milliseconds: TEARDOWN_GATE_SETTLE_MS }) },
  };
}

const destroyingWhere: WhereObject = { status: "destroying" };

export async function hasTenantDestructionWork(
  reads: Pick<TenantDb, "count">,
  now: Temporal.Instant,
): Promise<boolean> {
  const [due, destroying] = await Promise.all([
    reads.count(tenantTable, destroyRequestedDueWhere(now)),
    reads.count(tenantTable, destroyingWhere),
  ]);
  return due > 0 || destroying > 0;
}

// A destroyHeld tenant is not sweep work: the daily retention run releases it once its last held row
// is gone, and the sweep then runs tenant-row as a fresh first attempt.
export const tenantDestructionHoldProvider: TenantDestructionHoldProvider = {
  async isParked({ db, tenantId }) {
    return (await tenantStatusOf(db, tenantId)) === "destroyHeld";
  },
  async releaseIfFree({ db, registry, tenantId, now }) {
    if ((await tenantStatusOf(db, tenantId)) !== "destroyHeld") return false;
    if (await tenantOwnsRetentionHeldRows({ db, registry, tenantId, now })) return false;
    await setTenantLifecycleStatus(db, tenantId, "destroying");
    return true;
  },
};

async function tenantStatusOf(db: DbRunner, tenantId: TenantId): Promise<string | undefined> {
  const row = await fetchOne<{ status: string }>(db, tenantTable, { id: tenantId });
  return row?.status;
}

/** Cron entry: start destruction for tenants past grace, then advance stages. */
export async function runTenantDestructionSweep(args: {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly now?: Temporal.Instant;
  readonly log?: (message: string) => void;
  readonly fileProviderResolver?: FileProviderResolver;
  readonly searchAdapter?: SearchAdapter;
  readonly escapeHatchAuditSink?: EscapeHatchAuditSink;
  readonly escapeHatchAuditLog?: Logger;
  readonly actor?: string;
}): Promise<{ readonly triggered: number; readonly advanced: number }> {
  const T = getTemporal();
  const now = args.now ?? T.Now.instant();
  const due = await selectMany<{ id: string }>(args.db, tenantTable, destroyRequestedDueWhere(now));

  let triggered = 0;
  for (const row of due) {
    const tenantId = row.id;
    const events = await loadAggregate(args.db, tenantId, SYSTEM_TENANT_ID);
    const version = lastEventVersion(events);
    const user = createSystemUser(tenantId);
    const scopedDb = createTenantDb({
      db: args.db,
      tenantId,
      mode: "system",
      reason: "tenant destruction updates the tenant being destroyed, outside its request scope",
    });
    // Version-guarded (no skipOptimisticLock): a concurrent cancel-destruction
    // between the `due` select above and this write also appends to the same
    // tenant stream, so an unguarded overwrite here would silently revert the
    // cancellation. A version conflict means we lost that race — skip, the
    // tenant is no longer due and the next tick re-evaluates it.
    const result = await tenantCrud.update(
      { id: tenantId, version, changes: { status: "destroying", destroyStartedAt: now } },
      user,
      scopedDb,
      { writePurpose: WritePurposes.erasure },
    );
    if (!result.isSuccess) continue;
    invalidateTenantLifecycleGate(tenantId);
    await appendTenantStageEvent(
      args.db,
      tenantId,
      qualified(TENANT_DESTRUCTION_STARTED_EVENT_SHORT),
      { startedAt: now.toString() },
      version + 1,
    );
    triggered++;
  }

  let advanced = 0;
  const destroying = await selectMany<{ id: string }>(args.db, tenantTable, destroyingWhere);
  // One budget per sweep tick, split evenly so a large tenant cannot eat the
  // window and starve the ones behind it. Each slice starts when its tenant
  // starts: anchoring to a shared tick deadline would hand tenants after an
  // overrun a zero slice, and a no-progress stage counts as a failed attempt.
  const sliceMs = Math.max(
    DESTRUCTION_STAGE_MIN_SLICE_MS,
    DESTRUCTION_STAGE_TICK_BUDGET_MS / Math.max(1, destroying.length),
  );
  for (const row of destroying) {
    const tenantDeadlineAt = Date.now() + sliceMs;
    try {
      const result = await runNextDestructionStage({
        deadlineAt: tenantDeadlineAt,
        now,
        db: args.db,
        registry: args.registry,
        tenantId: row.id,
        log: args.log,
        fileProviderResolver: args.fileProviderResolver,
        searchAdapter: args.searchAdapter,
        escapeHatchAuditSink: args.escapeHatchAuditSink,
        escapeHatchAuditLog: args.escapeHatchAuditLog,
        actor: args.actor,
      });
      if (!result.error && !result.halted && !result.held) advanced++;
    } catch (err) {
      // Isolate the failure to this tenant — an uncaught throw here must not
      // abort the whole sweep tick and starve every other "destroying" tenant
      // of progress. The tenant stays "destroying" and the next tick retries.
      args.log?.(
        `[tenant-lifecycle] sweep: unexpected error advancing tenant ${row.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return { triggered, advanced };
}

export { invalidateTenantLifecycleGate, resolveTenantLifecycleGate } from "./lifecycle-gate.ts";
