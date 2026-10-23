import type { DbConnection, DbTx } from "../db/connection.ts";
import { runInSavepoint, selectMany } from "../db/query.ts";
import { runInSystemRowLevelSecurityScope } from "../db/row-level-security-scope.ts";
import { hasTenantColumn } from "../db/tenant-db.ts";
import type {
  AggregateStreamHandle,
  AppendEventArgs,
  FetchForWritingArgs,
  HandlerContext,
  SessionUser,
} from "../engine/types/index.ts";
import {
  InternalError,
  memberResolutionReadOnlyDenied,
  VersionConflictError,
} from "../errors/index.ts";
import {
  archiveStream as archiveStreamHelper,
  isStreamArchived,
  restoreStream as restoreStreamHelper,
} from "../event-store/archive.ts";
import {
  IdempotentAppendConflictError as EventStoreIdempotentAppendConflictError,
  VersionConflictError as EventStoreVersionConflictError,
} from "../event-store/errors.ts";
import {
  loadAggregate,
  loadAggregateAsOf,
  loadAggregateForWriting,
  type StoredEvent,
} from "../event-store/event-store.ts";
import {
  effectiveSnapshotGeneration,
  type LoadAggregateWithSnapshotOptions,
  type LoadAggregateWithSnapshotResult,
  loadAggregateWithSnapshot,
  type SnapshotReducer,
  saveSnapshot,
} from "../event-store/snapshot.ts";
import { upcastStoredEvent, upcastStoredEvents } from "../event-store/upcaster.ts";
import { appendDomainEventCore } from "./append-event-core.ts";
import {
  type DispatchContext,
  isMemberResolutionPrincipal,
  resolveDbSource,
} from "./dispatch-shared.ts";
import type { HandlerContextScope } from "./handler-context-scope.ts";
import { createGatedProjectionReader, type ProjectionReader } from "./system-identity-switch.ts";
import { asTypedAppendEventFn } from "./typed-append-event.ts";

function requireDbSource(
  ctx: DispatchContext,
  tx: DbTx | undefined,
  surfaceCall: string,
): DbConnection | DbTx {
  const dbSource = resolveDbSource(ctx, tx);
  if (!dbSource) {
    throw new InternalError({
      message: `${surfaceCall} requires a database connection — none is configured.`,
    });
  }
  return dbSource;
}

// ctx.appendEvent — append a domain event onto a specific aggregate stream
// in the current tx, then fire matching inline projections. Core logic
// lives in appendDomainEventCore; this wrapper just locates dbSource +
// stringifies the SessionUser id for the shared helper.
async function appendDomainEvent(
  ctx: DispatchContext,
  args: AppendEventArgs & { readonly expectedVersion?: number },
  user: SessionUser,
  tx: DbTx | undefined,
  callerFeature: string | undefined,
): Promise<void> {
  // Sink behind every append surface, so a resolved member stays read-only even via fetchForWriting handles.
  if (isMemberResolutionPrincipal(user)) throw memberResolutionReadOnlyDenied();
  const { registry } = ctx;
  const dbSource = requireDbSource(ctx, tx, `ctx.appendEvent("${args.type}")`);
  await appendDomainEventCore(
    {
      registry,
      db: dbSource,
      tenantId: user.tenantId,
      userId: String(user.id),
      callSiteLabel: "ctx.appendEvent",
      callerFeature,
    },
    args,
  );
}

// Savepoint-scoped append: catches a losing writer's VersionConflictError
// without poisoning the rest of the handler's transaction. Postgres
// aborts the WHOLE transaction on a statement error
// (SQLSTATE 25P02 until rollback) even if the JS error is caught — runInSavepoint
// wraps the append in a real SAVEPOINT so only that nested scope rolls
// back on conflict, and subsequent statements in the outer tx (e.g. a
// dedup-anchor insert) still succeed. Use when a handler must react to
// losing a concurrent-append race instead of failing the whole write.
function buildTryAppendEvent(scope: HandlerContextScope) {
  const { type, user, tx, registry } = scope;
  return async (args: AppendEventArgs) => {
    if (!tx) {
      throw new InternalError({
        message: `ctx.tryAppendEvent("${args.type}") requires an active transaction — no tx is threaded through this call.`,
      });
    }
    try {
      const event = await runInSavepoint(tx, (sp) =>
        appendDomainEventCore(
          {
            registry,
            db: sp,
            tenantId: user.tenantId,
            userId: String(user.id),
            callSiteLabel: "ctx.tryAppendEvent",
            callerFeature: registry.getHandlerFeature(type),
          },
          args,
        ),
      );
      return { ok: true as const, event };
    } catch (e) {
      if (e instanceof EventStoreVersionConflictError) {
        return { ok: false as const, conflict: e };
      }
      if (e instanceof EventStoreIdempotentAppendConflictError) {
        return { ok: false as const, conflict: e };
      }
      throw e;
    }
  };
}

