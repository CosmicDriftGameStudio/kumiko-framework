/// <reference types="temporal-polyfill/global" preserve="true" />
import type { KumikoEventTypeMap } from "./event-type-map.ts";
import type { HandlerLifecycle } from "./handler-context-services.ts";
import type {
  ActiveMembershipResult,
  AggregateStreamHandle,
  AppendEventFn,
  FetchForWritingArgs,
  HandlerContext,
  MemberReader,
  SessionUser,
  TryAppendEventFn,
  UnsafeAppendEventFn,
  WriteResult,
} from "./handlers.ts";
import type { TenantId } from "./identifiers.ts";
import type { Logger } from "./logger.ts";
import type { Meter, MetricsHandle, Tracer } from "./observability/index.ts";
import type { TenantDb, UncheckedSystemDb } from "./tenant-db-types.ts";

/**
 * `ctx.db` plus `outsideTransaction`: the same tenant scoping, but never bound to the handler's
 * tx, so writes through it survive a rollback. `undefined` only in the denial phases
 * (member-resolution, before-transaction) and in platform-metering tenant mode; narrow with
 * `hasOutsideTransactionDb(ctx)` or take it via `requireOutsideTransactionDb(ctx)`
 * (`@cosmicdrift/kumiko-framework/db`). For atomic multi-statement writes outside the tx use
 * `runInOwnTransaction(ctx.db.outsideTransaction, fn)`; `fn` must not touch rows the handler's own
 * tx has locked. For r.systemScope() handlers `ctx.db` is a fail-closed guard; use
 * `systemDb.outsideTransaction`.
 */
export type HandlerDb = TenantDb & { readonly outsideTransaction: TenantDb | undefined };

/** Event-store surface of a handler. TMap propagates the strict event-type-map through `append`. */
export type HandlerEvents<TMap extends object = KumikoEventTypeMap> = {
  /**
   * Default append: a typed domain event on one aggregate stream in the current tx. The runtime
   * bumps the stream version and fires matching projections in the same transaction. A version
   * conflict throws and poisons the transaction.
   */
  readonly append: AppendEventFn<TMap>;
  /**
   * Untyped append (`payload: unknown`) with the same runtime as `append`. Only for
   * migrations and upcasters, where the event type is not knowable at compile time.
   */
  readonly unsafeAppend: UnsafeAppendEventFn;
  /**
   * Optimistic append: runs in a savepoint and returns a version conflict as a result instead of
   * throwing, so the handler can continue after losing a race on the same aggregate stream.
   */
  readonly tryAppend: TryAppendEventFn;
  // Marten FetchForWriting equivalent: load the current stream, optionally
  // enforce expectedVersion, and get a handle that appends further events
  // onto that stream without re-specifying aggregateId/aggregateType.
  // Fails fast with VersionConflictError when expectedVersion doesn't
  // match — the write-handler never touches state it didn't expect.
  readonly fetchForWriting: (args: FetchForWritingArgs) => Promise<AggregateStreamHandle>;
  // Load the full stream of events for an aggregate, tenant-scoped to the
  // current user. Events pass through the registered upcaster chain, so the
  // payloads returned match the current schema shape regardless of when
  // they were written. `options.asOf` restricts to events whose createdAt is
  // ≤ the given timestamp (point-in-time query); `options.atVersion` reads only
  // the event at that stream version (upcast, tenant-scoped).
  readonly load: (
    aggregateId: string,
    options?:
      | { readonly asOf?: Temporal.Instant; readonly atVersion?: never }
      | { readonly atVersion?: number; readonly asOf?: never },
  ) => Promise<readonly import("./event-store-types.ts").StoredEvent[]>;
  // Marten-aligned stream lifecycle. Archived streams become read-only:
  // events.append throws ArchivedStreamError, events.load returns []
  // (pass { includeArchived: true } on the low-level loaders to override).
  // restore reopens a stream; aggregate-level lifecycle states like
  // "closed" stay in the domain events, not the archive flag.
  readonly archive: (
    aggregateId: string,
    args: { readonly aggregateType: string; readonly reason?: string },
  ) => Promise<void>;
  readonly restore: (aggregateId: string) => Promise<void>;
  readonly isArchived: (aggregateId: string) => Promise<boolean>;
  // Cache the current state of an aggregate as a snapshot, alongside the version it reflects.
  // The snapshot policy (every N events, every M minutes, on-demand) stays with the feature —
  // or pass { snapshotEvery } to loadWithSnapshot for the common case. Snapshots are a perf
  // optimisation; the event log remains the source of truth.
  readonly snapshot: (args: {
    readonly aggregateId: string;
    readonly aggregateType: string;
    readonly version: number;
    readonly state: Record<string, unknown>;
    // Reducer-shape generation stamped onto the snapshot (default 1) — see
    // loadWithSnapshot's snapshotVersion option.
    readonly snapshotVersion?: number;
  }) => Promise<void>;
  // Snapshot-aware rehydrate. Loads the latest snapshot (if any), runs the registered upcaster
  // chain on every delta event, and folds them onto the snapshot state with the caller's reducer.
  // Archived streams behave like events.load: empty result with version=0, not an exception.
  readonly loadWithSnapshot: <TState extends Record<string, unknown>>(
    aggregateId: string,
    reducer: import("./snapshot-types.ts").SnapshotReducer<TState>,
    initial: TState,
    options?: Omit<import("./snapshot-types.ts").LoadAggregateWithSnapshotOptions, "upcastEvent">,
  ) => Promise<import("./snapshot-types.ts").LoadAggregateWithSnapshotResult<TState>>;
};

