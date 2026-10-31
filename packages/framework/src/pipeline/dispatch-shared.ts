import { resolveAgentExposure } from "@cosmicdrift/kumiko-types/agent-exposure";
import type { CacheSyncBus } from "@cosmicdrift/kumiko-types/cache-sync-types";
import type {
  AgentRisk,
  AuthClaimsContext,
  JobRunnerRef,
  PayloadRateLimitOption,
  RateLimitDeclaration,
  RateLimitOption,
  WriteResult,
} from "@cosmicdrift/kumiko-types/handlers";
import { declaredRateLimitOptions, isRateLimitDisabled } from "@cosmicdrift/kumiko-types/handlers";
import type {
  RateLimitBucketRequest,
  RateLimitResolver,
} from "@cosmicdrift/kumiko-types/rate-limit-types";
import { requestContext } from "../api/request-context.ts";
import { runWithOrigin } from "../api/request-context-scopes.ts";

import type { SseBroker } from "../api/sse-broker.ts";
import type { DbConnection, DbTx } from "../db/connection.ts";
import { runInSystemRowLevelSecurityScope } from "../db/row-level-security-scope.ts";
import type { buildEntityTable } from "../db/table-builder.ts";
import { createTenantDb, type TenantDb } from "../db/tenant-db.ts";
import type { defineTransitions } from "../engine/state-machine.ts";
import type { EffectiveFeaturesResolver } from "../engine/tier-resolver-extension.ts";
import type { TenantId } from "../engine/types/identifiers.ts";
import type {
  AppContext,
  BeforeTransactionContext,
  HandlerContext,
  Registry,
  ReservationContext,
  SessionUser,
} from "../engine/types/index.ts";
import { RateLimitUnavailableError } from "../errors/classes.ts";
import {
  FeatureDisabledError,
  InternalError,
  RateLimitError,
  type WriteErrorInfo,
} from "../errors/index.ts";

import { createFallbackLogger } from "../logging/utils.ts";
import { observabilityContext } from "../observability/context.ts";
import type { EscapeHatchReportWindow } from "../observability/escape-hatch-report.ts";
import { createEscapeHatchReporter } from "../observability/escape-hatch-report.ts";
import type { getFallbackMeter, getFallbackTracer } from "../observability/fallback.ts";
import { emitDispatcherError, emitDispatcherHandler } from "../observability/standard-metrics.ts";

import {
  buildBucketKey,
  buildPayloadBucketKey,
  normalizePayloadBucketValue,
} from "../rate-limit/index.ts";
import { isPlainObject } from "../utils/is-plain-object.ts";
import { resolveAuthClaims as runAuthClaimsResolver } from "./auth-claims-resolver.ts";
import { configAccessorFactoryOf } from "./config-accessor-factory.ts";
import { buildContextServices } from "./context-services.ts";
import { executeQuery } from "./dispatch-query.ts";
import {
  type AfterCommitHook,
  dispatcherSpanAttributes,
  isFailedWriteResult,
} from "./dispatcher-utils.ts";
import { buildAuthFacet } from "./handler-context-auth.ts";
import {
  buildConfigFacet,
  resolveHandlerLocale,
  resolveHandlerTz,
} from "./handler-context-config.ts";
import { buildFileFragment, buildHandlerDbFacet, buildWriteTarget } from "./handler-context-db.ts";
import { buildDispatchFacet, createCommitSinks } from "./handler-context-dispatch.ts";
import { buildEventStoreFacet } from "./handler-context-events.ts";
import { applyMemberResolutionReadOnly } from "./handler-context-member-resolution.ts";
import { buildNotifyFacet } from "./handler-context-notify.ts";
import { buildObservabilityFacet } from "./handler-context-observability.ts";
import {
  applyBeforeTransactionReadOnly,
  denyEventStoreSurfaces,
  denyTransactionBoundSurfaces,
  withoutTransactionDenied,
} from "./handler-context-phase-denials.ts";
import {
  buildLifecycleSignal,
  buildPreSave,
  buildRuntimeServices,
  resolveHandlerContextScope,
} from "./handler-context-scope.ts";
import type { IdempotencyGuard } from "./idempotency.ts";
import type { LifecycleHooks } from "./lifecycle-pipeline.ts";
import { createGatedIdentitySwitch, isSystemIdentity } from "./system-identity-switch.ts";
import type { TenantTimezoneCache } from "./tenant-timezone-cache.ts";
import { TENANT_TIMEZONE_CONFIG_KEY } from "./tenant-timezone-config-key.ts";
import { rootWriteOrigin, type WriteOrigin } from "./write-origin.ts";

