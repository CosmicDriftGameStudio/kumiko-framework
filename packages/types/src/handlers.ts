import type { Redis } from "ioredis";
import type { ZodType } from "zod";
import type { ConfigAccessor, ConfigAccessorFactory, ConfigResolver } from "./config";
import type { DbConnection } from "./db-connection";
import type { EntityCache } from "./entity-cache";
import type { KumikoEventTypeMap } from "./event-type-map";
import type { FileContext } from "./file-handle-types";
import type { FileProviderResolver } from "./file-provider-resolver-types";
import type { GeoTzProvider } from "./geo-tz";
import type { Logger } from "./logger";
import type { Meter, MetricsHandle, Tracer } from "./observability";
import type { SearchAdapter } from "./search-adapter";
import type { TenantDb } from "./tenant-db-types";
import type { TzContext } from "./tz-context";

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
  // Set ONLY when the request authenticated via a Personal Access Token
  // (bearer, PAT_TOKEN_PREFIX). Absent for cookie/JWT logins, which stay
  // unrestricted. `allowedQns` are the QN globs the token's granted scopes
  // expand to; the API boundary (routes.ts) rejects any dispatch type not
  // matched by one of them (fail-closed). `scopes` are the granted scope
  // names, kept for audit/display only.
  readonly pat?: {
    // The token row id — the per-token key for PAT rate limiting. Not the
    // secret; safe to carry on the principal.
    readonly tokenId: string;
    readonly scopes: readonly string[];
    readonly allowedQns: readonly string[];
  };
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
  readonly db: import("./tenant-db-types").TenantDb;
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

import type { WriteFailure } from "./write-error-info-types";

export type WriteResult<TData = unknown> =
  | { readonly isSuccess: true; readonly data: TData }
  | WriteFailure;

// --- Context Types ---

