import type { SseBroker } from "../api/sse-broker";
import type { buildEntityTable } from "../db/table-builder";
import { TENANT_MEMBERSHIPS_QUERY } from "../engine/extension-names";
import type { defineTransitions } from "../engine/state-machine";
import type { EffectiveFeaturesResolver } from "../engine/tier-resolver-extension";
import type {
  ActiveMembershipResult,
  AppContext,
  JobRunnerRef,
  Registry,
  SessionUser,
  WriteResult,
} from "../engine/types";
import type { TenantId } from "../engine/types/identifiers";
import { reraiseAsKumikoError } from "../errors";
import { getFallbackMeter, getFallbackTracer, registerStandardMetrics } from "../observability";
import { INTERACTIVE_SIGN_IN_POLICY, resolveActiveMembershipFn } from "./active-membership";
import { runBatch, unwrapSingle } from "./dispatch-batch";
import { executeQuery } from "./dispatch-query";
import type { BatchCommand, BatchResult, DispatchContext } from "./dispatch-shared";
import { resolveAuthClaimsFn } from "./dispatch-shared";
import { executeStream } from "./dispatch-stream";
import { type HandlerType, resolveType } from "./dispatcher-utils";
import type { IdempotencyGuard } from "./idempotency";
import type { LifecycleHooks } from "./lifecycle-pipeline";
import { createTenantTimezoneCache } from "./tenant-timezone-cache";

// Re-export for callers that reach for dispatcher-adjacent types (tests,
// HTTP-layer stubs) — dispatch consumes these, grouping the type-surface
// here keeps imports single-source.
export type { WriteResult } from "../engine/types";
export type { BatchCommand, BatchResult } from "./dispatch-shared";

export type DispatcherOptions = {
  idempotency?: IdempotencyGuard;
  lifecycle?: LifecycleHooks;
  jobRunner?: JobRunnerRef;
  // Qualified name of the membership-list query handler consulted by
  // dispatcher.resolveActiveMembership. Defaults to TENANT_MEMBERSHIPS_QUERY.
  membershipQuery?: string;
  // Resolves the effective-feature set per tenant — the dispatcher uses
  // it to gate calls to handlers of disabled features (403 feature_disabled)
  // and to populate ctx.hasFeature. Absent = all features treated as
  // always-on (no feature-toggles or tier-engine feature loaded). The
  // resolver must be fast and synchronous per call; implementations cache
  // tenant-keyed sets and refresh on tier-assignment / toggle events.
  //
  // **System-context convention:** when called with SYSTEM_TENANT_ID, the
  // resolver should return the union/superset of all tier-features. Two
  // contexts call with this sentinel:
  //   1. event-dispatcher async-pass (consumers tagged with feature X
  //      should not silently skip events from a tenant where X is off —
  //      events are immutable, async work runs through).
  //   2. operator-tooling queries (e.g. feature-toggles:registered) where
  //      a SystemAdmin needs to see platform-truth, not their own
  //      tier-cut.
  // Returning a non-superset for SYSTEM_TENANT_ID will cause silent
  // event-skips and a confusing operator-UI — the framework cannot
  // enforce this contract, but the recipe-test pins the convention.
  effectiveFeatures?: EffectiveFeaturesResolver;
  // In-memory SSE broker — dispatch-stream.ts subscribes to a stream's
  // user-scoped access-invalidation channel on it. Absent in setups without
  // SSE wired up (dispatch-stream then just skips the subscription).
  sseBroker?: SseBroker;
};

