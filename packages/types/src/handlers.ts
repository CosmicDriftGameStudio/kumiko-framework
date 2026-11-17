/// <reference types="temporal-polyfill/global" preserve="true" />
import type { Redis } from "ioredis";
import type { ZodType } from "zod";
import type { CacheSyncBus } from "./cache-sync-types.ts";
import type { ConfigAccessor, ConfigAccessorFactory, ConfigResolver } from "./config.ts";
import type { DbConnection, DbTx } from "./db-connection.ts";
import type {
  DeliveryAttemptLogFactory,
  DeliveryAttemptLogFn,
  DeliveryErrorCode,
  NotifyDeliveryStatus,
} from "./delivery-attempt-types.ts";
import type { DerivativesContext } from "./derivatives-types.ts";
import type { EventMetadata, WriteOrigin } from "./event-store-types.ts";
import type { KumikoEventTypeMap } from "./event-type-map.ts";
import type {
  FileContext,
  FileDownloadLinkSigner,
  FileDownloadLinks,
} from "./file-handle-types.ts";
import type { FileProviderResolver } from "./file-provider-resolver-types.ts";
import type { GeoTzProvider } from "./geo-tz.ts";
import type {
  BeforeTransactionContext,
  HandlerAuth,
  HandlerDb,
  HandlerDispatch,
  HandlerEvents,
  HandlerObservability,
  JobDispatch,
  JobEvents,
  JobObservability,
  ReservationContext,
} from "./handler-context-facets.ts";
import type {
  ContextServices,
  HandlerLifecycle,
  HandlerTenants,
  JobLifecycle,
  UserLiveSignals,
} from "./handler-context-services.ts";
import type { QueryContract } from "./handler-contract.ts";
import type { Logger } from "./logger.ts";
import type { Meter, Tracer } from "./observability/index.ts";
import type { SearchAdapter } from "./search-adapter.ts";
import type { ConnectionTenantDb, CrossTenantReads, TenantDb } from "./tenant-db-types.ts";
import { isOneOf, propertyOf } from "./type-guards.ts";
import type { Clock, TzContext } from "./tz-context.ts";

export type {
  BeforeTransactionContext,
  HandlerAuth,
  HandlerDb,
  HandlerDispatch,
  HandlerEvents,
  HandlerObservability,
  JobDispatch,
  JobEvents,
  JobObservability,
  ReservationContext,
} from "./handler-context-facets.ts";
export type {
  ContextServices,
  HandlerLifecycle,
  HandlerTenants,
  JobLifecycle,
  UserLiveSignals,
} from "./handler-context-services.ts";

import type { AgentHandlerHints } from "./agent-hints.ts";

// --- Access ---

// "tenant-members": signed-in members may write personal data not bound to the caller by an owner rule.
export type OpenToAllPersonalData = "tenant-members";

export type OpenToAllDeclaration = {
  readonly reason: string;
  readonly personalData?: OpenToAllPersonalData;
};

export type OpenToAllAccessRule = {
  readonly openToAll: OpenToAllDeclaration;
};

// "public-intake": anonymous callers may write personal data; the required rateLimit is the only protection.
export type RoleAccessPersonalData = "public-intake";

export type RoleAccessRule = {
  readonly roles: readonly string[];
  readonly personalData?: RoleAccessPersonalData;
  // Public endpoints only (roles include "anonymous"): a signed-in caller is let through
  // whatever roles it holds, since the browser sends the session cookie along and an
  // app-specific role would otherwise turn a visitor away who is welcome anonymously.
  readonly anySignedIn?: true;
};

// AccessRule is DEFAULT-DENY: a handler without an access rule is not reachable.
// To grant access, set one of:
//   - { roles: ["Admin", ...] }             — role-based allowlist (empty array denies everyone)
//   - { openToAll: { reason: "..." } }      — any authenticated user may call (still requires a valid JWT)
export type AccessRule = RoleAccessRule | OpenToAllAccessRule;

export const ESCAPE_HATCH_GRANTS = [
  "systemIdentity",
  "globalWrites",
  "unsafeRaw",
  "crossTenantReads",
] as const;

export type EscapeHatchGrant = (typeof ESCAPE_HATCH_GRANTS)[number];

// `grants` lists what the declaration unlocks. defineWriteHandler/defineQueryHandler infer TGrant from
// the literal list to type ctx.crossTenantReads; everywhere else it stays the full union.
export type EscapeHatchDeclaration<TGrant extends EscapeHatchGrant = EscapeHatchGrant> = {
  readonly reason: string;
  readonly grants: readonly [TGrant, ...TGrant[]];
};

export function isEscapeHatchGrant(value: unknown): value is EscapeHatchGrant {
  return ESCAPE_HATCH_GRANTS.some((grant) => grant === value);
}

export function escapeHatchAllows(
  declaration: EscapeHatchDeclaration | undefined,
  grant: EscapeHatchGrant,
): boolean {
  if (declaration === undefined) return false;
  return declaration.grants.includes(grant);
}

// Returns the declaration only when it unlocks `grant`, so call sites keep passing
// "a declaration or nothing" into grant-gated code.
export function escapeHatchFor(
  declaration: EscapeHatchDeclaration | undefined,
  grant: EscapeHatchGrant,
): EscapeHatchDeclaration | undefined {
  return escapeHatchAllows(declaration, grant) ? declaration : undefined;
}

// unsafeRaw hands out a raw runner that reads everything anyway, so it implies the read-only grant.
export function crossTenantReadsGrantFor(
  declaration: EscapeHatchDeclaration | undefined,
): EscapeHatchDeclaration | undefined {
  return escapeHatchAllows(declaration, "crossTenantReads") ||
    escapeHatchAllows(declaration, "unsafeRaw")
    ? declaration
    : undefined;
}

// Boot-time check of `grants` (untyped sources can carry anything): must be a non-empty list of known grants.
export function escapeHatchGrantsProblem(declaration: {
  readonly grants?: unknown;
}): string | undefined {
  const { grants } = declaration;
  if (grants === undefined) {
    return `grants is required: a non-empty list of ${ESCAPE_HATCH_GRANTS.join(", ")}`;
  }
  if (!Array.isArray(grants) || grants.length === 0) {
    return `grants must be a non-empty list of: ${ESCAPE_HATCH_GRANTS.join(", ")}`;
  }
  const unknownGrant = grants.find((grant) => !isEscapeHatchGrant(grant));
  if (unknownGrant !== undefined) {
    return `unknown grant ${JSON.stringify(unknownGrant)} — allowed: ${ESCAPE_HATCH_GRANTS.join(", ")}`;
  }
  return undefined;
}