export type { WriteOrigin } from "./write-origin.ts";

export { TENANT_TIMEZONE_CONFIG_KEY };

// Same bundled-features-free constraint as above — these name the config
// feature's write handlers so dispatch-write.ts can invalidate
// TENANT_TIMEZONE_CONFIG_KEY's cache entry on a successful write without
// importing the `config` feature. tenant-timezone-boot.integration.test.ts
// exercises both against the real config feature.
export const CONFIG_WRITE_SET_TYPE = "config:write:set";
export const CONFIG_WRITE_RESET_TYPE = "config:write:reset";

export type BatchCommand = {
  readonly type: string;
  readonly payload: unknown;
};

export type BatchResult =
  | { readonly isSuccess: true; readonly results: readonly WriteResult[] }
  | {
      readonly isSuccess: false;
      readonly error: WriteErrorInfo;
      readonly failedIndex: number;
      readonly results: readonly WriteResult[];
    };

// Bundles everything the dispatch-phase functions (query/write/batch) need —
// hoisted to module scope out of createDispatcher's former closure, so those
// captures travel explicitly instead of implicitly.
export type DispatchContext = {
  registry: Registry;
  appContext: AppContext;
  idempotency: IdempotencyGuard | undefined;
  lifecycle: LifecycleHooks | undefined;
  jobRunner: JobRunnerRef | undefined;
  effectiveFeatures: EffectiveFeaturesResolver | undefined;
  sseBroker: SseBroker | undefined;
  tableCache: Map<string, ReturnType<typeof buildEntityTable>>;
  transitionCache: Map<string, ReturnType<typeof defineTransitions>>;
  tenantTimezoneCache: TenantTimezoneCache;
  cacheSync: CacheSyncBus | undefined;
  escapeHatchReportWindow: EscapeHatchReportWindow;
  tracer: ReturnType<typeof getFallbackTracer>;
  meter: ReturnType<typeof getFallbackMeter>;
  // Qualified name of the membership-list query handler consulted by
  // resolveActiveMembershipFn — defaults to TENANT_MEMBERSHIPS_QUERY, overridable via DispatcherOptions.
  membershipQuery: string;
  // ctx.dispatch.queryAsMember statement timeout in whole milliseconds.
  memberReadTimeoutMs: number;
  // Dedicated pool for ctx.db.outsideTransaction / outsideTransaction. Undefined = share the app pool.
  outsideTransactionDb: DbConnection | undefined;
};

export const DEFAULT_MEMBER_READ_TIMEOUT_MS = 10_000;

// Narrowing helper: AppContext.db is DbConnection|TenantDb|undefined. The
// dispatch paths need DbConnection (or DbTx from the caller scope) for
// appendEvent/projection writes; the TenantDb branch is excluded here.
export function resolveDbSource(
  ctx: DispatchContext,
  tx: DbTx | undefined,
): DbConnection | DbTx | undefined {
  return tx ?? resolveAppPoolDb(ctx);
}

export function resolveAppPoolDb(ctx: DispatchContext): DbConnection | undefined {
  return ctx.appContext.db as DbConnection | undefined; // @cast-boundary db-operator
}

// r.systemScope() handlers must go through ctx.systemDb's guarded methods
// (assertTenantMatch / acknowledgeCrossTenant) instead of plain ctx.db —
// "system" mode has no tenant filter at all, so silent ctx.db or
// ctx.db.outsideTransaction use there is a cross-tenant leak. HandlerContext
// has no way to make either field optional per handler (isSystem is a
// runtime-only registry lookup, not a type-level discriminant), so instead
// of omitting the key we hand back a Proxy that throws on first touch,
// naming the handler and pointing at the matching ctx.systemDb escape hatch.
// Only the db guard answers `outsideTransaction` (the inner guard, set by attachOutsideTransaction).
export function createSystemScopedDbGuard(
  handlerType: string,
  fieldName: "db" | "db.outsideTransaction",
  hint: string,
): TenantDb {
  return new Proxy({} as TenantDb, {
    get(target, prop) {
      if (fieldName === "db" && prop === "outsideTransaction") return Reflect.get(target, prop);
      throw new InternalError({
        message:
          `Handler "${handlerType}" is r.systemScope()'d — ctx.${fieldName} is unavailable ` +
          `(it would be unfiltered across every tenant). Use ${hint} ` +
          `instead (attempted to read "${String(prop)}").`,
      });
    },
  });
}

