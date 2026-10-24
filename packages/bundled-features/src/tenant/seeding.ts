// Testing helpers for the tenant feature. `seedTenantMembership` replaces
// the pre-ES pattern of `db.insert(tenantMembershipsTable).values({...})`
// in test fixtures — a direct-write bypasses the event-store executor, so
// seeded memberships have no stream, no `.created` event, and projections
// that consume membership events stay empty.
//
// The helper runs through the executor (same TX-semantics as the
// add-member handler), which means fixtures are event-sourced end-to-end:
//   - events table gets a `tenantMembership.created` row
//   - projection row (tenant_memberships) is written in the same TX
//   - consumers (MSPs, audit) see the event just like a real call would
//
// Why this lives in bundled-features/tenant/testing rather than
// framework/testing: the helper closes over `tenantMembershipEntity` +
// `tenantMembershipsTable`, both owned by this feature. framework/testing
// stays shape-independent.
//
// Why not "just call the addMember handler via stack.http.writeOk":
//   1. Handler requires SystemAdmin — test fixtures often seed OTHER users
//      before any admin exists, so the handler would 403.
//   2. Handler goes through HTTP → JWT mint → dispatcher. Overhead for
//      fixture state-setup that the test doesn't exercise.
// The executor path skips access-checks by design (no HTTP, no JWT — this
// IS a test fixture, not a user request) while still producing the
// correct event + projection.
//
// Idempotent (add-only): calling twice for the same (userId, tenantId) is
// a no-op on the second call. Memberships have no update-semantic — to
// change roles, write a new event via the regular handler path.

