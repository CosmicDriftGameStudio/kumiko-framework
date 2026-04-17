import type { Redis } from "ioredis";
import type { ZodType } from "zod";
import type { DbConnection } from "../../db/connection";
import type { TenantDb } from "../../db/tenant-db";
import type { Logger } from "../../logging/types";
import type { Meter, MetricsHandle, Tracer } from "../../observability/types";
import type { EntityCache } from "../../pipeline/entity-cache";
import type { SearchAdapter } from "../../search/types";

// --- Access ---

// AccessRule is DEFAULT-DENY: a handler without an access rule is not reachable.
// To grant access, set one of:
//   - { roles: ["Admin", ...] }   — role-based allowlist (empty array denies everyone)
//   - { openToAll: true }         — any authenticated user may call (still requires a valid JWT)
export type AccessRule = { readonly roles: readonly string[] } | { readonly openToAll: true };

// --- Pipeline User ---

export type SessionUser = {
  // UUID-string so user.id threads through the event-store (aggregate-id) and
  // the projection tables (uuid PK) without casts. Auth middleware reads the
  // JWT `sub` claim as a string; legacy integer ids were a pre-ES artefact.
  readonly id: string;
  readonly tenantId: TenantId;
  readonly roles: readonly string[];
  // App-specific identity facts baked into the JWT at login time.
  // Populated by `r.authClaims()` hooks (not yet implemented — see the
  // auth-claims design note in docs/plans). Reserved here so the type shape
  // is stable when the hook system lands.
  readonly claims?: Readonly<Record<string, unknown>>;
};

// --- Handler Events ---

export type WriteEvent<TPayload = unknown> = {
  readonly type: string;
  readonly payload: TPayload;
  readonly user: SessionUser;
};

export type QueryEvent<TPayload = unknown> = {
  readonly type: string;
  readonly payload: TPayload;
  readonly user: SessionUser;
};

// --- Handler Results ---

import type { WriteErrorInfo } from "../../errors/write-error-info";

export type WriteResult<TData = unknown> =
  | { readonly isSuccess: true; readonly data: TData }
  | { readonly isSuccess: false; readonly error: WriteErrorInfo };

// --- Context Types ---

import type { TenantId } from "@kumiko/framework/engine";
// Forward import: Registry is in feature.ts (circular type import — fine in TS)
import type { Registry } from "./feature";

// Minimal interface for job event triggers (framework-owned, concrete type in jobs/)
export type JobRunnerRef = {
  handleEvent(
    eventName: string,
    payload: Record<string, unknown>,
    user?: SessionUser,
  ): Promise<void>;
};

// Priority levels for notifications
export type NotifyPriority = "critical" | "normal" | "low";

// Options passed to a NotifyFn / DeliveryService.notify. Defined here so the
// framework side and the concrete delivery implementation can't drift apart.
export type NotifyOptions = {
  readonly to?: string | readonly string[] | { readonly tenant: TenantId };
  readonly route?: Readonly<Record<string, string>>;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly priority?: NotifyPriority;
  // Opt-in dedup. Same key within 24h = single delivery. Use when a handler
  // can be replayed (webhook retry, user double-click) and you don't want
  // the notification to fire twice.
  readonly idempotencyKey?: string;
};

// Minimal interface for delivery notifications (concrete type in core-features/delivery)
export type NotifyFn = (notificationType: string, options: NotifyOptions) => Promise<void>;

// Factory that produces a bound NotifyFn for a specific user+tenant
// Concrete implementation in core-features/delivery (cross-package boundary)
export type NotifyFactory = (user: SessionUser, tenantId: TenantId) => NotifyFn;

// Shared optional fields across all execution contexts
type SharedContextFields = {
  readonly redis?: Redis;
  readonly jobRunner?: JobRunnerRef;
  readonly configResolver?: unknown; // Typed in core-features (cross-package boundary)
  readonly searchAdapter?: SearchAdapter;
  readonly entityCache?: EntityCache;
  readonly notify?: NotifyFn;
  readonly _notifyFactory?: NotifyFactory;
  // Observability: optional at the outer boundary, always populated by the
  // time a handler receives its ctx (Noop fallback when no provider is
  // configured, so handler code can call ctx.tracer/ctx.metrics without
  // defensive checks).
  readonly tracer?: Tracer;
  readonly meter?: Meter;
};