export function isMemberResolutionPrincipal(user: SessionUser): boolean {
  return user.origin === "member-resolution";
}

// inTransaction: ctx.dispatch.write nests in the open transaction. withoutTransaction: no transaction is open,
// so ctx.dispatch.write runs as its own command and ctx.db/event-store writes are denied. postCommit: afterCommit
// hooks, which may write legitimately.
export type HandlerTransactionScope = "inTransaction" | "withoutTransaction" | "postCommit";

export type BuildHandlerContextOptions = {
  tx?: DbTx;
  afterCommitHooks?: AfterCommitHook[];
  includeDeleted?: boolean;
  transactionScope?: HandlerTransactionScope;
  // A query bridge has no commit sink of its own, but ctx.notify inside it must still wait for
  // the outer write's commit: the outer sink is lent to notify only, not to scheduleAfterCommit.
  outerNotifySink?: AfterCommitHook[];
  // Pre-transaction phases of a write handler; ctx.tenants.writeTarget stays available in beforeTransaction but every target db denies writes.
  phase?: HandlerPhase;
};

export type HandlerPhase = "handler" | "reservation" | "beforeTransaction";

type PhaseOptions<TPhase extends HandlerPhase> = BuildHandlerContextOptions & { phase: TPhase };

export function buildHandlerContext(
  ctx: DispatchContext,
  type: string,
  user: SessionUser,
  origin: WriteOrigin,
  options: PhaseOptions<"reservation">,
): Promise<ReservationContext>;
export function buildHandlerContext(
  ctx: DispatchContext,
  type: string,
  user: SessionUser,
  origin: WriteOrigin,
  options: PhaseOptions<"beforeTransaction">,
): Promise<BeforeTransactionContext>;
export function buildHandlerContext(
  ctx: DispatchContext,
  type: string,
  user: SessionUser,
  origin: WriteOrigin,
  options?: BuildHandlerContextOptions,
): Promise<HandlerContext>;
export async function buildHandlerContext(
  ctx: DispatchContext,
  type: string,
  user: SessionUser,
  origin: WriteOrigin,
  options: BuildHandlerContextOptions = {},
): Promise<HandlerContext | ReservationContext | BeforeTransactionContext> {
  const {
    tx,
    afterCommitHooks,
    includeDeleted,
    outerNotifySink,
    phase = "handler",
    transactionScope = tx ? "inTransaction" : "withoutTransaction",
  } = options;
  const readOnlyForTenant = phase === "beforeTransaction";
  const scope = resolveHandlerContextScope({ ctx, type, user, origin, tx, transactionScope });
  const dbFacet = buildHandlerDbFacet(scope);
  const observability = buildObservabilityFacet(scope);
  const sinks = createCommitSinks(afterCommitHooks, transactionScope, outerNotifySink);
  const notifyFacet = buildNotifyFacet(scope, sinks, dbFacet.outsideTxSource);
  const configFacet = buildConfigFacet(scope, dbFacet.db);
  const writeTarget = buildWriteTarget(scope, dbFacet.exposedDb, readOnlyForTenant);
  const fileFragment = buildFileFragment(scope, dbFacet.db);
  const authFacet = buildAuthFacet(scope);
  const eventStoreFacet = buildEventStoreFacet(scope);
  const dispatchFacet = buildDispatchFacet(scope, sinks, {
    queryAsMember: authFacet.queryAsMember,
    queryProjection: eventStoreFacet.queryProjection,
  });
  const tz = await resolveHandlerTz(scope, configFacet.config);
  const locale = resolveHandlerLocale(scope);

  const { _rateLimitPayloadDigest: payloadDigest } = scope.context;
  // The final context (after the phase wrappers below) is what preSave hooks must see.
  const finalContext: { current?: HandlerContext } = {};
  const runPreSave = buildPreSave(scope, () => {
    if (finalContext.current === undefined) {
      throw new InternalError({
        message: "lifecycle.runPreSave called before the context was built",
      });
    }
    return finalContext.current;
  });
  const handlerContext = {
    // Registry is always the dispatcher's registry — injecting it here lets
    // tests/callers pass `context` without `registry` and still get a valid
    // HandlerContext.
    registry: scope.registry,
    ...dbFacet.fragment,
    // The payload-bucket digest is dispatcher-internal; handlers get one bound to their own name.
    ...(payloadDigest && { rateLimitDigest: createHandlerBoundDigest(payloadDigest, type) }),
    ...observability,
    ...(notifyFacet.notify && { notify: notifyFacet.notify }),
    ...(configFacet.config && { config: configFacet.config }),
    services: buildContextServices(scope.context, {
      ...fileFragment,
      ...buildRuntimeServices(scope),
      ...notifyFacet.factoryServices,
    }),
    lifecycle: {
      ...(runPreSave && { runPreSave }),
      ...dispatchFacet.commitHooks,
      ...buildLifecycleSignal(scope),
    },
    tenants: {
      ...(configFacet.configFor && { config: configFacet.configFor }),
      ...(writeTarget && { writeTarget }),
    },
    tz,
    locale,
    // ctx.user as a convenience alias for event.user. Identity switches still use queryAs/writeAs.
    user,
    ...(includeDeleted && { includeDeleted: true }),
    dispatch: dispatchFacet.dispatch,
    events: eventStoreFacet.events,
    auth: authFacet.auth,
    hasFeature: authFacet.hasFeature,
  } as HandlerContext; // @cast-boundary engine-bridge

  const scopedContext =
    transactionScope === "withoutTransaction"
      ? denyEventStoreSurfaces(handlerContext, withoutTransactionDenied)
      : handlerContext;

  // A resolved member principal is read-only by construction.
  const memberSafeContext = isMemberResolutionPrincipal(user)
    ? applyMemberResolutionReadOnly(scopedContext)
    : scopedContext;
  const phasedContext =
    phase === "reservation"
      ? denyTransactionBoundSurfaces(memberSafeContext)
      : phase === "beforeTransaction"
        ? applyBeforeTransactionReadOnly(memberSafeContext)
        : memberSafeContext;
  finalContext.current = phasedContext;
  return phasedContext;
}