import {
  createEventStoreExecutor,
  createTenantDb,
  type DbRunner,
  fetchOne,
} from "@cosmicdrift/kumiko-framework/db";
import {
  attachOutsideTransaction,
  createSystemUser,
  type HandlerContext,
  HookPhases,
  type Registry,
  type SaveContext,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { getUnscopedAggregateStreamMaxVersion } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createDeferringNotify,
  createLifecycleHooks,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { assertAssignableMembershipRoles } from "./membership-roles.ts";
import { tenantMembershipEntity, tenantMembershipsTable } from "./membership-table.ts";
import { tenantEntity, tenantTable } from "./schema/tenant.ts";

const tenantExecutor = createEventStoreExecutor(tenantTable, tenantEntity, {
  entityName: "tenant",
});

const executor = createEventStoreExecutor(tenantMembershipsTable, tenantMembershipEntity, {
  entityName: "tenant-membership",
});

export type SeedTenantMembershipOptions = {
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly roles: readonly string[];
  /**
   * SessionUser to bill the event against (goes into event.metadata.userId +
   * the projection's inserted_by_id column). Defaults to
   * createSystemUser(tenantId) so the event stream tenant matches the
   * membership row — otherwise later updates from that tenant cannot find
   * the stream (version_conflict / currentVersion=0).
   */
  readonly by?: SessionUser;
};

export type SeedTenantOptions = {
  /**
   * Stable UUID required for fixtures so the FE/BE can hardcode the same ID. The sample switcher
   * displays the tenant by name, while tests verify memberships against this exact ID; without it,
   * callers would need an extra lookup by key.
   */
  readonly id: TenantId;
  /** URL/slug form (for example, "dev" or "acme"). Indexed unique in the database. */
  readonly key: string;
  /** Human-readable label (im Switcher angezeigt). */
  readonly name: string;
  readonly by?: SessionUser;
};

// seedTenant runs through the raw event-store executor, which fires no
// postSave hooks — feature-registered entity hooks on "tenant"
// (e.g. tier-engine's auto-default-tier, an app's auto-default-compliance)
// silently never run for tenants created this way. Pass `hooks` to fire
// them explicitly, same lookup as the dispatcher (registry.getEntityPostSaveHooks
// by result.entityName), just without the full dispatch roundtrip. Omit it
// to keep today's hook-less behavior (existing fixture call-sites that don't
// care about hooks need no changes).
export type SeedTenantHooks = {
  readonly registry: Registry;
  readonly context: HandlerContext;
};

function buildSeedHookNotify(
  context: HandlerContext,
  scopedUser: SessionUser,
  targetTenantId: TenantId,
  notifyTiming: "deferUntilCommit" | "inline",
): HandlerContext["notify"] {
  const { services, lifecycle } = context;
  const notifyFactory = services._notifyFactory;
  if (!notifyFactory) return context.notify;
  const notifyAfterCommit = (services._notifyAfterCommitFactory ?? notifyFactory)(
    scopedUser,
    targetTenantId,
  );
  if (notifyTiming === "inline") return notifyAfterCommit;
  // Still inside the caller's write tx: delivery DB work must not wait for an app-pool slot.
  const notifyInsideTransaction = (services._notifyInTransactionFactory ?? notifyFactory)(
    scopedUser,
    targetTenantId,
  );
  const scheduleAfterCommit = lifecycle.afterCommit;
  if (!scheduleAfterCommit) return notifyInsideTransaction;
  return createDeferringNotify({
    registry: context.registry,
    tenantId: targetTenantId,
    notifyAfterCommit,
    notifyNow: notifyInsideTransaction,
    scheduleAfterCommit,
  });
}

type TrialGate = (tenantId: TenantId, featureName: string) => Promise<boolean>;

function isTrialGate(candidate: unknown): candidate is TrialGate {
  return typeof candidate === "function";
}

function scopedHasFeature(
  context: HandlerContext,
  targetTenantId: TenantId,
): HandlerContext["hasFeature"] {
  const features = context.services.effectiveFeatures;
  // Keep the caller's hasFeature when no effectiveFeatures is wired (always-on apps).
  if (!features) return context.hasFeature;
  const trialGate: unknown = Reflect.get(features, "trialGate");
  return async (featureName) => {
    if (features(targetTenantId).has(featureName)) return true;
    return isTrialGate(trialGate) ? trialGate(targetTenantId, featureName) : false;
  };
}

// Shared by seedTenant/seedTenantMembership/auth-email-password's
// seedUserWithPassword: fires the same entity-scoped postSave hooks the
// real dispatcher would (registry.getEntityPostSaveHooks by entityName),
// just without the full HTTP/JWT roundtrip a fixture doesn't need. Fresh
// lifecycle-hooks instance per call, no systemHooks — only feature-
// registered entity/handler hooks fire (search-index/SSE system hooks are
// wired at server-boot and out of reach here).
//
// Tenant re-scope: when `targetTenantId` is set we rebuild the
// tenant-bound pieces of the context (`db`, `notify`, `hasFeature`,
// `user.tenantId`) — a shallow copy left closures over the caller's tenant
// (self-signup is anonymous/system). `query`/`write` bridges still share the
// caller's identity; hooks that need a full identity switch use `writeAs`/`queryAs`.
//
// afterCommit: when `hooks.context.lifecycle.afterCommit` is present
// (HandlerContext from a live write), afterCommit hooks are queued onto the
// dispatcher's sink and flush post-commit. Without a sink (fixture / plain
// Connection) they still fire immediately — there is no outer TX to wait for.
// `runner` comes from the caller, which already holds a declared DbRunner —
// a TenantDb exposes no runner back out to feature code.
function scopeSeedHookContext(
  context: HandlerContext,
  targetTenantId: TenantId,
  runner: DbRunner,
  // The afterCommit sink is snapshotted when it flushes, so a hook scheduled from inside an
  // afterCommit-phase hook would be dropped: that phase must notify inline.
  notifyTiming: "deferUntilCommit" | "inline",
): HandlerContext {
  const db = createTenantDb({
    db: runner,
    tenantId: targetTenantId,
    mode: "system",
    reason: "seed hooks run in the seeded tenant, regardless of the caller's tenant",
    tracer: context.obs.tracer,
    meter: context.obs.meter,
    signal: context.lifecycle.signal,
  });
  const scopedUser: SessionUser = { ...context.user, tenantId: targetTenantId };
  const notify = buildSeedHookNotify(context, scopedUser, targetTenantId, notifyTiming);

  return {
    ...context,
    db: attachOutsideTransaction(db, undefined),
    ...(notify !== undefined ? { notify } : {}),
    user: scopedUser,
    hasFeature: scopedHasFeature(context, targetTenantId),
  };
}

export async function fireEntityPostSave(
  hooks: SeedTenantHooks | undefined,
  pseudoType: string,
  entityData: SaveContext,
  // Undefined for tenant-agnostic entities (user has no tenant_id column at
  // seed time) — keeps hooks.context.user as the caller passed it.
  target?: { readonly tenantId: TenantId; readonly db: DbRunner },
): Promise<void> {
  // skip: caller opted out of hooks (existing fixture/test call-sites that
  // don't pass them keep today's hook-less behavior, see seedTenant's doc).
  if (!hooks) return;
  const lifecycle = createLifecycleHooks(hooks.registry);
  const scopedContext =
    target === undefined
      ? hooks.context
      : scopeSeedHookContext(hooks.context, target.tenantId, target.db, "deferUntilCommit");
  await lifecycle.runPostSave(pseudoType, entityData, scopedContext, HookPhases.inTransaction);
  const runAfterCommit = () =>
    lifecycle.runPostSave(
      pseudoType,
      entityData,
      target === undefined
        ? hooks.context
        : scopeSeedHookContext(hooks.context, target.tenantId, target.db, "inline"),
      HookPhases.afterCommit,
    );
  if (scopedContext.lifecycle.afterCommit) {
    scopedContext.lifecycle.afterCommit(runAfterCommit);
  } else {
    await runAfterCommit();
  }
}

/**
 * Seed a tenant through the event-store executor. Idempotent add-only:
 * a second call for the same `id` is a no-op (no update path). Same
 * TX-semantics as the real `TenantHandlers.create`, minus the SystemAdmin-
 * access-check and minus ConflictError-on-duplicate.
 *
 * `hooks` run only for the call that actually creates the tenant: a call that
 * finds the tenant/stream already present (or loses a concurrent create race)
 * returns without firing postSave.
 */
export async function seedTenant(
  db: DbRunner,
  options: SeedTenantOptions,
  hooks?: SeedTenantHooks,
): Promise<{ id: TenantId }> {
  const by = options.by ?? createSystemUser(SYSTEM_TENANT_ID);
  // The tenant aggregate is global: its row and stream live on SYSTEM_TENANT_ID whatever tenant `by` acts from.
  const tdb = createTenantDb({
    db,
    tenantId: SYSTEM_TENANT_ID,
    mode: "system",
    reason:
      "the global tenant aggregate lives on SYSTEM_TENANT_ID whatever tenant the seeding actor acts from",
  });

  const existing = await fetchOne(db, tenantTable, { id: options.id });
  if (existing) return { id: options.id };

  // Idempotency: the aggregate may exist in the event store without a
  // projection row (projection drift after a rebuild, manual DELETE, or async
  // lag). If the stream version is > 0, skip create() to avoid
  // version_conflict. Return the ID; the next dispatcher cycle can rebuild the
  // projection.
  const streamVersion = await getUnscopedAggregateStreamMaxVersion(db, options.id);
  if (streamVersion > 0) return { id: options.id };

  const result = await tenantExecutor.create(
    { id: options.id, key: options.key, name: options.name },
    by,
    tdb,
  );
  if (!result.isSuccess) {
    // Same idempotency case as the stream-version check above, only detected
    // one instruction later: a concurrent writer (e.g. a parallel seedTenant
    // for the same id) created the stream between the version read above and
    // this create; the executor confines the failed append to a savepoint, so
    // the surrounding TX stays usable. Both paths return without firing
    // postSave — hooks only run for the call that actually created the tenant.
    if (result.error.code === "version_conflict") return { id: options.id };
    throw new Error(
      `seedTenant failed: ${result.error.code} — ${JSON.stringify(result.error.details ?? {})}`,
    );
  }

  // "tenant:seed" matches no handler-scoped hook, only entity-scoped ones
  // (keyed by result.entityName === "tenant") — that's exactly what
  // tier-engine's `r.hook({ type: "postSave", target: { allOf: "tenant" }, ... })` needs.
  await fireEntityPostSave(hooks, "tenant:seed", result.data, { tenantId: options.id, db });

  return { id: options.id };
}

/**
 * Seed a tenant membership through the event-store executor. Writes
 * both a `tenantMembership.created` event and the corresponding
 * projection row in one transaction — identical effect to
 * `TenantHandlers.addMember`, minus the access-check and minus the
 * ConflictError on duplicates (duplicate calls no-op).
 *
 * Returns the membership-row id (existing on no-op, freshly minted on create).
 */
export async function seedTenantMembership(
  db: DbRunner,
  options: SeedTenantMembershipOptions,
  // Optional, append-only — same rationale as seedTenant's hooks param
  // fires tenantMembership's postSave hooks (e.g. a Welcome-
  // notification or default-notification-preferences hook keyed off
  // `allOf: "tenantMembership"`) for fixtures/self-signup that opt in.
  // Omit to keep today's hook-less behavior.
  hooks?: SeedTenantHooks,
): Promise<{ id: string }> {
  // Chokepoint: invite-accept (×3) + seedAdmin/provisionSignup all flow
  // through here — reject reserved/global roles before they ever persist.
  assertAssignableMembershipRoles(options.roles);
  const by = options.by ?? createSystemUser(options.tenantId);
  // System-scoped TenantDb: payload.tenantId may differ from an explicit
  // `by` override; stream tenant still follows `by` via streamTenantFor.
  const tdb = createTenantDb({
    db,
    tenantId: options.tenantId,
    mode: "system",
    reason: "membership seed targets an explicit tenant that may differ from the actor's",
  });

  // Idempotency: duplicate seeds are common across beforeEach-resets where
  // only certain tables get truncated. A plain executor.create would trip
  // the (user_id, tenant_id) unique index; the fixture call-site would then
  // have to juggle try/catch. Lookup-first keeps call-sites clean.
  const existing = await fetchOne(db, tenantMembershipsTable, {
    userId: options.userId,
    tenantId: options.tenantId,
  });
  if (existing) {
    // Same validation as the create-path — a missing/non-string id throws
    // instead of silently returning `undefined as string`.
    return { id: extractMembershipId(existing) };
  }

  // Keep by.id as audit actor, but force stream tenant to the membership tenant
  // so a cross-tenant `by` override cannot diverge row tenant vs event stream.
  const result = await executor.create(
    {
      userId: options.userId,
      tenantId: options.tenantId,
      roles: JSON.stringify(options.roles),
    },
    { ...by, tenantId: options.tenantId },
    tdb,
  );
  if (!result.isSuccess) {
    throw new Error(
      `seedTenantMembership failed: ${result.error.code} — ${JSON.stringify(result.error.details ?? {})}`,
    );
  }
  await fireEntityPostSave(hooks, "tenant-membership:seed", result.data, {
    tenantId: options.tenantId,
    db,
  });
  return { id: extractMembershipId(result.data) };
}

function extractMembershipId(data: unknown): string {
  if (typeof data === "object" && data !== null && "id" in data) {
    // @cast-boundary engine-bridge: executor.create returns the projection
    // row as Record<string, unknown>; id is uuid per entity definition.
    const id = (data as { id: unknown }).id;
    if (typeof id === "string") return id;
  }
  throw new Error(
    `seedTenantMembership: executor.create returned no string id (got ${JSON.stringify(data)})`,
  );
}