function buildFetchForWriting(scope: HandlerContextScope) {
  const { ctx, type, user, tx, registry } = scope;
  return async (args: FetchForWritingArgs): Promise<AggregateStreamHandle> => {
    const dbSource = requireDbSource(ctx, tx, `ctx.fetchForWriting("${args.aggregateId}")`);
    // Stream-version authoritative (same policy as CRUD executor + Block 0), read together
    // with the events so the pinned version covers exactly what the handler's rules saw.
    const { events: storedEvents, streamVersion: fetchedVersion } = await loadAggregateForWriting(
      dbSource,
      args.aggregateId,
      user.tenantId,
      { aggregateType: args.aggregateType },
    );
    const events = await upcastStoredEvents(storedEvents, registry.getEventUpcasters(), {
      db: dbSource,
      tenantId: user.tenantId,
    });

    // Optimistic concurrency: if the caller knows the version they
    // worked against (e.g. from a prior read-model row) and the stream
    // has moved on, fail fast before any downstream work.
    if (args.expectedVersion !== undefined && args.expectedVersion !== fetchedVersion) {
      throw new VersionConflictError({
        entityId: args.aggregateId,
        expectedVersion: args.expectedVersion,
        currentVersion: fetchedVersion,
      });
    }

    // Pinned into every append: a write landing between fetch and append
    // fails with VersionConflictError instead of stacking on a state the
    // caller's business rules never saw. Bumps per appendOne so consecutive
    // appends stay in order without re-reading the DB.
    let handleVersion = fetchedVersion;
    const appendOne = async (appendArgs: {
      readonly type: string;
      readonly payload: unknown;
    }): Promise<void> => {
      await appendDomainEvent(
        ctx,
        {
          aggregateId: args.aggregateId,
          aggregateType: args.aggregateType,
          type: appendArgs.type,
          payload: appendArgs.payload,
          expectedVersion: handleVersion,
        },
        user,
        tx,
        registry.getHandlerFeature(type),
      );
      handleVersion += 1;
    };

    return {
      events,
      get version() {
        return handleVersion;
      },
      appendOne,
      hasEvent: (type: string) => events.some((e) => e.type === type),
    };
  };
}

function buildLoadAggregate(scope: HandlerContextScope) {
  const { ctx, user, tx, registry } = scope;
  return async (
    aggregateId: string,
    loadOptions?: Parameters<HandlerContext["loadAggregate"]>[1],
  ): Promise<readonly StoredEvent[]> => {
    const dbSource = requireDbSource(ctx, tx, `ctx.loadAggregate("${aggregateId}")`);
    const events = loadOptions?.asOf
      ? await loadAggregateAsOf(dbSource, aggregateId, user.tenantId, loadOptions.asOf)
      : await loadAggregate(dbSource, aggregateId, user.tenantId, {
          ...(loadOptions?.atVersion !== undefined && { atVersion: loadOptions.atVersion }),
        });
    return upcastStoredEvents(events, registry.getEventUpcasters(), {
      db: dbSource,
      tenantId: user.tenantId,
    });
  };
}

function buildSnapshotAggregate(scope: HandlerContextScope) {
  const { ctx, user, tx, registry } = scope;
  return async (snapshotArgs: {
    readonly aggregateId: string;
    readonly aggregateType: string;
    readonly version: number;
    readonly state: Record<string, unknown>;
    readonly snapshotVersion?: number;
  }): Promise<void> => {
    const dbSource = requireDbSource(
      ctx,
      tx,
      `ctx.snapshotAggregate("${snapshotArgs.aggregateId}")`,
    );
    await saveSnapshot(dbSource, {
      aggregateId: snapshotArgs.aggregateId,
      tenantId: user.tenantId,
      aggregateType: snapshotArgs.aggregateType,
      version: snapshotArgs.version,
      state: snapshotArgs.state,
      snapshotVersion: effectiveSnapshotGeneration(
        snapshotArgs.snapshotVersion ?? 1,
        registry.getEntity(snapshotArgs.aggregateType)?.eventVersion,
      ),
    });
  };
}

function buildLoadAggregateWithSnapshot(scope: HandlerContextScope) {
  const { ctx, user, tx, registry } = scope;
  return async <TState extends Record<string, unknown>>(
    aggregateId: string,
    reducer: SnapshotReducer<TState>,
    initial: TState,
    loadOptions?: Omit<LoadAggregateWithSnapshotOptions, "upcastEvent" | "entityEventVersionOf">,
  ): Promise<LoadAggregateWithSnapshotResult<TState>> => {
    const dbSource = requireDbSource(ctx, tx, `ctx.loadAggregateWithSnapshot("${aggregateId}")`);
    // Upcaster-aware: pass an upcastEvent callback so loadAggregateWithSnapshot
    // walks every delta through the registered chain before invoking the
    // user's (sync) reducer. Async upcasters (DB-enrichment) are awaited
    // inside loadAggregateWithSnapshot — feature authors never see legacy
    // payload shapes regardless of which load path they chose.
    const upcasters = registry.getEventUpcasters();
    const upcastCtx = { db: dbSource, tenantId: user.tenantId };
    return loadAggregateWithSnapshot<TState>(
      dbSource,
      aggregateId,
      user.tenantId,
      reducer,
      initial,
      {
        ...loadOptions,
        entityEventVersionOf: (aggregateType) => registry.getEntity(aggregateType)?.eventVersion,
        upcastEvent: (event) => upcastStoredEvent(event, upcasters, upcastCtx), // @wrapper-known semantic-alias
      },
    );
  };
}