// The handler-name prefix keeps a handler from reproducing the digests the
// dispatcher uses for payload buckets (those hash the bare normalized value).
export function createHandlerBoundDigest(
  digest: (value: string) => string,
  handlerName: string,
): (value: string) => string {
  return (value) => digest(`handler:${handlerName}:${value}`);
}

// Resolves the agent risk the irreversible-operation gate should attribute to
// `type` when it becomes the request's entry handler — same defaulting rule
// (resolveAgentExposure) the agent manifest itself uses, so the two never diverge.
function resolveEntryHandlerRisk(
  registry: Registry,
  type: string,
  operation: "query" | "write" | "stream",
): AgentRisk {
  if (operation === "write") {
    return resolveAgentExposure(registry.getWriteHandler(type) ?? {}, "write").risk;
  }
  if (operation === "stream") {
    // StreamHandlerDef carries no `agent` hint — streams can never declare
    // "high", so nested irreversible writes stay conservatively denied.
    return "mid";
  }
  return resolveAgentExposure(registry.getQueryHandler(type) ?? {}, "query").risk;
}

// Wrap handler execution in a dispatcher.handler span AND emit the standard
// dispatcher metrics (duration + error counter). Errors are re-thrown so
// control flow stays identical to the uninstrumented path.
//
// Writes are special-cased: executeWriteInner converts thrown handler errors
// into a WriteResult with isSuccess=false (rather than letting them bubble).
// We inspect the result to paint the dispatcher span + error counter on
// those structural failures too — otherwise "handler threw" would only show
// up when the caller forgot to use writeFailure().
export async function runHandlerInstrumented<T>(
  ctx: DispatchContext,
  type: string,
  operation: "query" | "write" | "stream",
  user: SessionUser,
  inner: () => Promise<T>,
): Promise<T> {
  const { tracer: dispatcherTracer, meter: dispatcherMeter, registry } = ctx;
  const start = performance.now();
  // Outcome recorded inside the withSpan callback, emitted in finally so
  // success/failure/throw all hit a single metric-emit path.
  let success = true;
  let errorClass: string | undefined;

  try {
    return await dispatcherTracer.withSpan(
      "kumiko.dispatcher.handler",
      {
        attributes: dispatcherSpanAttributes(
          type,
          operation,
          user,
          registry.getHandlerFeature(type),
        ),
      },
      async (span) => {
        try {
          // Everything the handler writes, including entity-executor
          // writes below it, is attributed to this handler.
          const result = await runWithOrigin(
            {
              handler: type,
              feature: registry.getHandlerFeature(type),
              entryHandler: { qn: type, risk: resolveEntryHandlerRisk(registry, type, operation) },
            },
            inner,
          );
          if (operation === "write" && isFailedWriteResult(result)) {
            success = false;
            errorClass = result.error?.code ?? "UnknownError";
            span.setStatus("error", errorClass);
          }
          return result;
        } catch (error) {
          success = false;
          errorClass = error instanceof Error && error.name ? error.name : "UnknownError";
          throw error;
        }
      },
    );
  } finally {
    if (!success && errorClass) {
      emitDispatcherError(dispatcherMeter, { handler: type, errorClass });
    }
    emitDispatcherHandler(
      dispatcherMeter,
      { handler: type, success },
      (performance.now() - start) / 1000,
    );
  }
}

