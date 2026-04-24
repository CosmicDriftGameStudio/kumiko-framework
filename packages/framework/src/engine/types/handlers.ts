import type { Redis } from "ioredis";
import type { ZodType } from "zod";
import type { DbConnection } from "../../db/connection";
import type { TenantDb } from "../../db/tenant-db";
import type { FileContext } from "../../files/file-handle";
import type { Logger } from "../../logging/types";
import type { Meter, MetricsHandle, Tracer } from "../../observability/types";
import type { EntityCache } from "../../pipeline/entity-cache";
import type { SearchAdapter } from "../../search/types";
import type { TzContext } from "../../time";
import type { ConfigAccessor, ConfigAccessorFactory, ConfigResolver } from "./config";

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
  // Session-ID — transported via the JWT `jti` standard claim. Present when
  // an app has wired a `sessionCreator` callback on the auth-routes config
  // (e.g. via the `sessions` feature). Absent for stateless-JWT deployments.
  // When present, middleware can validate that the sid is still alive before
  // accepting the request (session revocation).
  readonly sid?: string;
};

// --- Claim Keys (r.claimKey declarations) ---

// Declared claim shape. Features call r.claimKey("teamId", { type: "string" })
// and get back a typed handle. Feature code then uses the handle both when
// reading via readClaim(user, handle) and (optionally) when returning from
// r.authClaims hooks. Two-fold payoff:
//
//   1. Read-site is typesafe: `const teamId = readClaim(user, DriverClaims.teamId)`
//      narrows to `string | undefined` automatically — no hand-written cast,
//      no magic "drivers:teamId" string.
//   2. Runtime check: the resolver warns when a hook returns an inner-key
//      that the feature didn't declare — catches rename/typo drift. Opt-in
//      per feature: only checked when r.claimKey was used at least once.
//
// Keep the type union small and explicit. JS-side inference via ClaimKeyJsType
// maps each literal to a primitive or array — broader shapes (nested
// records) can land in "object" but lose narrowness; that's the trade-off
// for keeping the type-system simple.
export type ClaimKeyType = "string" | "number" | "boolean" | "string[]" | "object";

export type ClaimKeyJsType<T extends ClaimKeyType> = T extends "string"
  ? string
  : T extends "number"
    ? number
    : T extends "boolean"
      ? boolean
      : T extends "string[]"
        ? readonly string[]
        : T extends "object"
          ? Readonly<Record<string, unknown>>
          : never;

// Stored on the FeatureDefinition. `qualifiedName` is auto-set at
// registration time ("<feature>:<inner-kebab>") — same naming convention
// as auth-claim keys.
export type ClaimKeyDefinition = {
  readonly shortName: string;
  readonly qualifiedName: string;
  readonly type: ClaimKeyType;
};

// Typed handle returned by r.claimKey(). `name` is the qualified key the
// JWT stores; `type` threads through to readClaim's generic so consumers
// get the right narrowed type without casting.
export type ClaimKeyHandle<T extends ClaimKeyType = ClaimKeyType> = {
  readonly name: string;
  readonly type: T;
};

// --- Auth Claims (r.authClaims hook) ---

// Features contribute "identity facts" into the JWT at login time. Claim keys
// are auto-prefixed with the feature name at merge time (`"<feature>:<key>"`)
// so two features can't collide — Reading code in a handler picks the claim
// by its prefixed key: `user.claims["drivers:teamId"]`.
//
// The context is deliberately trimmed compared to HandlerContext: login is a
// READ, not a write-path. Exposing appendEvent/loadAggregate/tz here would
// let claims hooks reach into write-time concerns — not their job, bigger
// mocking surface in tests. `db` is guaranteed tenant-scoped to the chosen
// tenant (the one the user is logging INTO, not the one making the request).
// `queryAs` lets a hook call another feature's query handler without direct
// imports — same cross-feature contract hooks otherwise follow.
export type AuthClaimsContext = {
  readonly db: import("../../db/tenant-db").TenantDb;
  readonly queryAs: (user: SessionUser, qn: string, payload: unknown) => Promise<unknown>;
  readonly config?: ConfigAccessor;
};

export type AuthClaimsFn = (
  user: SessionUser,
  ctx: AuthClaimsContext,
) => Promise<Record<string, unknown>>;