/**
 * Cross-feature bridge: `query`/`write` run the target handler AS THE CURRENT USER, sharing the
 * active tx + afterCommit queue. `queryAs`/`writeAs` switch identity; any target other than the
 * caller itself (or a subset of its roles) needs r.systemScope(), a job, or an escapeHatch.
 */
export type HandlerDispatch = {
  readonly query: (qn: string, payload: unknown) => Promise<unknown>;
  readonly queryAs: (user: SessionUser, qn: string, payload: unknown) => Promise<unknown>;
  readonly write: (qn: string, payload: unknown) => Promise<WriteResult>;
  readonly writeAs: (user: SessionUser, qn: string, payload: unknown) => Promise<WriteResult>;
  // Read-only principal without `sid`; needs the same grant as a SYSTEM queryAs
  // (membership is resolved as SYSTEM), cached per handler invocation or job run.
  readonly queryAsMember: MemberReader;
  // Read rows from a registered projection table, tenant-scoped to the current user. Auto-applies
  // the tenant_id filter when the projection table has a tenant_id column; { unsafeAllTenants: true }
  // opts out but requires r.systemScope() or a declared escapeHatch. Unknown projection name throws.
  readonly queryProjection: <T = Record<string, unknown>>(
    qualifiedName: string,
    options?: { readonly unsafeAllTenants?: boolean },
  ) => Promise<readonly T[]>;
};

export type HandlerAuth = {
  // Resolves every registered r.authClaims() hook against `user` and returns the merged claim
  // record (keys auto-prefixed with the feature name). Pass-through to the dispatcher's single impl.
  readonly resolveClaims: (user: SessionUser) => Promise<Record<string, unknown>>;
  // Membership check for interactive sign-in paths (login, MFA completion, tenant switch).
  readonly resolveActiveMembership: (
    userId: string,
    tenantId: TenantId,
  ) => Promise<ActiveMembershipResult>;
};

export type HandlerObservability = {
  // Always populated: the app's logger when wired, else a fallback logger.
  readonly log: Logger;
  // Always populated — Noop when no observability provider is configured.
  readonly tracer: Tracer;
  readonly metrics: MetricsHandle;
  // For shared/library code: binds to `featureName` instead of the dispatching handler's own
  // feature. Unlike `metrics`, an unregistered metric name here is a silent no-op, not a throw.
  readonly metricsFor: (featureName: string) => MetricsHandle;
  // Raw OTel meter for infrastructure such as createTenantDb; feature metrics go through `metrics`.
  readonly meter?: Meter;
};

// Own-feature events only; runs in its own transaction together with inline projections, userId = systemUser.
export type JobEvents = Pick<HandlerEvents, "append">;

// `write` runs as the job's systemUser; `writeAs`/`queryAs` take an explicit identity. They throw
// until JobRunner.attachDispatcher() has run. `queryAsMember`'s tenant is the job's resolved tenant.
export type JobDispatch = Pick<HandlerDispatch, "write" | "writeAs" | "queryAs" | "queryAsMember">;

export type JobObservability = Pick<HandlerObservability, "log" | "metricsFor" | "meter">;

type PhaseWithoutTransaction = "events" | "notify" | "dispatch" | "lifecycle";

/**
 * ctx of `reserveBeforeTransaction`: nothing bound to the not-yet-open transaction. Reservations
 * write on purpose through `db.outsideTransaction`, so it stays.
 */
export type ReservationContext<TMap extends object = KumikoEventTypeMap> = Omit<
  HandlerContext<TMap>,
  PhaseWithoutTransaction
> & {
  readonly dispatch: Omit<HandlerDispatch, "write" | "writeAs">;
  readonly lifecycle: Omit<HandlerLifecycle, "afterCommit" | "afterRollback">;
};

/** ctx of `beforeTransaction`: external I/O and reads only, so the outside-transaction handles are gone too. */
export type BeforeTransactionContext<TMap extends object = KumikoEventTypeMap> = Omit<
  ReservationContext<TMap>,
  "db" | "systemDb"
> & {
  readonly db: TenantDb & { readonly outsideTransaction: undefined };
  readonly systemDb?: Omit<UncheckedSystemDb, "outsideTransaction"> & {
    readonly outsideTransaction: undefined;
  };
};