// Generator-native counterpart to runHandlerInstrumented — a stream's
// lifetime spans every `for await` pull the caller makes, so the span
// can't be scoped via withSpan's single-callback shape. Drive the inner
// generator manually (not yield*): each pull must run inside
// observabilityContext.run({ activeSpan: span }) so handler-side
// startSpan() calls parent onto the dispatcher span. finally forwards
// .return() to the inner generator (yield* did that for free). Metrics
// land in the same finally path so success/failure/throw/abort all hit
// one emit, like the Promise path.
export async function* runStreamInstrumented<T>(
  ctx: DispatchContext,
  type: string,
  user: SessionUser,
  inner: () => AsyncGenerator<T>,
): AsyncGenerator<T> {
  const { tracer: dispatcherTracer, meter: dispatcherMeter, registry } = ctx;
  const start = performance.now();
  let success = true;
  // Set only once `inner()` has drained on its own — NOT set when the
  // consumer walks away early (generator.return(), the normal SSE-abort
  // path in api/routes.ts). yield* forwards that .return() straight through
  // without throwing, so without this flag an aborted stream would fall
  // through to the success-metric branch below and get counted as a clean
  // completion.
  let completedNormally = false;
  let errorClass: string | undefined;
  const span = dispatcherTracer.startSpan("kumiko.dispatcher.handler", {
    attributes: dispatcherSpanAttributes(type, "stream", user, registry.getHandlerFeature(type)),
  });
  const it = inner();
  // Each pull re-enters both scopes: AsyncLocalStorage does not survive a
  // generator suspension, so wrapping inner() once would leave every event a
  // stream writes unattributed.
  const inScope = <R>(fn: () => R): R =>
    runWithOrigin(
      {
        handler: type,
        feature: registry.getHandlerFeature(type),
        entryHandler: { qn: type, risk: resolveEntryHandlerRisk(registry, type, "stream") },
      },
      () => observabilityContext.run({ activeSpan: span }, fn),
    );
  try {
    let next = await inScope(() => it.next());
    while (!next.done) {
      yield next.value;
      next = await inScope(() => it.next());
    }
    completedNormally = true;
    return next.value;
  } catch (error) {
    success = false;
    errorClass = error instanceof Error && error.name ? error.name : "UnknownError";
    if (error instanceof Error) span.recordException(error);
    span.setStatus("error", errorClass);
    throw error;
  } finally {
    // forward close so inner()'s finally still fires — yield* did this for free
    try {
      await inScope(() => it.return?.(undefined));
    } catch (closeError) {
      // Only fold this in when nothing has already failed — a close-time
      // error while an earlier error is in flight would mask the real
      // cause reported above.
      if (success) {
        success = false;
        errorClass =
          closeError instanceof Error && closeError.name ? closeError.name : "UnknownError";
        span.setStatus("error", errorClass);
      }
    }
    span.end();
    if (!success && errorClass) {
      emitDispatcherError(dispatcherMeter, { handler: type, errorClass });
    }
    // Consumer-abort (generator.return(), the normal SSE Tab-close path)
    // is not a handler failure — label it outcome:"aborted" so live-stream
    // success rates stay meaningful. True handler throws keep success:false.
    emitDispatcherHandler(
      dispatcherMeter,
      {
        handler: type,
        success,
        outcome: completedNormally ? "completed" : "aborted",
      },
      (performance.now() - start) / 1000,
    );
  }
}