export {
  ANONYMOUS_ROLE,
  isAnySignedInGranted,
  isOpenToAllGranted,
  isUiAccessGranted,
} from "./access-predicates.ts";

// --- Pipeline User ---

// Set only on a SessionUser the framework resolved internally for a
// background read (ctx.dispatch.queryAsMember) — such a principal never carries `sid`.
export type SessionUserOrigin = "member-resolution";

export type SessionUser = {
  // UUID-string so user.id threads through the event-store (aggregate-id) and
  // the projection tables (uuid PK) without casts. Auth middleware reads the
  // JWT `sub` claim as a string; legacy integer ids were a pre-ES artefact.
  readonly id: string;
  readonly tenantId: TenantId;
  readonly roles: readonly string[];
  // IANA zone from user.timezone, set at login. Absent → ctx.tz falls back
  // to tenant.timezone, then "UTC" (buildHandlerContext). Stale
  // until re-login — same tradeoff as `roles`.
  readonly timezone?: string;
  // BCP-47 tag from user.locale, set at login. Absent → ctx.locale falls
  // back to the app's boot-configured defaultLocale, then "en"
  // (dispatch-shared.ts). Stale until re-login — same tradeoff as
  // `timezone`.
  readonly locale?: string;
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
  readonly origin?: SessionUserOrigin;
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
  readonly db: import("./tenant-db-types.ts").TenantDb;
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

// --- Active Membership ---

// Not a member of the target tenant, the principal is blocked (see
// engine/active-membership.ts's principalStatus contract), or the tenant is in teardown.
export type ActiveMembershipRejection = "not_a_member" | "principal_blocked" | "tenant_teardown";

export type ActiveMembership = {
  readonly tenantId: TenantId;
  // Raw membership roles — the caller runs buildSessionRoles(globalRoles,
  // roles) itself; this building block never merges global roles in.
  readonly roles: readonly string[];
  readonly tenantName?: string;
  readonly tenantKey?: string;
};

export type ActiveMembershipResult =
  | { readonly kind: "active"; readonly membership: ActiveMembership }
  | { readonly kind: "rejected"; readonly reason: ActiveMembershipRejection };

// --- Handler Events ---

export type WriteEvent<TPayload = unknown> = {
  readonly type: string;
  readonly payload: TPayload;
  readonly user: SessionUser;
};

/** What a handler sees when its `beforeTransaction` phase ran: the phase's `data` as `prepared`; absent for handlers without the phase. */
export type PreparedWriteEvent<TPayload = unknown, TPrepared = unknown> = WriteEvent<TPayload> &
  ([TPrepared] extends [undefined]
    ? { readonly prepared?: undefined }
    : { readonly prepared: TPrepared });

export type QueryEvent<TPayload = unknown> = {
  readonly type: string;
  readonly payload: TPayload;
  readonly user: SessionUser;
};

// --- Handler Results ---

import type { LifecycleResult } from "./hooks.ts";
import type { WriteFailure } from "./write-error-info-types.ts";

export type WriteResult<TData = unknown> =
  | {
      readonly isSuccess: true;
      readonly data: TData;
      /** The executor result behind a handler that answers with its own `data`. Hooks and
       *  projections run on it; the dispatcher removes it from what leaves the pipeline. */
      readonly lifecycle?: LifecycleResult;
    }
  | WriteFailure;

// --- Context Types ---

// Forward import: Registry is in feature.ts (circular type import — fine in TS)
import type { Registry } from "./feature.ts";
import type { TenantId, VisitorKey } from "./identifiers.ts";
import type { UncheckedSystemDb } from "./tenant-db-types.ts";

// The framework resolves the member internally, so no hand-built SessionUser reaches app code.
export type MemberReader = (userId: string, qn: string, payload: unknown) => Promise<unknown>;

// The stored event that made an r.job trigger fire. `aggregateId` is the stream it was appended to — for an entity write the written row's id, so a follow-up job can act on exactly that row. `id` keys idempotency for the at-least-once consumer paths.
export type JobTriggerEvent = {
  readonly id: string;
  readonly aggregateId: string;
  readonly headers: NonNullable<EventMetadata["headers"]>;
};

// Minimal interface for job event triggers (framework-owned, concrete type in jobs/)
export type JobRunnerRef = {
  handleEvent(
    eventName: string,
    payload: Record<string, unknown>,
    user?: SessionUser,
    triggerEvent?: JobTriggerEvent,
  ): Promise<void>;
  // Present on the concrete runner; optional so handleEvent-only doubles still fit.
  handleCatchUpEvent?(
    jobName: string,
    eventName: string,
    payload: Record<string, unknown>,
    user: SessionUser,
    triggerEvent: JobTriggerEvent,
  ): Promise<void>;
  dispatch?(
    jobName: string,
    payload: Record<string, unknown>,
    meta?: { readonly priority?: number; readonly jobId?: string },
  ): Promise<unknown>;
  // False once the job completed, failed or was evicted; optional like the other concrete-runner methods.
  isJobPending?(jobName: string, jobId: string): Promise<boolean>;
};

// Minimal interface a JobRunner attaches via attachDispatcher() to reach the
// write pipeline — framework-owned, concrete type wraps the dispatcher's
// executeWrite/executeQuery. Unlike HandlerContext.write (identity implicit
// via closure), both take an explicit user: a JobRunner is a boot-time
// singleton, not bound to one caller's identity. Only write+queryAs — no
// .query/.stream/.command/.batch/.resolveAuthClaims, that stays Dispatcher-only.
export type DispatchWriteRef = {
  // A job under a gated anonymous origin passes it, else the target would
  // reset to the job's own non-anonymous root.
  readonly write: (
    user: SessionUser,
    qn: string,
    payload: unknown,
    inheritedOrigin?: WriteOrigin,
  ) => Promise<WriteResult>;
  readonly queryAs: (
    user: SessionUser,
    qn: string,
    payload: unknown,
    inheritedOrigin?: WriteOrigin,
  ) => Promise<unknown>;
  // Builds a tenant-scoped MemberReader — one per JobContext.queryAsMember
  // caller (job-runner.ts lazily creates one per job run).
  readonly createMemberReader: (tenantId: TenantId) => MemberReader;
};

// Priority levels for notifications
export type NotifyPriority = "critical" | "normal" | "low";

// Options passed to a NotifyFn / DeliveryService.notify. Defined here so the
// framework side and the concrete delivery implementation can't drift apart.
export type NotifyOptions = {
  readonly to?: string | readonly string[] | { readonly tenant: TenantId };
  readonly route?: Readonly<Record<string, string>>;
  // Limits a `to` delivery to these channels (others get no row); ignored on `route`.
  readonly channels?: readonly string[];
  readonly data?: Readonly<Record<string, unknown>>;
  readonly priority?: NotifyPriority;
  // Opt-in dedup: same key within 24h = single delivery. For replayable handlers
  // (webhook retry, user double-click).
  readonly idempotencyKey?: string;
  // Pseudonymous subject key for the `route` path (no user account). Threaded into
  // the attempt event's recipientId so forget-subject can reach recipientAddress.
  // Ignored on the `to` path, where the resolved user id is the recipientId.
  readonly recipientId?: string;
  // Deliver synchronously, also inside a write handler's transaction (on the
  // outside-tx pool), and deliver queued channels (email/push/chat) inline, so the
  // result carries sent/failed instead of queued. Bypasses the job pipeline and its
  // retry — meant for "send test message" handlers. Without it, a notify inside a
  // write handler is deferred until the write has committed.
  readonly immediate?: boolean;
  // BCP-47 tag of the language the notification content is written in. Reaches
  // the renderer so frame text around the content (footer, links) can match.
  readonly locale?: string;
};

export {
  type ChatSendFailureCode,
  DELIVERY_FAILURE_CODES,
  DELIVERY_SKIP_REASONS,
  type DeliveryAttemptLogEntry,
  type DeliveryAttemptLogFactory,
  type DeliveryAttemptLogFn,
  type DeliveryErrorCode,
  type DeliveryFailureCode,
  type DeliverySkipReason,
  HTTP_ERROR_CODE_PATTERN,
  isDeliveryErrorCode,
  type NotifyDeliveryStatus,
} from "./delivery-attempt-types.ts";

export type NotifyDelivery = {
  readonly channel: string;
  readonly recipientId: string | null;
  readonly status: NotifyDeliveryStatus;
  readonly error: DeliveryErrorCode | null;
  // Only ever set to false: the provider accepted the message but did not confirm
  // that it reached the target (e.g. a Teams workflow answering 202).
  readonly confirmed?: false;
  // Set for queued attempts; the terminal event lands on the same attempt stream.
  readonly deliveryAttemptId?: string;
};

export type NotifyDispatched = {
  readonly kind: "dispatched";
  readonly deliveries: readonly NotifyDelivery[];
};

// Inside a write handler's transaction the delivery waits for the commit; there is
// no result to report yet.
export type NotifyDeferred = { readonly kind: "deferred" };

export type NotifyResult = NotifyDispatched | NotifyDeferred;

// Minimal interface for delivery notifications (concrete type in bundled-features/delivery)
export type NotifyFn = {
  (
    notificationType: string,
    options: NotifyOptions & { readonly immediate: true },
  ): Promise<NotifyDispatched>;
  (notificationType: string, options: NotifyOptions): Promise<NotifyResult>;
};

// Structural subset of the concrete JobRunner that delivery needs to hand
// queued channels to the delivery.render/delivery.send jobs.
export type NotifyJobDispatcher = {
  dispatch(
    jobName: string,
    payload: Record<string, unknown>,
    meta?: { readonly priority?: number },
  ): Promise<unknown>;
};

// Factory that produces a bound NotifyFn for a specific user+tenant. The
// dispatcher is the calling context's job runner; absent means queued
// channels deliver inline. deliveryDb is the connection the delivery's own DB work
// runs on (the outside-tx pool when called inside a write transaction); absent
// means the service's default.
// Concrete implementation in bundled-features/delivery (cross-package boundary)
export type NotifyFactory = (
  user: SessionUser,
  tenantId: TenantId,
  jobDispatcher?: NotifyJobDispatcher,
  deliveryDb?: DbConnection,
  // Lets inline deliveries (immediate, bootstrap) read stored attachments.
  fileProviderResolver?: FileProviderResolver,
) => NotifyFn;

export type EscapeHatchKind =
  | "unsafe-raw"
  | "acknowledge-cross-tenant"
  | "global-write"
  | "identity-switch"
  | "unsafe-all-tenants"
  | "cross-tenant-read";
export type EscapeHatchTarget = { readonly id: string; readonly tenantId: TenantId };
export type EscapeHatchUseEvent = {
  readonly handler: string;
  readonly kind: EscapeHatchKind;
  readonly reason: string;
  readonly tenantId: TenantId;
  readonly actor: string;
  // Initiating identity when `actor` differs from it (identity switches).
  readonly caller?: string;
  readonly target?: EscapeHatchTarget;
};
export type EscapeHatchAuditSink = (event: EscapeHatchUseEvent) => Promise<void>;
// Bound to handler/tenant/actor of one invocation; called once per actual escape-hatch use.
export type EscapeHatchReporter = (
  kind: EscapeHatchKind,
  reason: string,
  target?: EscapeHatchTarget,
) => void;

export type TenantWriteTarget = {
  readonly db: TenantDb;
  readonly streamTenantId: TenantId | undefined;
};

// The flat wiring fields of AppContext. Handlers and jobs see the service-like ones through
// ContextServices, the rest through their own namespaces.
type SharedContextFields = {
  readonly redis?: Redis;
  readonly cacheSync?: CacheSyncBus;
  readonly userLiveSignals?: UserLiveSignals;
  readonly jobRunner?: JobRunnerRef;
  readonly configResolver?: ConfigResolver;
  readonly config?: ConfigAccessor;
  /** Becomes `ctx.tenants.config`. */
  readonly configFor?: (tenantId: TenantId) => ConfigAccessor;
  /** Becomes `ctx.tenants.writeTarget`. */
  readonly forTenant?: (tenantId: TenantId) => TenantWriteTarget;
  /** Mints the per-request `ctx.config`; set by the boot (`addConfigAccessorFactory`) from the effective `configResolver`, overriding an app-supplied value. */
  readonly configAccessorFactory?: ConfigAccessorFactory;
  readonly configEncryption?: import("./envelope-cipher-types.ts").EnvelopeCipher;
  readonly rateLimit?: import("./rate-limit-types.ts").RateLimitResolver;
  // Internal: keyed digest for payload-field rate-limit buckets. Set by buildServer; read only by the dispatcher.
  readonly _rateLimitPayloadDigest?: (value: string) => string;
  // Internal: keyed digest behind ctx.visitorKey. Set by buildServer; read only by the handler-context builder.
  readonly _visitorKeyDigest?: (value: string) => string;
  readonly searchAdapter?: SearchAdapter;
  readonly files?: FileContext;
  readonly fileDownloadLinks?: FileDownloadLinks;
  // Internal: signs download-link tokens. Set by buildServer; read by the handler-context builder and the link route.
  readonly _fileDownloadLinkSigner?: FileDownloadLinkSigner;
  readonly derivatives?: DerivativesContext;
  readonly _fileProviderResolver?: FileProviderResolver;
  readonly notify?: NotifyFn;
  readonly _notifyFactory?: NotifyFactory;
  readonly _notifyInTransactionFactory?: (user: SessionUser, tenantId: TenantId) => NotifyFn;
  readonly _notifyAfterCommitFactory?: (user: SessionUser, tenantId: TenantId) => NotifyFn;
  readonly _deliveryAttemptLogFactory?: DeliveryAttemptLogFactory;
  readonly _logOwnDeliveryAttempt?: DeliveryAttemptLogFn;
  readonly _escapeHatchAuditSink?: EscapeHatchAuditSink;
  readonly secrets?: import("./secrets-types.ts").SecretsContext;
  readonly masterKeyProvider?: import("./secrets-types.ts").MasterKeyProvider;
  readonly kms?: import("./kms-adapter-types.ts").KmsAdapter;
  readonly tracer?: Tracer;
  readonly meter?: Meter;
  readonly signal?: AbortSignal;
  readonly effectiveFeatures?: (tenantId: TenantId) => ReadonlySet<string>;
  /** Becomes `ctx.lifecycle.afterCommit`. */
  readonly scheduleAfterCommit?: (hook: () => Promise<void>) => void;
  /** Becomes `ctx.lifecycle.afterRollback`. */
  readonly scheduleAfterRollback?: (hook: () => Promise<void>) => void;
};

// All optional — the flat wiring bag the app hands to the server and the job runner at boot.
export type AppContext = SharedContextFields & {
  // Runtime contexts (handler, job, hook) carry `services`; this makes them unassignable to an
  // AppContext parameter, since a helper reading wiring off it would silently see `undefined`.
  readonly services?: never;
  readonly db?: DbConnection | TenantDb;
  readonly systemDb?: UncheckedSystemDb;
  readonly registry?: Registry;
  readonly systemUser?: SessionUser;
  readonly log?: Logger;
  readonly triggeredBy?: { readonly id: string; readonly tenantId: TenantId } | null;
  /** For job-handler calls triggered by an `on` entry
   *  (`r.job` with `trigger: { on: ... }`): the qualified name the entry matched,
   *  an `r.defineEvent` QN (e.g. `inbound-mail-foundation:event:inbound-message-received`)
   *  or an entity lifecycle event (e.g. `order.created`).
   *  For multi-trigger jobs (`on: [...]`), this is the only way for the
   *  handler to know which trigger fired. Cron and manual jobs leave the
   *  field undefined. */
  readonly triggerName?: string;
  /** Optional Geo→zone adapter. When set (via buildServer context or
   *  `runProdApp`/`runDevApp` `extraContext`), the dispatcher passes it to
   *  `ctx.tz.fromCoordinates` / `fromAddress`. These methods throw without
   *  a provider. */
  readonly geoTzProvider?: GeoTzProvider;
  /** Overrides the system clock behind ctx.tz in handlers and jobs; tests inject a fixed time. */
  readonly clock?: Clock;
  /** Tenant of the current pipeline call. The dispatcher mirrors
   *  `user.tenantId` here when building HandlerContext so the lifecycle
   *  pipeline and system hooks can access it without the user object.
   *  `effectiveFeatures(ctx.user.tenantId)` uses it at hook-filter points. */
  readonly _tenantId?: TenantId;
  /** Boot-configured default locale (BCP-47). Last fallback in ctx.locale's
   *  Request-Locale → Boot-Default chain (dispatch-shared.ts) — used when
   *  the request carries no X-Locale header and no usable Accept-Language.
   *  Absent falls back to "en". */
  readonly defaultLocale?: string;
};

// Handler execution: db (tenant-scoped) + registry guaranteed.
//
// Cross-feature bridge:
//   ctx.dispatch.query / ctx.dispatch.write run the target handler AS THE CURRENT USER,
//   sharing the active tx + afterCommit queue. Field-access filters apply.
//   ctx.dispatch.queryAs / ctx.dispatch.writeAs switch identity (e.g. SYSTEM for privileged
//   lookups like "find user by email for auth" — system reads aren't filtered
//   by field-access read rules). Any target other than the caller itself (or
//   a subset of its roles) is gated: reachable only from an r.systemScope()
//   feature, a job, or a handler/hook that
//   declared { escapeHatch: { reason } } (system-identity-switch.ts).
//
// The design: handlers are the contract between features. Feature A requires
// Feature B and talks to it through B's registered handlers — never through
// direct imports of B's tables or internal types.
//
// TMap propagates the strict event-type-map through `appendEvent`. Defaults
// to the global KumikoEventTypeMap (augmented per app via
// `declare module "@cosmicdrift/kumiko-framework/engine"`). Code that bypasses the
// type-map (runtime-pluggable events) uses `unsafeAppendEvent`.
export type HandlerContext<TMap extends object = KumikoEventTypeMap> = {
  // Tenant-filtered for ordinary handlers. For r.systemScope() handlers this
  // is fail-closed instead (dispatch-shared.ts hands back a guard that
  // throws on first touch) — there's no type-level way to make `db` optional
  // only for system handlers (isSystem is a runtime-only registry lookup),
  // so a system handler must reach for `systemDb` below.
  readonly db: HandlerDb;
  // Present for r.systemScope() handlers; non-optional on SystemScopeHandlerContext (handler declares systemScope: true). Non-system handlers never receive it — reach for db instead.
  readonly systemDb?: UncheckedSystemDb;
  // Present only when the handler's escapeHatch grants crossTenantReads or unsafeRaw; every call is audited as cross-tenant-read.
  // Non-optional on GrantedHandlerContext (a define*-handler lists crossTenantReads in its grants). Agent tool calls and resolved members never receive it.
  readonly crossTenantReads?: CrossTenantReads;
  readonly registry: Registry;
  /** The active SessionUser for the handler call, exposed as a convenience
   *  alias for `event.user`. Handlers naturally write `ctx.user.tenantId`;
   *  without the alias that path does not exist and silently ends in `internal_error`.
   *  The value is identical to `event.user`; identity switches still use
   *  `queryAs`/`writeAs`. */
  readonly user: SessionUser;
  /** Keyed digest for handler-owned rate-limit keys, so Redis never holds a
   *  plaintext or plainly hashed identifier. Scoped to the running handler:
   *  the same input yields a different digest per handler and never matches a
   *  dispatcher payload-bucket digest. Absent when the app wires no digest key. */
  readonly rateLimitDigest?: (value: string) => string;
  /** Pseudonym of the HTTP caller: keyed HMAC over the UTC day, the resolved client IP and
   *  the User-Agent, identical in every handler and nested dispatch of the app for that day.
   *  Absent outside an HTTP request and when the client IP is unknown. Pseudonymous personal
   *  data for dedup records only, never in events. Not a rate-limit subject: the User-Agent is
   *  caller-controlled, so limits use rateLimit (client IP). */
  readonly visitorKey?: VisitorKey;
  // Trash query opt-in (soft-delete). When true, the auto entity-list handler
  // asks the executor to include soft-deleted rows; a custom query handler can
  // read it to branch its own logic. Set by the dispatcher from the query
  // payload's `includeDeleted` field — visibility (tenant/ownership) filters
  // still apply, so this never widens what a user may see beyond the live list.
  readonly includeDeleted?: boolean;
  // Trash list opt-in: only soft-deleted rows, set from the query payload's `onlyDeleted`.
  // Never combined with includeDeleted (the dispatcher rejects that); visibility filters still apply.
  readonly onlyDeleted?: boolean;

  readonly dispatch: HandlerDispatch;

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

  readonly events: HandlerEvents<TMap>;

  readonly obs: HandlerObservability;

  // Time + TZ helper. Feature code MUST go through this instead of
  // `new Date()` — ctx.tz.now() returns Temporal.Instant, ctx.tz.parse
  // (wallClock, tz) produces a ZonedDateTime, ctx.tz.toLocatedJson
  // serializes for the API boundary. The lint rule against `new Date()`
  // lands once all internal usages are migrated. tenant reads
  // tenant:config:timezone (falls back to "UTC" when no config feature is
  // mounted or the value is unset); user reads SessionUser.timezone (falls
  // back to tenant).
  readonly tz: TzContext;

  // Resolved request locale (BCP-47): X-Locale header → Accept-Language →
  // the app's boot-configured defaultLocale → "en" (dispatch-shared.ts).
  // Always a concrete tag, never optional — mirrors ctx.tz's Request →
  // Boot-Default fallback chain, so handlers never need to check for
  // absence before using it.
  readonly locale: string;

  readonly auth: HandlerAuth;

  // Present when the config feature wired its accessor factory.
  readonly config?: ConfigAccessor;
  readonly notify?: NotifyFn;
  readonly services: ContextServices;
  readonly lifecycle: HandlerLifecycle;
  readonly tenants: HandlerTenants;
};

// Context of a handler that declares `systemScope: true`. defineWriteHandler/defineQueryHandler
// check at dispatch that systemDb is present, and boot rejects the marker outside an
// r.systemScope() feature, so the field is guaranteed rather than optional.
export type SystemScopeHandlerContext<TMap extends object = KumikoEventTypeMap> =
  HandlerContext<TMap> & { readonly systemDb: UncheckedSystemDb };

// Maps a define*-handler's inferred grant list onto its context; defineWriteHandler/defineQueryHandler
// check at dispatch that the field is present. A list the compiler only knows as the full
// EscapeHatchGrant union (a shared EscapeHatchDeclaration, explicit type arguments) proves nothing, so
// the field stays optional there. unsafeRaw also wires crossTenantReads at runtime but is not mapped:
// its handlers read through ctx.db.unsafeRaw(), which is always on the type.
export type GrantedHandlerContext<
  TContext extends { readonly crossTenantReads?: CrossTenantReads },
  TGrant extends EscapeHatchGrant,
> = [EscapeHatchGrant] extends [TGrant]
  ? TContext
  : ["crossTenantReads"] extends [TGrant]
    ? TContext & { readonly crossTenantReads: CrossTenantReads }
    : TContext;

export function hasCrossTenantReads<
  TContext extends { readonly crossTenantReads?: CrossTenantReads },
>(ctx: TContext): ctx is TContext & { readonly crossTenantReads: CrossTenantReads } {
  return ctx.crossTenantReads !== undefined;
}

// Job execution: db + registry + systemUser + logging guaranteed, plus a
// write path into the same dispatcher pipeline write-handlers use.
//
// write/writeAs/queryAs throw until JobRunner.attachDispatcher() has run — a
// call this early is a framework boot bug, not a job-author mistake.
//
// `write` runs as the job's own systemUser, tenant-scoped via its tenantId
// (SYSTEM_TENANT_ID for jobs with no tenant context, e.g. plain cron jobs). `query` runs as the same identity. A job that writes without fanning out per-tenant
// (`_perTenant:` trigger) silently writes into the system tenant instead of
// each tenant it may have meant to reach — no guard against this, only this
// warning.
//
// `writeAs` is the explicit-identity counterpart, symmetric with `queryAs`:
// `hasAccess` has no system bypass, so a write handler whose `access` lists
// concrete roles is unreachable through `write` unless the job lists that role in `runAs`:
// the job's systemUser carries SYSTEM_ROLE plus the `runAs` roles, anything else comes back
// `access_denied`. To act as a different identity the job assembles a full SessionUser for `writeAs`:
// `triggeredBy` alone is not enough, it carries only id + tenantId and no
// roles, so the roles have to come from the job's own lookup.
//
// The passed identity also decides the target tenant — `writeAs` hands
// `user.tenantId` straight to the dispatcher with nothing cross-checking it
// against the job's own tenant, exactly as `queryAs` does. Building an
// identity from job payload data is therefore a cross-tenant write path;
// derive it from a trusted lookup instead.
// Returned from a job handler via `return ctx.defer(ms)`; see JobContext.defer.
export type JobDeferral = { readonly kind: "job-deferral"; readonly delayMs: number };

export type JobContext = {
  // Tenant-filtered to the job's own tenant. Cross-tenant raw access needs
  // `escapeHatch` on the job (`ctx.db.unsafeRaw()`) or `r.systemScope()`
  // (`ctx.systemDb`).
  readonly db: ConnectionTenantDb;
  readonly events: JobEvents;
  readonly registry: Registry;
  readonly systemUser: SessionUser;
  readonly obs: JobObservability;
  // Tenant zone comes from tenant:config:timezone ("UTC" when unset or invalid); now() honours AppContext.clock.
  readonly tz: TzContext;
  readonly triggeredBy: { readonly id: string; readonly tenantId: TenantId } | null;
  // 1-based run number; finalAttempt = no retry follows if this run throws. A sequential-lock re-enqueue restarts at 1.
  readonly attempt: number;
  readonly finalAttempt: boolean;
  // `return ctx.defer(ms)`: park the job and re-run it after `ms` without consuming a retry
  // attempt, failure callback or failed run record. Capped by `maxDefers` (default 100);
  // beyond it the run fails. Throws when the job runs inline (boot gate, no queue).
  readonly defer: (delayMs: number) => JobDeferral;
  // False when this run cannot defer (inline run, or the maxDefers budget is used up), so the handler can write its terminal state before giving up.
  readonly canDefer: boolean;
  // Only present for jobs whose owning feature declares r.systemScope().
  // assertTenantMatch()/acknowledgeCrossTenant() return a TenantDb; a raw,
  // tenant-unfiltered DbRunner instead comes from ctx.systemDb.unsafeRaw(reason)
  // — only safe for a helper that filters by tenantId itself (e.g. reindexEntity).
  readonly systemDb?: UncheckedSystemDb;
  // Read-only reads across all tenants. Present only when the job's escapeHatch
  // grants crossTenantReads or unsafeRaw; every call is audited as cross-tenant-read.
  readonly crossTenantReads?: CrossTenantReads;
  readonly dispatch: JobDispatch;
  // Multi-trigger jobs (`on: [...]`) use this to tell which trigger fired —
  // undefined for cron/manual jobs. Mirrors AppContext.triggerName.
  readonly triggerName?: string;
  // Set when a stored event fired the job, by the job-trigger and catch-up consumers (at-least-once, key idempotency on triggerEvent.id).
  // Undefined for cron and manual runs.
  readonly triggerEvent?: JobTriggerEvent;
  readonly config?: ConfigAccessor;
  readonly notify?: NotifyFn;
  readonly services: ContextServices;
  readonly lifecycle: JobLifecycle;
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

// Dispatch awaits this as an async-generator rather than a single
// response — the chunk-by-chunk shape is load-bearing, not a Promise<TResult>.
export type StreamHandlerFn<TPayload = unknown, TChunk = unknown> = (
  query: QueryEvent<TPayload>,
  context: HandlerContext,
) => AsyncGenerator<TChunk>;

// --- Event Definitions (moved to handler-event-types.ts) ---

export type {
  AggregateStreamHandle,
  AppendConcurrency,
  AppendEventArgs,
  AppendEventFn,
  CamelToKebab,
  DeclarativeEventMigration,
  EventDef,
  EventMigrationDef,
  EventPiiAbsentSubject,
  EventPiiFields,
  EventPiiStance,
  EventPiiSubject,
  EventUpcastCtx,
  EventUpcastFn,
  FetchForWritingArgs,
  NormalizedEventPiiSubject,
  QualifiedEventName,
  TryAppendEventFn,
  TryAppendEventResult,
  TypedAppendEventArgs,
  UnsafeAppendEventFn,
} from "./handler-event-types.ts";
export { normalizeEventPiiSubject } from "./handler-event-types.ts";

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

// Carries the target handler's payload and result types, so ctx.dispatch.query(ref, payload) is typed.
export type QueryHandlerRef<TPayload = unknown, TResult = unknown> = HandlerRef &
  QueryContract<TPayload, TResult>;

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
export const RATE_LIMIT_PERS = [
  "user",
  "tenant",
  "ip",
  "user+handler",
  "tenant+handler",
  "ip+handler",
] as const;

export type RateLimitPer = (typeof RATE_LIMIT_PERS)[number];

export type RateLimitOption = {
  readonly per: RateLimitPer;
  readonly limit: number;
  readonly windowSeconds: number;
  readonly cost?: number;
};

// Bucket keyed by a string field of the parsed write payload (e.g. the
// recipient address of a mail-triggering handler). The value is normalized
// (trim + lowercase, plus `normalize` below) and HMAC-hashed into the key, so
// Redis never holds it in plaintext. The key is scoped to the caller's tenant.
export type RateLimitPayloadBucket = { readonly payloadField: string };

// "email": also strips a `+tag` suffix from the local part, so plus-addressed
// variants of one mailbox (`a+1@x`, `a+2@x`) share a bucket.
export type PayloadBucketNormalization = "email";

// Extra limit that only complements `rateLimit` (never replaces the IP
// bucket of an anonymous handler). Enforced after schema validation,
// before the handler runs.
export type PayloadRateLimitOption = {
  readonly per: RateLimitPayloadBucket;
  readonly limit: number;
  readonly windowSeconds: number;
  readonly cost?: number;
  readonly normalize?: PayloadBucketNormalization;
};

export function isRateLimitOption(value: unknown): value is RateLimitOption {
  const cost = propertyOf(value, "cost");
  return (
    isOneOf(RATE_LIMIT_PERS, propertyOf(value, "per")) &&
    typeof propertyOf(value, "limit") === "number" &&
    typeof propertyOf(value, "windowSeconds") === "number" &&
    (cost === undefined || typeof cost === "number")
  );
}

// Several buckets on one handler: each bucket applies on its own, and a rejected request charges none of them.
export type RateLimitOptions = readonly [RateLimitOption, ...RateLimitOption[]];

export type RateLimitDisabled = { readonly disabled: true; readonly reason: string };
export type RateLimitDeclaration = RateLimitOption | RateLimitOptions | RateLimitDisabled;

export function declaredRateLimitOptions(
  declaration: RateLimitDeclaration | undefined,
): readonly RateLimitOption[] {
  if (declaration === undefined || isRateLimitDisabled(declaration)) return [];
  return isRateLimitOptionList(declaration) ? declaration : [declaration];
}

function isRateLimitOptionList(
  declaration: RateLimitOption | RateLimitOptions,
): declaration is RateLimitOptions {
  return Array.isArray(declaration);
}

export function isRateLimitDisabled(v: RateLimitDeclaration | undefined): v is RateLimitDisabled {
  return v !== undefined && !Array.isArray(v) && "disabled" in v && v.disabled === true;
}

export type {
  AgentEffect,
  AgentExposure,
  AgentHandlerHints,
  AgentRisk,
  AgentScreenHints,
} from "./agent-hints.ts";

/** Undoes a reservation made before the handler transaction. */
export type ReservationRelease = () => Promise<void>;

/** The dispatcher's own open handler transaction: a reservation must settle on it, not on
 *  HandlerContext, whose db is fail-closed for r.systemScope() handlers. */
export type ReservationConfirmContext = {
  readonly tx: DbTx;
  readonly tenantId: TenantId;
};

/** A reservation that also settles inside the handler transaction. `confirmInTransaction` runs
 *  after the handler succeeded and before COMMIT; a throw fails the write and rolls it back. */
export type ReservationHandle = {
  readonly release: ReservationRelease;
  readonly confirmInTransaction: (confirm: ReservationConfirmContext) => Promise<void>;
};

/** Runs in the dispatcher after every pre-handler gate (feature, rate limit, access, schema,
 *  validation, field roles) passed but before the handler transaction opens, so it must commit
 *  its own short write instead of holding a second connection while the transaction is open.
 *  The returned release (or handle.release) runs when the transaction does not commit (failure
 *  result, throw, rollback, failed commit). Throwing a KumikoError rejects the write. */
export type PreTransactionReservation = (
  event: WriteEvent,
  ctx: ReservationContext,
) => Promise<ReservationRelease | ReservationHandle | undefined>;

/** Outcome of a write handler's pre-transaction phase. `release` runs when the handler transaction does not commit (failure result, throw, rollback, failed commit with unknown outcome), so it must itself tolerate a commit that actually happened. */
export type BeforeTransactionResult<TPrepared = unknown> =
  | {
      readonly isSuccess: true;
      readonly data: TPrepared;
      readonly release?: ReservationRelease;
    }
  | WriteFailure;

export type BeforeTransactionPhase<TPayload = unknown, TPrepared = unknown> = (
  event: WriteEvent<TPayload>,
  ctx: BeforeTransactionContext,
) => Promise<BeforeTransactionResult<TPrepared>>;

/** `perCommand`: the handler runs without a transaction of its own. Use it for long external calls
 *  (minutes) that also need writes: no transaction or connection is held while the call runs, and
 *  `ctx.db.outsideTransaction` stays available for metering/provenance bookings (as it does in beforeTransaction). */
export type WriteHandlerTransactionMode = "perCommand";

/** `skip`: run as a nested write without the `beforeTransaction` phase. */
export type BeforeTransactionWhenNested = "skip";

/** The `prepared` type a handler sees: with `beforeTransactionWhenNested: "skip"` a nested run leaves it undefined. */
export type PreparedOrSkipped<TPrepared, TWhenNested> = [TWhenNested] extends [
  BeforeTransactionWhenNested,
]
  ? TPrepared | undefined
  : TPrepared;

export type WriteHandlerDef = {
  readonly name: string;
  readonly schema: ZodType;
  readonly handler: WriteHandlerFn;
  /** Set only by the entity write factories (defineEntityUpdateHandler, …), which wire the parent-ref visibility gate.
   *  The boot-validator requires it on a `parentRef` entity's update/delete/restore handler. */
  readonly [ENTITY_CONVENTION_WRITE_BRAND]?: true;
  readonly access: AccessRule;
  readonly description?: string;
  readonly agent?: AgentHandlerHints;
  /** Fields a generic create/update handler never writes (`excludeFields`).
   *  Set only when non-empty; the renderer and the agent manifest read it from here. */
  readonly excludedFields?: readonly string[];
  readonly unsafeSkipTransitionGuard?: boolean;
  readonly rateLimit?: RateLimitDeclaration;
  /** Per-payload-field limits, e.g. per recipient address. Complements
   *  `rateLimit`; anonymous handlers still need an ip-keyed `rateLimit`. */
  readonly additionalRateLimits?: readonly PayloadRateLimitOption[];
  /** Tokens each request books on every declared rateLimit bucket, computed from the validated
   *  payload (e.g. `(p) => p.files.length`). Replaces the options' `cost`; results below 1 count as 1. */
  readonly rateLimitCost?: (payload: unknown) => number;
  readonly escapeHatch?: EscapeHatchDeclaration;
  /** Declared via `systemScope: true` on defineWriteHandler; boot requires the owning feature to call r.systemScope(). */
  readonly systemScope?: true;
  /** Reserves before the handler transaction opens. Reached through a nested ctx.dispatch.write the
   *  reservation cannot run, so the dispatcher rejects it unless the top-level batch reserved it. */
  readonly reserveBeforeTransaction?: PreTransactionReservation;
  /** Runs after all pre-handler gates (and after reserveBeforeTransaction) and before the
   *  transaction opens: no transaction and no connection held, for external I/O and reads only.
   *  Its `data` reaches the handler as `event.prepared`; a failure result or throw rejects the
   *  write before anything is written. A handler with this phase cannot run as a nested ctx.dispatch.write.
   *  `ctx.db.outsideTransaction` and `ctx.systemDb.outsideTransaction` stay available for writes
   *  that must outlive a failing request (metering, provenance, idempotency records).
   *  `ctx.tenants.writeTarget` is available but read-only here: its db denies writes for the own and a
   *  foreign tenant alike (a foreign tenant stays gated by the SystemAdmin check). */
  readonly beforeTransaction?: BeforeTransactionPhase;
  /** `"skip"`: a nested ctx.dispatch.write of this handler runs without the beforeTransaction phase
   *  (`event.prepared` is undefined) and without a reservation, so the handler does that work inside
   *  its own transaction. Top-level commands still run the phase. Requires beforeTransaction; not
   *  combinable with reserveBeforeTransaction or transaction: "perCommand". */
  readonly beforeTransactionWhenNested?: BeforeTransactionWhenNested;
  /** `"perCommand"`: the handler runs without a transaction of its own. Every ctx.dispatch.write/writeAs it
   *  issues runs as its own top-level command with its own transaction and afterCommit hooks;
   *  ctx.db writes and event appends throw. It cannot run as a nested write or inside a
   *  multi-command batch, and cannot be combined with beforeTransaction/reserveBeforeTransaction. */
  readonly transaction?: WriteHandlerTransactionMode;
  /** Reachable only from server code (ctx.dispatch, jobs, server routes), never through the
   *  generic HTTP entry: POST /api/write, /api/batch and /api/command answer 404 as for an
   *  unknown handler. The calling user is kept, unlike a system-access internal handler.
   *  Implies agent exposure false. */
  readonly dispatchOnly?: boolean;
  /** The only way an anonymous write from the generic HTTP entry runs under SYSTEM_TENANT_ID (default tenant, host resolver or tenantless fallback); without it that write fails with 422 tenant_required. Also enables the tenantless fallback when the host resolves no tenant. Boot requires access.roles: ["anonymous"] and an ip-scoped rateLimit. */
  readonly tenantlessAnonymous?: boolean;
  // Set when the author wrote a `perform: stepsPipeline(...)` block. Boot-
  // validators (projection-allowlist) and Designer/AI tooling read this
  // to inspect the step list. Absent on free-form handlers.
  // Inline-import is intentional: step.ts imports HandlerContext from
  // this file, a top-level `import type { PipelineDef } from "./step.js"`
  // would form a type-only circular import that TS resolves but tooling
  // (incremental compile, IDEs) sometimes mis-handles.
  readonly perform?: import("./step.ts").PipelineDef;
};

// Marker set by defineEntityListHandler/defineEntityDetailHandler. A string, not
// a Symbol(), for the same reason as PAGED_QUERY_HANDLER_BRAND: a symlinked
// workspace can evaluate a module twice, and two Symbol() calls would not
// compare equal across those instances.
export const ENTITY_CONVENTION_QUERY_BRAND = "__kumikoEntityConventionQuery";

// Same brand for the update/delete/restore handlers built by the entity write factories (defineEntityUpdateHandler, …).
export const ENTITY_CONVENTION_WRITE_BRAND = "__kumikoEntityConventionWrite";

export type QueryHandlerDef = {
  readonly name: string;
  readonly schema: ZodType;
  readonly handler: QueryHandlerFn;
  /** Set only by defineEntityListHandler/defineEntityDetailHandler, which wire the parent-ref
   *  read-gate. The boot-validator requires it on a `parentRef` entity's
   *  list/detail handler — see boot-validator/parent-ref.ts. */
  readonly [ENTITY_CONVENTION_QUERY_BRAND]?: true;
  readonly access: AccessRule;
  readonly description?: string;
  readonly agent?: AgentHandlerHints;
  readonly rateLimit?: RateLimitDeclaration;
  /** Zod schema of the handler's actual return value — the paged envelope
   *  `{ rows, nextCursor, total? }` for a `definePagedQueryHandler`, or the
   *  flat record (optionally `.nullable()`) for a plain query handler.
   *  Optional and purely additive: absent on every existing handler, and
   *  the boot-validator skips any column-reference check that would need
   *  it (screens.ts projectionList/relatedList `columns`, projectionDetail
   *  `header`/`metrics`, dashboard `valueField`/`subField`/etc.) rather
   *  than requiring it retroactively. */
  readonly outputSchema?: ZodType;
  /** Entities whose changes this query reflects. Anonymous callers with
   *  access to this query receive /api/sse change signals (no field values)
   *  for these entities. Every name must be a registered entity. */
  readonly liveEntities?: readonly string[];
  /** The entity whose field read rules and writeOnly mask apply to this query's result (a row,
   *  an array of rows or `{ rows }`). It does not map the handler to the entity: no effect on
   *  live signals, access or hooks. */
  readonly resultEntity?: string;
  /** Marks a query whose result holds no entity rows (options, counts, derived values), so no
   *  field filter applies. Excludes `resultEntity`. */
  readonly unfilteredResult?: { readonly reason: string };
  // Query handlers can't reach db.global() (that gate is write-only), but
  // they can still switch identity to SYSTEM via ctx.dispatch.queryAs — this opts
  // in, same contract as WriteHandlerDef.escapeHatch.
  readonly escapeHatch?: EscapeHatchDeclaration;
  /** Declared via `systemScope: true` on defineQueryHandler; boot requires the owning feature to call r.systemScope(). */
  readonly systemScope?: true;
};

export type StreamHandlerDef = {
  readonly name: string;
  readonly schema: ZodType;
  readonly handler: StreamHandlerFn;
  readonly access: AccessRule;
  readonly rateLimit?: RateLimitDeclaration;
  // Stream handlers can't reach db.global() (that gate is write-only), but
  // they can still switch identity to SYSTEM via ctx.dispatch.queryAs — this opts
  // in, same contract as WriteHandlerDef.escapeHatch.
  readonly escapeHatch?: EscapeHatchDeclaration;
};