// What the registry stores per registered hook. `featureName` drives the
// auto-prefix at merge time, so the registry is the source of truth for the
// naming — features never ship pre-prefixed keys.
//
// `declaredKeys` is the set of inner-keys this hook's feature declared via
// r.claimKey() — the resolver uses it to warn when a hook returns a key
// that was never declared (typo / rename drift). `undefined` when the
// feature never called r.claimKey(), in which case the resolver skips the
// check entirely (backwards-compat for features that only use r.authClaims).
export type AuthClaimsHookDef = {
  readonly featureName: string;
  readonly fn: AuthClaimsFn;
  readonly declaredKeys?: ReadonlySet<string>;
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

import type { WriteFailure } from "../../errors/write-error-info";

export type WriteResult<TData = unknown> =
  | { readonly isSuccess: true; readonly data: TData }
  | WriteFailure;

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

// Minimal interface for delivery notifications (concrete type in bundled-features/delivery)
export type NotifyFn = (notificationType: string, options: NotifyOptions) => Promise<void>;

// Factory that produces a bound NotifyFn for a specific user+tenant
// Concrete implementation in bundled-features/delivery (cross-package boundary)
export type NotifyFactory = (user: SessionUser, tenantId: TenantId) => NotifyFn;

// Shared optional fields across all execution contexts
type SharedContextFields = {
  readonly redis?: Redis;
  readonly jobRunner?: JobRunnerRef;
  readonly configResolver?: ConfigResolver;
  readonly config?: ConfigAccessor;
  readonly _configAccessorFactory?: ConfigAccessorFactory;
  // Encryption round-trip partner for the config feature. Separate from
  // configResolver so the read-only resolver contract stays clean — the
  // set handler needs to encrypt on write, the resolver needs to decrypt
  // on read, and both reach for the same provider. Wired via extraContext.
  readonly configEncryption?: import("../../db").EncryptionProvider;
  // Rate-limit resolver. Wired by the framework when the `rateLimiting`
  // feature is loaded — pipeline reads handler.rateLimit and calls
  // .enforce() on this resolver before access-check. Absent when the
  // app didn't load the feature: handlers with rateLimit set are
  // rejected at boot to surface the misconfig early.
  readonly rateLimit?: import("../../rate-limit").RateLimitResolver;
  readonly searchAdapter?: SearchAdapter;
  // Binary storage, wrapped around the registered FileStorageProvider.
  // Optional at the AppContext level — present when the app booted with
  // `files.storageProvider`. Hooks/handlers use ctx.files.ref(key) instead
  // of receiving binaries in payloads.
  readonly files?: FileContext;
  readonly entityCache?: EntityCache;
  readonly notify?: NotifyFn;
  readonly _notifyFactory?: NotifyFactory;
  // Tenant-scoped secrets accessor. Present when the app wired a
  // MasterKeyProvider at boot. Feature code reads ctx.secrets.get(...)
  // to pull a plaintext secret; Secret<string> carries the brand that
  // the response guard rejects on serialization.
  readonly secrets?: import("../../secrets").SecretsContext;
  // Raw KEK provider. Present alongside ctx.secrets — needed by the rotation
  // job which deliberately operates outside the per-call audit trail (it
  // processes rows system-wide, not a per-user read).
  readonly masterKeyProvider?: import("../../secrets").MasterKeyProvider;
  // Observability: optional at the outer boundary, always populated by the
  // time a handler receives its ctx (Noop fallback when no provider is
  // configured, so handler code can call ctx.tracer/ctx.metrics without
  // defensive checks).
  readonly tracer?: Tracer;
  readonly meter?: Meter;
  // Cancellation. Aborts when the HTTP client disconnects (mobile back,
  // tab close). Undefined for non-HTTP entry-points (jobs, MSP-applies).
  // Long-running handlers (export jobs, multi-step workflows) should
  // throw `signal.throwIfAborted()` at chunk boundaries; short handlers
  // can ignore it. Framework primitives (streamAllEventsByType,
  // rebuildProjection) honour it automatically.
  readonly signal?: AbortSignal;
  // Effective feature-toggle resolver. Wired by the dispatcher when the
  // feature-toggles feature is loaded — the lifecycle pipeline, MSP runner,
  // and ctx.hasFeature all read from this single source. Returns the Set
  // of feature names that are currently effectively enabled (after global
  // overrides and r.requires() cascade). Absent = all features on.
  readonly effectiveFeatures?: () => ReadonlySet<string>;
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

  // Runtime-check whether a feature is currently effectively-enabled. Use
  // inside an active handler when logic should opt into behaviour that
  // depends on another toggleable feature being on (e.g. "if premiumInvoices
  // is on, add extra columns to the export"). The dispatcher gate already
  // blocks calls to handlers of disabled features — this is the fine-grained
  // opt-in counterpart, not a substitute for the gate.
  readonly hasFeature: (featureName: string) => boolean;

  // Append a domain event to a specific aggregate stream in the current tx.
  // Marten-aligned: every event belongs to exactly one aggregate. The runtime
  // reads the current stream version, bumps it, and fires projections that
  // match the event type in the same transaction. Use it when a write-handler
  // wants to record a domain event alongside the auto-generated CRUD events
  // (e.g. "invoice.approved" on the same invoice stream that already carries
  // "invoice.created" + "invoice.updated").
  readonly appendEvent: (args: AppendEventArgs) => Promise<void>;

  // Marten FetchForWriting equivalent: load the current stream, optionally
  // enforce expectedVersion, and get a handle that appends further events
  // onto that stream without re-specifying aggregateId/aggregateType.
  // Fails fast with VersionConflictError when expectedVersion doesn't
  // match — the write-handler never touches state it didn't expect.
  readonly fetchForWriting: (args: FetchForWritingArgs) => Promise<AggregateStreamHandle>;

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
    options?: { readonly asOf?: Temporal.Instant },
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

  // Cache the current state of an aggregate as a snapshot. Callers that
  // hold the state (e.g. just reduced the stream in a queryHandler, or
  // finished a write batch) pass it in alongside the version it reflects.
  // The framework handles storage + upsert semantics; the snapshot policy
  // (every N events, every M minutes, on-demand) stays with the feature.
  // Snapshots are a perf optimisation — the event log remains the source
  // of truth.
  readonly snapshotAggregate: (args: {
    readonly aggregateId: string;
    readonly aggregateType: string;
    readonly version: number;
    readonly state: Record<string, unknown>;
  }) => Promise<void>;

  // Snapshot-aware rehydrate. Loads the latest snapshot (if any), runs the
  // registered upcaster chain on every delta event, and folds them onto
  // the snapshot state with the caller's reducer. Returns the final state,
  // the latest event version, and whether a snapshot was used — the last
  // lets a feature's snapshot policy make informed decisions
  // (e.g. "snapshot every 100 events past the last snapshot").
  //
  // Archived streams behave like ctx.loadAggregate — empty result with
  // version=0, not an exception.
  readonly loadAggregateWithSnapshot: <TState extends Record<string, unknown>>(
    aggregateId: string,
    reducer: import("../../event-store").SnapshotReducer<TState>,
    initial: TState,
  ) => Promise<import("../../event-store").LoadAggregateWithSnapshotResult<TState>>;

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

  // Time + TZ helper. Feature-Code MUSS hier durch statt `new Date()` —
  // ctx.tz.now() liefert Temporal.Instant, ctx.tz.parse(wallClock, tz)
  // produziert ZonedDateTime, ctx.tz.toLocatedJson serialisiert für die
  // API-Boundary. Lint-Regel gegen `new Date()` kommt sobald alle internen
  // usages migriert sind. Tenant + User-TZ defaults aktuell "UTC", werden
  // aus tenant.timezone / user.timezone gelesen sobald die Felder existieren.
  readonly tz: TzContext;

  // Resolve every registered r.authClaims() hook against `user` and return
  // the merged claim record (keys auto-prefixed with the feature name). Used
  // by login + switch-tenant write-handlers to populate SessionUser.claims
  // before the JWT is signed. Thin pass-through to dispatcher.resolveAuthClaims
  // so there's a single resolve impl — both entry-points can't drift.
  readonly resolveAuthClaims: (user: SessionUser) => Promise<Record<string, unknown>>;
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
//
// `headers` lands in StoredEvent.metadata.headers — Marten-conform free
// key/value space for app-specific metadata (A/B-bucket, geo-region,
// client SDK version). Framework does not interpret values; keep them
// JSON-primitive (string|number|boolean) for safe serialization.
export type AppendEventArgs = {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly type: string;
  readonly payload: unknown;
  readonly headers?: Readonly<Record<string, string | number | boolean>>;
};

// Args for ctx.fetchForWriting — Marten FetchForWriting equivalent. Returns
// the current stream state + a handle that appends without re-specifying
// aggregateId/aggregateType. When expectedVersion is provided, the handle
// rejects the write immediately if the stream is ahead — optimistic
// concurrency enforced BEFORE any downstream work. Without expectedVersion,
// the handle trusts whatever version the stream currently has.
export type FetchForWritingArgs = {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly expectedVersion?: number;
};

export type AggregateStreamHandle = {
  // Snapshot at fetch time — upcasted via the registered upcaster chain,
  // so payloads match the current schema regardless of when they landed.
  readonly events: readonly import("../../event-store").StoredEvent[];
  readonly version: number;
  // Append an event on this stream. Derives aggregateId/aggregateType/
  // expectedVersion from the handle automatically. Multiple calls in a
  // row bump the handle's internal version and the events-table in order.
  readonly appendOne: (args: { readonly type: string; readonly payload: unknown }) => Promise<void>;
};

// --- Event Upcasters (schema migration) ---
//
// Marten's Upcaster pattern adapted for TypeScript. An event's payload shape
// may evolve over releases; stored events stay immutable on disk. Features
// register step-wise transforms that upgrade v(N) payloads to v(N+1) at read
// time. The framework chains them automatically — a v1 event gets walked
// through every registered migration up to the current version before the
// payload reaches a projection apply() or ctx.appendEvent consumer.
//
// Sync transforms: just return the upgraded payload. Most schema-evolution
// (renames, additions, format-fixes) needs no IO and stays sync — fast on
// the hot path of projection-rebuild.
//
// Async transforms (Marten's "AsyncOnlyEventUpcaster"): when the upgrade
// needs DB enrichment (e.g. v1 stored only a customerId, v2 also needs the
// customer's segment which lives in a reference table), accept the optional
// ctx-arg, run the lookup via ctx.db, return a Promise. The framework
// awaits unconditionally — sync transforms return a plain value and pay
// only the await-microtask overhead. Pattern-match Marten:
//   r.eventMigration("invoiceCreated", 1, 2, async (payload, ctx) => {
//     const customer = await ctx.db.select().from(customersTable)...;
//     return { ...payload, customerSegment: customer.segment };
//   });
export type EventUpcastCtx = {
  readonly db: import("../../db").DbRunner;
  readonly tenantId: import("./identifiers").TenantId;
};

export type EventUpcastFn = (payload: unknown, ctx: EventUpcastCtx) => unknown | Promise<unknown>;

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

// --- Handler Definitions (stored in feature/registry) ---

// Per-handler rate limit. Bucket key derived from `per`:
//   "user"            → userId
//   "tenant"          → tenantId
//   "ip"              → request IP
//   "user+handler"    → userId + handlerName
//   "tenant+handler"  → tenantId + handlerName
//   "ip+handler"      → IP + handlerName (anonymous endpoints)
// `cost` is the tokens this handler-call deducts. Default 1 — bump for
// expensive operations (bulk export, bulk import).
export type RateLimitPer =
  | "user"
  | "tenant"
  | "ip"
  | "user+handler"
  | "tenant+handler"
  | "ip+handler";

export type RateLimitOption = {
  readonly per: RateLimitPer;
  readonly limit: number;
  readonly windowSeconds: number;
  readonly cost?: number;
};

export type WriteHandlerDef = {
  readonly name: string;
  readonly schema: ZodType;
  readonly handler: WriteHandlerFn;
  readonly access?: AccessRule;
  readonly skipTransitionGuard?: boolean;
  readonly rateLimit?: RateLimitOption;
};

export type QueryHandlerDef = {
  readonly name: string;
  readonly schema: ZodType;
  readonly handler: QueryHandlerFn;
  readonly access?: AccessRule;
  readonly rateLimit?: RateLimitOption;
};