// Feature-toggle gate. Returns the error to fold into a WriteFailure in the
// write path, or throws for the query path (where throws flow through the
// same outer instrumentation wrapper as other dispatcher errors).
//
// When `effectiveFeatures` is not wired (tests, apps without feature-toggles
// loaded), every handler is treated as enabled — the gate is a pure
// pass-through in that common case.
export async function checkFeatureEnabled(
  ctx: DispatchContext,
  qualifiedHandler: string,
  tenantId: TenantId,
): Promise<import("../errors/index.ts").FeatureDisabledError | undefined> {
  const { effectiveFeatures, registry } = ctx;
  if (!effectiveFeatures) return undefined;
  const owner = registry.getHandlerFeature(qualifiedHandler);
  // skip: handler without an owning feature cannot be toggled — shouldn't
  // happen for registry-built handlers, but guards against edge-case
  // runtime injections.
  if (!owner) return undefined;
  const set = effectiveFeatures(tenantId);
  if (set.has(owner)) return undefined;
  // Feature is off for the stored tier — give the live trial-gate a last
  // chance. Time-derived (tenant.inserted_at + window), so it can't live in
  // the boot-cached sync resolver; consulted only on this already-disabled
  // cold path, never on the hot enabled path.
  if (effectiveFeatures.trialGate && (await effectiveFeatures.trialGate(tenantId, owner))) {
    return undefined;
  }
  return new FeatureDisabledError(owner, qualifiedHandler);
}

export async function ensureFeatureEnabled(
  ctx: DispatchContext,
  qualifiedHandler: string,
  tenantId: TenantId,
): Promise<void> {
  const err = await checkFeatureEnabled(ctx, qualifiedHandler, tenantId);
  if (err) throw err;
}

// systemScope handlers get a default per-tenant limit unless the app declared its own or
// opted out — but ONLY when a resolver is actually configured (an app without the
// rate-limiting feature must not start throwing InternalError on every systemScope call
// just because it never opted into L3), and never for a SYSTEM-identity caller (jobs,
// replay, internal queryAs(SYSTEM,...) — those are not the tenant-facing traffic this
// default protects against).
// per: "tenant+handler" (not "tenant") — a per-handler bucket so one hot systemScope
// handler cannot starve every other systemScope handler's shared tenant quota.
const DEFAULT_SYSTEM_SCOPE_RATE_LIMIT: RateLimitOption = {
  per: "tenant+handler",
  limit: 600,
  windowSeconds: 60,
};

function resolveEffectiveRateLimits(
  rateLimit: RateLimitDeclaration | undefined,
  isSystemScope: boolean,
  user: SessionUser,
  resolver: AppContext["rateLimit"],
): readonly RateLimitOption[] {
  const declared = declaredRateLimitOptions(rateLimit);
  if (declared.length > 0) return declared;
  if (!isSystemScope) return [];
  if (!resolver) return [];
  if (isSystemIdentity(user)) return [];
  return [DEFAULT_SYSTEM_SCOPE_RATE_LIMIT];
}

type BucketRequests = readonly RateLimitBucketRequest[];

// A single bucket keeps the plain enforce path; several go through one atomic
// all-or-nothing call so a rejection by one bucket never charges the others.
async function enforceBuckets(
  resolver: RateLimitResolver,
  requests: BucketRequests,
): Promise<void> {
  const [only, ...rest] = requests;
  // skip: no bucket to charge
  if (!only) return;
  await (rest.length === 0
    ? resolver.enforce(only.bucket, only.config)
    : resolver.enforceAll(requests));
}