// All optional — used at pipeline/system boundaries.
// `db` is a DbConnection at the outer boundary (server/stack) and a TenantDb
// once a HandlerContext has been built — hooks receive the HandlerContext as
// AppContext, so the union keeps that assignment straightforward.
export type AppContext = SharedContextFields & {
  readonly db?: DbConnection | TenantDb;
  readonly registry?: Registry;
  readonly systemUser?: SessionUser;
  readonly log?: Logger;
  readonly triggeredBy?: { readonly id: string; readonly tenantId: TenantId } | null;
  readonly _userId?: string | undefined;
  readonly _handlerType?: string | undefined;
};

// Handler execution: db (tenant-scoped) + registry guaranteed.
//
// Cross-feature bridge:
//   ctx.query / ctx.write run the target handler AS THE CURRENT USER,
//   sharing the active tx + afterCommit queue. Field-access filters apply.
//   ctx.queryAs / ctx.writeAs switch identity (e.g. SYSTEM for privileged
//   lookups like "find user by email for auth" — system reads aren't filtered
//   by field-access read rules).
//
// The design: handlers are the contract between features. Feature A requires
// Feature B and talks to it through B's registered handlers — never through
// direct imports of B's tables or internal types.
export type HandlerContext = SharedContextFields & {
  readonly db: TenantDb;
  readonly registry: Registry;
  readonly systemUser?: SessionUser;
  readonly log?: Logger;
  readonly triggeredBy?: { readonly id: string; readonly tenantId: TenantId } | null;
  readonly _userId?: string | undefined;
  readonly _handlerType?: string | undefined;

  readonly query: (qn: string, payload: unknown) => Promise<unknown>;
  readonly queryAs: (user: SessionUser, qn: string, payload: unknown) => Promise<unknown>;
  readonly write: (qn: string, payload: unknown) => Promise<WriteResult>;
  readonly writeAs: (user: SessionUser, qn: string, payload: unknown) => Promise<WriteResult>;

  // Emit an event into the transactional outbox. The row is INSERTed inside
  // the current transaction — it only becomes visible after commit. A poller
  // then publishes it at-least-once. Feature authors call this; they don't
  // see the outbox machinery.
  readonly emit: (qn: string, payload: unknown) => Promise<void>;

  // Append a domain event to a specific aggregate stream in the current tx.
  // Marten-aligned: every event belongs to exactly one aggregate. The runtime
  // reads the current stream version, bumps it, and fires projections that
  // match the event type in the same transaction.
  //
  // Unlike `emit` — which writes to a synthetic pub/sub stream — `appendEvent`
  // targets a real aggregate and carries forward the stream's version lineage.
  // Use it when a write-handler wants to record a domain event alongside the
  // auto-generated CRUD events (e.g. "invoice.approved" on the same invoice
  // stream that already carries "invoice.created" + "invoice.updated").
  readonly appendEvent: (args: AppendEventArgs) => Promise<void>;

  // Load the full stream of events for an aggregate, tenant-scoped to the
  // current user. Events pass through the registered upcaster chain, so the
  // payloads returned match the current schema shape regardless of when
  // they were written. Use inside a queryHandler to expose Marten-style
  // AggregateStreamAsync: hand the events to a reducer and return the
  // derived state (live aggregation).
  //
  // `options.asOf` restricts to events whose createdAt is ≤ the given
  // timestamp — the point-in-time / "what did this aggregate look like
  // yesterday" query.
  readonly loadAggregate: (
    aggregateId: string,
    options?: { readonly asOf?: Date },
  ) => Promise<readonly import("../../event-store").StoredEvent[]>;

  // Marten-aligned stream lifecycle. Archived streams become read-only:
  // ctx.appendEvent throws ArchivedStreamError, ctx.loadAggregate returns []
  // (pass { includeArchived: true } on the low-level loaders to override).
  // restoreStream reopens a stream; aggregate-level lifecycle states like
  // "closed" stay in the domain events, not the archive flag.
  readonly archiveStream: (
    aggregateId: string,
    args: { readonly aggregateType: string; readonly reason?: string },
  ) => Promise<void>;
  readonly restoreStream: (aggregateId: string) => Promise<void>;
  readonly isStreamArchived: (aggregateId: string) => Promise<boolean>;

  // Read rows from a registered projection table, tenant-scoped to the
  // current user. Marten's equivalent of session.Query<T>() — the projection
  // table is the read model; this surface makes it reachable by qualified
  // name without the feature having to import the drizzle-table directly.
  //
  // Auto-applies tenant_id filter when the projection table has a tenant_id
  // column (or opt out with { allTenants: true } for system-scoped reads
  // like cross-tenant analytics). Unknown projection name throws.
  readonly queryProjection: <T = Record<string, unknown>>(
    qualifiedName: string,
    options?: { readonly allTenants?: boolean },
  ) => Promise<readonly T[]>;

  // Always populated — Noop when no observability provider is configured.
  // Feature code can call ctx.metrics.inc(...) / ctx.tracer.startSpan(...)
  // without null-checks.
  readonly metrics: MetricsHandle;
  readonly tracer: Tracer;
};

