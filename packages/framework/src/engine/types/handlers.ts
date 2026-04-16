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
  readonly id: number;
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
  readonly to?: number | readonly number[] | { readonly tenant: TenantId };
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
  readonly triggeredBy?: { readonly id: number; readonly tenantId: TenantId } | null;
  readonly _userId?: number | undefined;
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
  readonly triggeredBy?: { readonly id: number; readonly tenantId: TenantId } | null;
  readonly _userId?: number | undefined;
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
  readonly triggeredBy: { readonly id: number; readonly tenantId: TenantId } | null;
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