// L3 rate limit gate. Called by both query and write paths before
// access-check. Reasoning:
//   - handler without rateLimit and not systemScope → no-op
//   - systemScope handler without rateLimit → DEFAULT_SYSTEM_SCOPE_RATE_LIMIT
//     applies, unless no resolver is configured or the caller is SYSTEM
//   - app booted without rateLimit resolver → InternalError so the
//     misconfig surfaces immediately, not on first 429 (only reachable once
//     an effective rate limit was actually resolved above)
//   - bucket builder returns "skip" (e.g. ip-based but no client IP):
//     pass through. ip-modes are commonly used at L1/L2 middleware
//     where the IP comes from Hono directly; falling back to "skip"
//     here keeps non-HTTP entry-points (jobs, MSPs) functional.
export async function enforceRateLimit(
  ctx: DispatchContext,
  rateLimit: RateLimitDeclaration | undefined,
  handlerName: string,
  user: SessionUser,
  isSystemScope: boolean,
  costOverride?: number,
): Promise<void> {
  const { appContext: context } = ctx;
  // skip: handler explicitly opts out via rateLimit: { disabled: true }
  if (isRateLimitDisabled(rateLimit)) return;
  const effective = resolveEffectiveRateLimits(rateLimit, isSystemScope, user, context.rateLimit);
  // skip: no rateLimit declared and not systemScope (or resolved to no-op) — nothing to enforce
  if (effective.length === 0) return;
  const reqCtx = requestContext.get();
  // A nested dispatch re-hitting a bucket its entry dispatch already charged
  // (e.g. a per:"ip" handler delegating via queryAs) must not cost a second token.
  // The mark is set only after a successful enforce and includes the limit
  // parameters: a denied or failed check never lets a later nested call through,
  // and a nested handler with a stricter limit on the same bucket is still checked.
  const charged = reqCtx?.chargedRateLimitBuckets;
  const pending: { readonly request: RateLimitBucketRequest; readonly chargedKey: string }[] = [];
  for (const option of effective) {
    const bucket = buildBucketKey(option, { handlerName, user, ip: reqCtx?.ip });
    // skip: ip-bucket + no IP (non-HTTP entry point) — pass through before
    // requiring a resolver; HTTP path always has an IP + L1/L2 middleware.
    if (bucket.kind === "skip") continue;
    const cost = costOverride ?? option.cost;
    const chargedKey = `${bucket.key}|${option.limit}|${option.windowSeconds}|${cost}`;
    // skip: this exact bucket, limit and window was already charged by the entry dispatch
    if (charged?.has(chargedKey)) continue;
    pending.push({
      request: {
        bucket: bucket.key,
        config: { limit: option.limit, windowSeconds: option.windowSeconds, cost },
      },
      chargedKey,
    });
  }
  // skip: every bucket was skipped or already charged — nothing left to enforce
  if (pending.length === 0) return;
  if (!context.rateLimit) {
    throw new InternalError({
      message: `Handler "${handlerName}" declares rateLimit but no RateLimitResolver is configured. Load the rate-limiting feature or remove the option.`,
    });
  }
  try {
    await enforceBuckets(
      context.rateLimit,
      pending.map(({ request }) => request),
    );
    for (const { chargedKey } of pending) charged?.add(chargedKey);
  } catch (error) {
    // Backend failure (Redis down): fail closed as 503, same as L1/L2.
    if (error instanceof RateLimitError) throw error;
    throw new RateLimitUnavailableError({
      cause: error instanceof Error ? error : new Error(String(error)),
    });
  }
}