// queryProjection works against both single-stream and multi-stream
// projections. MSPs without a table cannot be queried — those are
// side-effect-only consumers (no state to read back).
function buildHandlerProjectionReader(scope: HandlerContextScope): ProjectionReader {
  const { ctx, type, user, tx, registry, hasIdentitySwitchGrant, identitySwitchAudit } = scope;
  const findProjectionTable = (qualifiedName: string) =>
    registry.getAllProjections().get(qualifiedName)?.table ??
    registry.getAllMultiStreamProjections().get(qualifiedName)?.table;
  const ungatedQueryProjection: ProjectionReader = async <T = Record<string, unknown>>(
    qualifiedName: string,
    queryOptions?: { readonly unsafeAllTenants?: boolean },
  ): Promise<readonly T[]> => {
    const projTable = findProjectionTable(qualifiedName);
    if (!projTable) {
      const singleNames = [...registry.getAllProjections().keys()];
      const mspNames = [...registry.getAllMultiStreamProjections().keys()].filter(
        (n) => registry.getAllMultiStreamProjections().get(n)?.table,
      );
      const all = [...singleNames, ...mspNames];
      throw new InternalError({
        message:
          `ctx.queryProjection("${qualifiedName}") — projection not registered, or it is a ` +
          `table-less MSP (side-effect-only). Known queryable projections: ${all.join(", ") || "(none)"}`,
      });
    }
    const dbSource = requireDbSource(ctx, tx, `ctx.queryProjection("${qualifiedName}")`);
    const allTenants = queryOptions?.unsafeAllTenants === true;
    const where =
      hasTenantColumn(projTable) && !allTenants ? { tenantId: user.tenantId } : undefined;
    const read = () => selectMany<Record<string, unknown>>(dbSource, projTable, where);
    const rows = await (allTenants ? runInSystemRowLevelSecurityScope(read) : read());
    return rows as readonly T[]; // @cast-boundary engine-payload
  };
  return createGatedProjectionReader(
    `handler "${type}"`,
    hasIdentitySwitchGrant,
    ungatedQueryProjection,
    identitySwitchAudit,
    (qualifiedName) => {
      const projTable = findProjectionTable(qualifiedName);
      // Unknown projection: keep the grant check first, the ungated reader reports the real error.
      return projTable === undefined || hasTenantColumn(projTable);
    },
  );
}

export function buildEventStoreFacet(scope: HandlerContextScope) {
  const { ctx, type, user, tx, registry } = scope;
  return {
    // Strict + unsafe share the same runtime — only the type-surface
    // differs. The strict signature is what's exposed to typed callers;
    // unsafe is the explicit escape-hatch for runtime-pluggable events.
    appendEvent: asTypedAppendEventFn(async (args: AppendEventArgs) => {
      await appendDomainEvent(ctx, args, user, tx, registry.getHandlerFeature(type));
    }),
    unsafeAppendEvent: async (args: AppendEventArgs) => {
      await appendDomainEvent(ctx, args, user, tx, registry.getHandlerFeature(type));
    },
    tryAppendEvent: buildTryAppendEvent(scope),
    fetchForWriting: buildFetchForWriting(scope),
    loadAggregate: buildLoadAggregate(scope),
    archiveStream: async (
      aggregateId: string,
      archiveArgs: { readonly aggregateType: string; readonly reason?: string },
    ): Promise<void> => {
      const dbSource = requireDbSource(ctx, tx, `ctx.archiveStream("${aggregateId}")`);
      await archiveStreamHelper(dbSource, {
        tenantId: user.tenantId,
        aggregateId,
        aggregateType: archiveArgs.aggregateType,
        archivedBy: user.id,
        reason: archiveArgs.reason,
      });
    },
    restoreStream: async (aggregateId: string): Promise<void> => {
      const dbSource = requireDbSource(ctx, tx, `ctx.restoreStream("${aggregateId}")`);
      await restoreStreamHelper(dbSource, user.tenantId, aggregateId);
    },
    isStreamArchived: async (aggregateId: string): Promise<boolean> => {
      const dbSource = requireDbSource(ctx, tx, `ctx.isStreamArchived("${aggregateId}")`);
      return isStreamArchived(dbSource, user.tenantId, aggregateId);
    },
    snapshotAggregate: buildSnapshotAggregate(scope),
    loadAggregateWithSnapshot: buildLoadAggregateWithSnapshot(scope),
    queryProjection: buildHandlerProjectionReader(scope),
  };
}