// Job execution: db + registry + systemUser + logging guaranteed
export type JobContext = SharedContextFields & {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly systemUser: SessionUser;
  readonly log: Logger;
  readonly triggeredBy: { readonly id: string; readonly tenantId: TenantId } | null;
};

// --- Handler Functions ---

export type WriteHandlerFn<TPayload = unknown, TData = unknown> = (
  event: WriteEvent<TPayload>,
  context: HandlerContext,
) => Promise<WriteResult<TData>>;

export type QueryHandlerFn<TPayload = unknown, TResult = unknown> = (
  query: QueryEvent<TPayload>,
  context: HandlerContext,
) => Promise<TResult>;

// --- Event Definitions ---

export type EventDef<TPayload = unknown> = {
  readonly name: string;
  readonly schema: ZodType<TPayload>;
  // Schema generation number. Starts at 1; bumped whenever a breaking change
  // to the payload shape lands together with a matching r.eventMigration that
  // upcasts older stored events. Reads consult this to decide if upcasters
  // need to run before the payload hits consumer code.
  readonly version: number;
};

// Args for ctx.appendEvent — explicit aggregate target, Marten-style.
// `type` must match a name returned by r.defineEvent in any registered
// feature; payload is validated against that event's Zod schema before
// being written to the events-table.
export type AppendEventArgs = {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly type: string;
  readonly payload: unknown;
};

// --- Event Upcasters (schema migration) ---
//
// Marten's Upcaster pattern adapted for TypeScript. An event's payload shape
// may evolve over releases; stored events stay immutable on disk. Features
// register step-wise transforms that upgrade v(N) payloads to v(N+1) at read
// time. The framework chains them automatically — a v1 event gets walked
// through every registered migration up to the current version before the
// payload reaches a projection apply() or ctx.appendEvent consumer.
export type EventUpcastFn = (payload: unknown) => unknown;

export type EventMigrationDef = {
  // Qualified event name, matching r.defineEvent(...).name.
  readonly eventName: string;
  readonly fromVersion: number;
  readonly toVersion: number; // must be fromVersion + 1
  readonly transform: EventUpcastFn;
};

// --- References ---

// Anything that carries a name — accepted by hooks, relations, jobs, etc.
export type NameOrRef = string | { readonly name: string };

export function resolveName(ref: NameOrRef): string {
  return typeof ref === "string" ? ref : ref.name;
}

export type EntityRef = {
  readonly name: string;
  readonly table: string;
};

export type HandlerRef = {
  readonly name: string;
};

export type CrudRefs = {
  readonly entity: EntityRef;
  readonly handlers: {
    readonly create: HandlerRef;
    readonly update: HandlerRef;
    readonly delete: HandlerRef;
  };
  readonly queries: {
    readonly list: HandlerRef;
    readonly detail: HandlerRef;
  };
};

// --- Handler Definitions (stored in feature/registry) ---

export type WriteHandlerDef = {
  readonly name: string;
  readonly schema: ZodType;
  readonly handler: WriteHandlerFn;
  readonly access?: AccessRule;
  readonly skipTransitionGuard?: boolean;
};

export type QueryHandlerDef = {
  readonly name: string;
  readonly schema: ZodType;
  readonly handler: QueryHandlerFn;
  readonly access?: AccessRule;
};