// Forward import: Registry is in feature.ts (circular type import — fine in TS)
import type { Registry } from "./feature";
import type { TenantId } from "./identifiers";

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
  // on read, and both reach for the same cipher. Wired via extraContext;
  // run{Prod,Dev}App build it from the secrets master key automatically.
  readonly configEncryption?: import("./envelope-cipher-types").EnvelopeCipher;
  // Rate-limit resolver. Wired by the framework when the `rate-limiting`
  // feature is loaded — pipeline reads handler.rateLimit and calls
  // .enforce() on this resolver before access-check. Absent when the
  // app didn't load the feature: handlers with rateLimit set are
  // rejected at boot to surface the misconfig early.
  readonly rateLimit?: import("./rate-limit-types").RateLimitResolver;
  readonly searchAdapter?: SearchAdapter;
  // Binary storage. The dispatcher builds this per-call, bound to the caller's
  // tenant, from `_fileProviderResolver` (below) — so uploads, ctx.files and the
  // GDPR jobs all resolve through the same file-foundation provider. Hooks/
  // handlers use ctx.files.ref(key) instead of receiving binaries in payloads.
  readonly files?: FileContext;
  // Boot-built, per-tenant file-provider resolver. Set by buildServer when a
  // `file-provider-*` plugin is mounted; the dispatcher reads it to materialise
  // ctx.files (and the upload routes + MSP-applies use the same resolver).
  // Resolution runs under system identity for the s3.secretAccessKey read.
  readonly _fileProviderResolver?: FileProviderResolver;
  readonly entityCache?: EntityCache;
  readonly notify?: NotifyFn;
  readonly _notifyFactory?: NotifyFactory;
  // Tenant-scoped secrets accessor. Present when the app wired a
  // MasterKeyProvider at boot. Feature code reads ctx.secrets.get(...)
  // to pull a plaintext secret; Secret<string> carries the brand that
  // the response guard rejects on serialization.
  readonly secrets?: import("./secrets-types").SecretsContext;
  // Raw KEK provider. Present alongside ctx.secrets — needed by the rotation
  // job which deliberately operates outside the per-call audit trail (it
  // processes rows system-wide, not a per-user read).
  readonly masterKeyProvider?: import("./secrets-types").MasterKeyProvider;
  // Subject-key adapter for crypto-shredding (GDPR Art. 17). Present when
  // the app wired a KmsAdapter at boot; the PII envelope engine and the
  // forget pipeline reach for it. Absent = crypto-shredding not enabled.
  readonly kms?: import("./kms-adapter-types").KmsAdapter;
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
  // feature-toggles or tier-engine feature is loaded — the lifecycle
  // pipeline, MSP runner, and ctx.hasFeature all read from this single
  // source. Per-tenant: tenantId argument enables tier-cuts (Sprint 8a)
  // where Tenant-A sees Pro features and Tenant-B sees Free features in
  // the same process. Returns the Set of feature names effectively
  // enabled for that tenant. Absent = all features on (back-compat).
  readonly effectiveFeatures?: (tenantId: TenantId) => ReadonlySet<string>;
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
  /** Bei Job-Handler-Aufrufen die aus einem Event-Trigger heraus laufen
   *  (r.job mit `trigger: { on: ... }`): der Name des Handlers der das
   *  Event ausgelöst hat. Bei Multi-Trigger-Jobs (`on: [...]`) ist das
   *  die einzige Möglichkeit für den Handler zu wissen WELCHER Trigger
   *  gefeuert hat. Cron- und manual-Jobs lassen das Feld undefined. */
  readonly triggerName?: string;
  readonly _userId?: string | undefined;
  readonly _handlerType?: string | undefined;
  /** Optionaler Geo→Zone-Adapter. Wenn gesetzt (via buildServer-context oder
   *  runProdApp/runDevApp extraContext), reicht der Dispatcher ihn an
   *  ctx.tz.fromCoordinates / fromAddress weiter. Ohne Provider werfen diese. */
  readonly geoTzProvider?: GeoTzProvider;
  /** Tenant des aktuellen Pipeline-Calls. Wird vom Dispatcher beim Bauen
   *  des HandlerContext aus `user.tenantId` gespiegelt, damit lifecycle-
   *  pipeline + system-hooks den Wert ohne Zugriff auf user-Object haben.
   *  Sprint-8a Tier-Composition: `effectiveFeatures(ctx._tenantId)`-call
   *  in den hook-filter-Stellen. */
  readonly _tenantId?: TenantId;
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
//
// TMap propagates the strict event-type-map through `appendEvent`. Defaults
// to the global KumikoEventTypeMap (augmented per app via
// `declare module "@cosmicdrift/kumiko-framework/engine"`). Code that bypasses the
// type-map (runtime-pluggable events) uses `unsafeAppendEvent`.
export type HandlerContext<TMap extends object = KumikoEventTypeMap> = SharedContextFields & {
  readonly db: TenantDb;
  readonly registry: Registry;
  /** Aktiver SessionUser des Handler-Aufrufs — Convenience-Alias zu
   *  `event.user`. Existiert weil Handler intuitiv `ctx.user.tenantId`
   *  schreiben (Context = "kennt seinen User") und der Pfad sonst nur
   *  über `event.user` läuft, was typo-anfällig ist und stillschweigend
   *  zu `internal_error` führt wenn der falsche Pfad gewählt wird.
   *  Identisch zum event.user-Wert; Identity-Switches nutzen
   *  weiterhin queryAs/writeAs. */
  readonly user: SessionUser;
  readonly systemUser?: SessionUser;
  readonly log?: Logger;
  readonly triggeredBy?: { readonly id: string; readonly tenantId: TenantId } | null;
  readonly _userId?: string | undefined;
  readonly _handlerType?: string | undefined;
  // Trash query opt-in (soft-delete). When true, the auto entity-list handler
  // asks the executor to include soft-deleted rows; a custom query handler can
  // read it to branch its own logic. Set by the dispatcher from the query
  // payload's `includeDeleted` field — visibility (tenant/ownership) filters
  // still apply, so this never widens what a user may see beyond the live list.
  readonly includeDeleted?: boolean;

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
  //
  // Async: falls back to the live trial-gate (tenant.inserted_at-derived,
  // can't live in the boot-cached sync resolver) whenever the synchronous
  // feature-set says a feature is off — otherwise trial tenants checking a
  // companion feature (not their own handler's owning feature) would see a
  // stale `false`.
  readonly hasFeature: (featureName: string) => Promise<boolean>;

  // Append a domain event to a specific aggregate stream in the current tx.
  // Marten-aligned: every event belongs to exactly one aggregate. The runtime
  // reads the current stream version, bumps it, and fires projections that
  // match the event type in the same transaction. Use it when a write-handler
  // wants to record a domain event alongside the auto-generated CRUD events
  // (e.g. "invoice.approved" on the same invoice stream that already carries
  // "invoice.created" + "invoice.updated").
  readonly appendEvent: AppendEventFn<TMap>;

  // Escape-hatch for runtime-pluggable features without a compile-time
  // augmentation. See UnsafeAppendEventFn — same runtime as appendEvent,
  // but the type-surface is `payload: unknown`. Use only when the event-
  // type is not knowable at compile-time; otherwise the strict path
  // (appendEvent) is the contract Designer/AI rely on.
  readonly unsafeAppendEvent: UnsafeAppendEventFn;

  // Savepoint-scoped append. Use when the handler must gracefully continue
  // after losing a race against a concurrent writer on the same aggregate
  // stream (e.g. two idempotent ingest calls racing the same dedup key) —
  // see TryAppendEventFn for why this doesn't poison the transaction the
  // way a caught unsafeAppendEvent throw would.
  readonly tryAppendEvent: TryAppendEventFn;

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
  ) => Promise<readonly import("./event-store-types").StoredEvent[]>;

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
  // (every N events, every M minutes, on-demand) stays with the feature —
  // or pass { snapshotEvery } to loadAggregateWithSnapshot for the common case.
  // Snapshots are a perf optimisation — the event log remains the source
  // of truth.
  readonly snapshotAggregate: (args: {
    readonly aggregateId: string;
    readonly aggregateType: string;
    readonly version: number;
    readonly state: Record<string, unknown>;
    // Reducer-shape generation stamped onto the snapshot (default 1) — see
    // loadAggregateWithSnapshot's snapshotVersion option.
    readonly snapshotVersion?: number;
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
    reducer: import("./snapshot-types").SnapshotReducer<TState>,
    initial: TState,
    options?: Omit<import("./snapshot-types").LoadAggregateWithSnapshotOptions, "upcastEvent">,
  ) => Promise<import("./snapshot-types").LoadAggregateWithSnapshotResult<TState>>;

  // Read rows from a registered projection table, tenant-scoped to the
  // current user. Marten's equivalent of session.Query<T>() — the projection
  // table is the read model; this surface makes it reachable by qualified
  // name without the feature having to import the drizzle-table directly.
  //
  // Auto-applies tenant_id filter when the projection table has a tenant_id
  // column (or opt out with { unsafeAllTenants: true } for system-scoped reads
  // like cross-tenant analytics). Unknown projection name throws.
  readonly queryProjection: <T = Record<string, unknown>>(
    qualifiedName: string,
    options?: { readonly unsafeAllTenants?: boolean },
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

/**
 * Compile-time mirror of `engine/qualified-name.ts:toKebab` for camelCase
 * → kebab-case. Drives the literal-type of `EventDef.name`, so that
 * `r.defineEvent("foo", schema)` inside `defineFeature("driverOrders")`
 * carries `name: "driver-orders:event:foo"` as a literal — strict-mode
 * for `ctx.appendEvent({ type: eventDef.name, ... })` lights up.
 *
 * Algorithm mirrors the runtime regex pipeline:
 *   1. `.` → `-` (dot acts as word-boundary)
 *   2. Insert `-` between `[A-Z]+` and `[A-Z][a-z]` (so `SSEFoo` →
 *      `SSE-Foo`, splitting an uppercase run before a camel-hump)
 *   3. Insert `-` between `[a-z0-9]` and `[A-Z]` (camelCase boundary,
 *      so `ticketAssigned` → `ticket-Assigned`)
 *   4. lowercase everything
 *
 * Implemented as a state machine with one-char lookahead. State:
 *   - "start"        — at start of string, or right after a dot-boundary
 *   - "upper"        — last emitted char came from an uppercase letter
 *   - "post-letter"  — last emitted char was a lowercase letter or digit
 *
 * Sync vs runtime is verified by `engine/__tests__/camel-to-kebab.test-d.ts`
 * — the type-tests cross-check identical inputs against `toKebab()`.
 */
export type CamelToKebab<S extends string> = CamelToKebabImpl<S, "start", "">;

type CamelToKebabImpl<
  S extends string,
  Prev extends "start" | "upper" | "post-letter",
  Acc extends string,
> = S extends `${infer C}${infer Rest}`
  ? CharKind<C> extends "upper"
    ? Prev extends "start"
      ? CamelToKebabImpl<Rest, "upper", `${Acc}${Lowercase<C>}`>
      : Prev extends "post-letter"
        ? CamelToKebabImpl<Rest, "upper", `${Acc}-${Lowercase<C>}`>
        : // Prev = "upper" — peek next char to decide between
          // continuing-the-run and splitting-before-camel-hump.
          Rest extends `${infer Next}${string}`
          ? CharKind<Next> extends "lower"
            ? CamelToKebabImpl<Rest, "upper", `${Acc}-${Lowercase<C>}`>
            : CamelToKebabImpl<Rest, "upper", `${Acc}${Lowercase<C>}`>
          : `${Acc}${Lowercase<C>}`
    : CharKind<C> extends "lower"
      ? CamelToKebabImpl<Rest, "post-letter", `${Acc}${C}`>
      : // Non-letter: dots become word-boundaries (state resets to "start"
        // so the next uppercase letter doesn't pick up a redundant dash).
        // Other non-letters (digits etc.) act like lowercase for transitions.
        C extends "."
        ? CamelToKebabImpl<Rest, "start", `${Acc}-`>
        : CamelToKebabImpl<Rest, "post-letter", `${Acc}${C}`>
  : Acc;

/**
 * Three-way classification used by `CamelToKebab`:
 *   - "lower"      — a lowercase letter (a-z and Unicode lowercase)
 *   - "upper"      — an uppercase letter (A-Z and Unicode uppercase)
 *   - "non-letter" — digit, dot, dash, etc. (Lowercase==Uppercase for them)
 */
type CharKind<C extends string> =
  C extends Lowercase<C> ? (C extends Uppercase<C> ? "non-letter" : "lower") : "upper";

/**
 * Builds the qualified event-name from feature + inner-name in the same
 * shape the runtime emits via `qn(toKebab(feature), "event", toKebab(inner))`.
 */
export type QualifiedEventName<
  TFeature extends string,
  TInner extends string,
> = `${CamelToKebab<TFeature>}:event:${CamelToKebab<TInner>}`;

// PII payload fields on a custom event (#799): `field` is encrypted under
// the DEK of the user named by the payload's `subjectField` (crypto-
// shredding). A null subject field leaves the value plaintext — there is
// no user key to shred for system-triggered events.
export type EventPiiFields = Readonly<Record<string, { readonly subjectField: string }>>;

export type EventDef<TPayload = unknown, TName extends string = string> = {
  readonly name: TName;
  readonly schema: ZodType<TPayload>;
  // Schema generation number. Starts at 1; bumped whenever a breaking change
  // to the payload shape lands together with a matching r.eventMigration that
  // upcasts older stored events. Reads consult this to decide if upcasters
  // need to run before the payload hits consumer code.
  readonly version: number;
  readonly piiFields?: EventPiiFields;
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

// Typed-payload variant — used by the strict ctx.appendEvent. Keyed via
// the discriminator type-arg so payload inference flows from `type`-literal
// to the matching schema-payload.
//
// TMap is propagated as a generic parameter (not hard-coded to
// KumikoEventTypeMap) so the constraint `K extends keyof TMap` resolves at
// USE-site instead of definition-site. Cross-package augmentation only
// becomes visible at use-site — the App's tsc compiles the augmentation
// alongside its own code, so `keyof TMap` widens to include all augmented
// event names. Hard-coding `keyof KumikoEventTypeMap` here would resolve
// at definition-site (framework's compile) where the augmentation is
// invisible → K = never, no strict-checking. The default = KumikoEventTypeMap
// keeps existing call-sites zero-config.
export type TypedAppendEventArgs<TMap extends object, K extends keyof TMap> = {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly type: K;
  readonly payload: TMap[K];
  readonly headers?: Readonly<Record<string, string | number | boolean>>;
};

// Strict-only form. Single overload — `<K extends keyof TMap>` against the
// app's pre-bound TMap. No fallback overload: apps that need runtime-pluggable
// events (where the type-string isn't known at compile-time) reach for
// `unsafeAppendEvent`.
//
// Why no fallback overload:
//   A two-overload form (`(args: AppendEventArgs)` as the second sig)
//   silently accepts any args via the loose overload as soon as TS can't
//   prove the strict one matches. Cross-package, the strict overload's
//   `K = keyof TMap` collapses to `never` when called WITHOUT a local
//   wrapper (default-substitution is eager at definition-site → augmentation
//   invisible). Either every caller binds TMap via wrapper → strict fires;
//   or they don't, and the fallback would silently swallow every typo.
//   We pick the first option and force the wrong path to fail visibly.
//
// How this is wired in practice:
//   - Apps run `bun kumiko codegen`, which writes `.kumiko/define.ts`
//     with locally-bound `defineWriteHandler<TName, TSchema, TData,
//     KumikoEventTypeMap>(...)` wrappers. Handlers inside those wrappers
//     get a strict ctx.appendEvent.
//   - Cross-package callers (e.g. bundled-features's set.write.ts) that
//     can't afford a local wrapper reach for `ctx.unsafeAppendEvent`
//     instead — same runtime, looser type-surface.
export type AppendEventFn<TMap extends object = KumikoEventTypeMap> = <K extends keyof TMap>(
  args: TypedAppendEventArgs<TMap, K>,
) => Promise<void>;

export type UnsafeAppendEventFn = (args: AppendEventArgs) => Promise<void>;

// Savepoint-scoped append — returns a discriminated result instead of
// throwing on VersionConflictError, so a handler can react gracefully to
// losing a race against a concurrent writer on the same aggregate stream
// (e.g. two idempotent ingest calls for the same dedup key). The append
// runs inside a driver-native SAVEPOINT: a conflict rolls back only that
// nested scope, leaving the rest of the handler's transaction usable —
// unlike unsafeAppendEvent, whose thrown VersionConflictError poisons the
// entire enclosing transaction.
export type TryAppendEventResult =
  | { readonly ok: true; readonly event: import("./event-store-types").StoredEvent }
  | { readonly ok: false; readonly conflict: import("./event-store-errors").VersionConflictError };

export type TryAppendEventFn = (args: AppendEventArgs) => Promise<TryAppendEventResult>;

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
  readonly events: readonly import("./event-store-types").StoredEvent[];
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
//   r.defineEvent("invoiceCreated", schema, {
//     version: 2,
//     migrations: [{ fromVersion: 1, toVersion: 2, transform: async (payload, ctx) => {
//       const customer = await ctx.db.select().from(customersTable)...;
//       return { ...payload, customerSegment: customer.segment };
//     } }],
//   });
export type EventUpcastCtx = {
  readonly db: import("./db-connection").DbRunner;
  readonly tenantId: import("./identifiers").TenantId;
};

export type EventUpcastFn = (payload: unknown, ctx: EventUpcastCtx) => unknown | Promise<unknown>;

// Declarative single-step migration — common payload transforms without an
// imperative function. Applied in fixed order: rename → default → map.
export type DeclarativeEventMigration = {
  // old key → new key; a missing source key is a no-op
  readonly rename?: Readonly<Record<string, string>>;
  // set only when the key is absent — never overwrites an existing value
  readonly default?: Readonly<Record<string, unknown>>;
  // per-key value transform; skipped when the key is absent
  readonly map?: Readonly<Record<string, (value: unknown) => unknown>>;
};

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
  readonly unsafeSkipTransitionGuard?: boolean;
  readonly rateLimit?: RateLimitOption;
  // Set when the author wrote a `perform: stepsPipeline(...)` block. Boot-
  // validators (projection-allowlist) and Designer/AI tooling read this
  // to inspect the step list. Absent on free-form handlers.
  // Inline-import is intentional: step.ts imports HandlerContext from
  // this file, a top-level `import type { PipelineDef } from "./step"`
  // would form a type-only circular import that TS resolves but tooling
  // (incremental compile, IDEs) sometimes mis-handles.
  readonly perform?: import("./step").PipelineDef;
};

export type QueryHandlerDef = {
  readonly name: string;
  readonly schema: ZodType;
  readonly handler: QueryHandlerFn;
  readonly access?: AccessRule;
  readonly rateLimit?: RateLimitOption;
};