// Payload-field rate limits (additionalRateLimits). Runs after schema
// validation so the field is typed, regardless of what the handler later
// returns — hit and non-hit callers see the same limit behavior. SYSTEM
// identities (jobs, internal dispatches) are not the anonymous traffic this
// protects against.
export async function enforcePayloadRateLimits(
  ctx: DispatchContext,
  limits: readonly PayloadRateLimitOption[] | undefined,
  handlerName: string,
  user: SessionUser,
  data: unknown,
): Promise<void> {
  // skip: no payload buckets declared, or a SYSTEM caller
  if (!limits || isSystemIdentity(user)) return;
  const { appContext: context } = ctx;
  const digest = context._rateLimitPayloadDigest;
  if (!context.rateLimit || !digest) {
    throw new InternalError({
      message: `Handler "${handlerName}" declares additionalRateLimits but no RateLimitResolver/payload digest is configured.`,
    });
  }
  // Boot validation guarantees an object schema; anything else must not pass unlimited.
  if (!isPlainObject(data)) {
    throw new InternalError({
      message: `Handler "${handlerName}" declares additionalRateLimits but its payload is not an object.`,
    });
  }
  const requests: RateLimitBucketRequest[] = [];
  for (const { per, limit, windowSeconds, cost, normalize } of limits) {
    const value = data[per.payloadField];
    // skip: optional field not sent — nothing to bucket on
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new InternalError({
        message: `Handler "${handlerName}" additionalRateLimits payloadField "${per.payloadField}" is not a string.`,
      });
    }
    const bucket = buildPayloadBucketKey(
      user.tenantId,
      handlerName,
      per.payloadField,
      digest(normalizePayloadBucketValue(value, normalize)),
    );
    requests.push({ bucket, config: { limit, windowSeconds, cost } });
  }
  await enforceBuckets(context.rateLimit, requests);
}

// Build the per-hook context every auth-claims invocation gets. Claims
// hooks run OUTSIDE any request transaction (login is itself the root
// operation, not a nested call) and read-only — so the TenantDb is
// scoped as "tenant" and no tx is threaded through. Cross-tenant lookups
// are denied: queryAs only reaches the claims user itself (no escapeHatch declaration site here).
function buildAuthClaimsContext(ctx: DispatchContext, user: SessionUser): AuthClaimsContext {
  const { appContext: context } = ctx;
  const dbSource = resolveDbSource(ctx, undefined);
  if (!dbSource) {
    throw new InternalError({
      message: "dispatcher.resolveAuthClaims requires a database connection — none is configured.",
    });
  }
  const db = createTenantDb({
    db: dbSource,
    tenantId: user.tenantId,
    mode: "tenant",
    tracer: context.tracer,
    meter: context.meter,
    grants: {
      report: createEscapeHatchReporter({
        handler: "r.authClaims hook",
        tenantId: user.tenantId,
        actor: user.id,
        sink: context._escapeHatchAuditSink,
        log: context.log ?? createFallbackLogger("dispatcher"),
        window: ctx.escapeHatchReportWindow,
      }),
      projectionRegistry: ctx.registry,
    },
  });
  const authClaimsConfigFactory = configAccessorFactoryOf(context);
  const configAccessor = authClaimsConfigFactory
    ? authClaimsConfigFactory({
        user: { id: user.id, tenantId: user.tenantId },
        db,
        secrets: context.secrets,
      })
    : undefined;
  const identitySwitch = createGatedIdentitySwitch("r.authClaims hook", user, false, {
    // Login is itself the root operation; the hook context is read-only.
    queryAs: (asUser: SessionUser, qn: string, payload: unknown) =>
      executeQuery(ctx, qn, payload, asUser, rootWriteOrigin(ctx.registry, qn, asUser)), // @wrapper-known semantic-alias
    writeAs: async () => {
      throw new InternalError({
        message: "r.authClaims hook context has no writeAs — auth-claims hooks are read-only.",
      });
    },
  });
  return {
    db,
    queryAs: identitySwitch.queryAs,
    ...(configAccessor && { config: configAccessor }),
  };
}

// guard:dup-ok the single runInSystemRowLevelSecurityScope call with this entry point's own reason
export function resolveAuthClaimsFn(
  ctx: DispatchContext,
  user: SessionUser,
): Promise<Record<string, unknown>> {
  return runInSystemRowLevelSecurityScope(
    "auth claims resolution reads memberships before a tenant is known",
    () => resolveAuthClaimsInScope(ctx, user),
  );
}

async function resolveAuthClaimsInScope(
  ctx: DispatchContext,
  user: SessionUser,
): Promise<Record<string, unknown>> {
  const { registry, appContext: context } = ctx;
  const hooks = registry.getAuthClaimsHooks();
  if (hooks.length === 0) return {};
  return runAuthClaimsResolver({
    user,
    hooks,
    contextFactory: (claimsUser: SessionUser) => buildAuthClaimsContext(ctx, claimsUser),
    ...(context.log && { log: context.log }),
  });
}