export type Dispatcher = {
  write(
    type: HandlerType,
    payload: unknown,
    user: SessionUser,
    requestId?: string,
  ): Promise<WriteResult>;
  query(type: HandlerType, payload: unknown, user: SessionUser): Promise<unknown>;
  // AsyncGenerator, not Promise — gates (feature/rate-limit/access/
  // validation) fire on the consumer's first `.next()` pull, not on this
  // call, since they live inside the underlying async function*.
  stream(type: HandlerType, payload: unknown, user: SessionUser): AsyncGenerator<unknown>;
  command(type: HandlerType, payload: unknown, user: SessionUser): Promise<void>;
  // Atomic multi-command write: all commands run in a single DB transaction.
  // On any failure, the transaction rolls back and afterCommit hooks do NOT fire.
  // On success, afterCommit hooks of every command are fired sequentially after commit.
  //
  // requestId enables idempotent retries (for the Savable-Dispatcher): a repeated
  // batch with the same requestId returns the cached result without re-executing.
  batch(
    commands: readonly BatchCommand[],
    user: SessionUser,
    requestId?: string,
  ): Promise<BatchResult>;
  // Run every registered r.authClaims() hook against `user` and merge their
  // returns under the "<featureName>:<key>" auto-prefix. Used at login and
  // switch-tenant to populate SessionUser.claims before signing the JWT.
  // This is the single resolve implementation — ctx.resolveAuthClaims is a
  // thin pass-through so both entry points can't drift.
  resolveAuthClaims(user: SessionUser): Promise<Record<string, unknown>>;
  // Membership check for interactive sign-in paths (login, MFA completion,
  // tenant switch) — single resolve implementation so callers can't independently drift.
  resolveActiveMembership(userId: string, tenantId: TenantId): Promise<ActiveMembershipResult>;
};

export function createDispatcher(
  registry: Registry,
  context: AppContext,
  options: DispatcherOptions = {},
): Dispatcher {
  const { idempotency, lifecycle, jobRunner, effectiveFeatures, sseBroker } = options;
  const membershipQuery = options.membershipQuery ?? TENANT_MEMBERSHIPS_QUERY;

  // Pre-build tables and transition maps for auto-guard (avoid per-request allocation)
  const tableCache = new Map<string, ReturnType<typeof buildEntityTable>>();
  const transitionCache = new Map<string, ReturnType<typeof defineTransitions>>();
  // One per dispatcher instance (not a module-level singleton) so caches
  // never leak across separately-booted apps or test stacks.
  const tenantTimezoneCache = createTenantTimezoneCache();

  const dispatcherTracer = context.tracer ?? getFallbackTracer();
  const dispatcherMeter = context.meter ?? getFallbackMeter();
  // Ensure standard metrics exist on whatever meter we ended up with.
  // Idempotent: buildServer may have registered them already.
  registerStandardMetrics(dispatcherMeter);

  const ctx: DispatchContext = {
    registry,
    appContext: context,
    idempotency,
    lifecycle,
    jobRunner,
    effectiveFeatures,
    sseBroker,
    tableCache,
    transitionCache,
    tenantTimezoneCache,
    tracer: dispatcherTracer,
    meter: dispatcherMeter,
    membershipQuery,
  };

  return {
    async write(typeOrRef, payload, user, requestId?) {
      const type = resolveType(typeOrRef);
      // Idempotency handled inside runBatch (caches BatchResult under requestId).
      const batchResult = await runBatch(ctx, [{ type, payload }], user, requestId);
      return unwrapSingle(batchResult);
    },

    batch: (commands, user, requestId?) => runBatch(ctx, commands, user, requestId),

    query: (typeOrRef, payload, user) => executeQuery(ctx, resolveType(typeOrRef), payload, user),

    stream: (typeOrRef, payload, user) => executeStream(ctx, resolveType(typeOrRef), payload, user),

    async command(typeOrRef, payload, user) {
      const type = resolveType(typeOrRef);
      const batchResult = await runBatch(ctx, [{ type, payload }], user);
      const result = unwrapSingle(batchResult);

      if (!result.isSuccess) {
        throw reraiseAsKumikoError(result.error);
      }
    },

    resolveAuthClaims: (user) => resolveAuthClaimsFn(ctx, user),

    resolveActiveMembership: (userId, tenantId) =>
      resolveActiveMembershipFn(ctx, userId, tenantId, INTERACTIVE_SIGN_IN_POLICY),
  };
}
