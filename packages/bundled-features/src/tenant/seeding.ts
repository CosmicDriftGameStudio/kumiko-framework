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

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbRunner,
} from "@cosmicdrift/kumiko-framework/db";
import {
  type AppContext,
  HookPhases,
  type Registry,
  type SaveContext,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { getUnscopedAggregateStreamMaxVersion } from "@cosmicdrift/kumiko-framework/event-store";
import { createLifecycleHooks } from "@cosmicdrift/kumiko-framework/pipeline";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { assertAssignableMembershipRoles } from "./membership-roles";
import { tenantMembershipEntity, tenantMembershipsTable } from "./membership-table";
import { tenantEntity, tenantTable } from "./schema/tenant";

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
   * the projection's inserted_by_id column). Defaults to TestUsers.systemAdmin
   * — mirrors the real call-path, where add-member is SystemAdmin-only.
   */
  readonly by?: SessionUser;
};

export type SeedTenantOptions = {
  /** Stable UUID — required for fixtures so the FE/BE können dieselbe ID
   *  hardcoden (Sample-Switcher zeigt den Tenant beim Namen, der Test
   *  prüft Memberships gegen exakt diese ID). Ohne ID müsste der Caller
   *  den lookup-by-key extra machen. */
  readonly id: TenantId;
  /** URL-/Slug-Form (z.B. "dev", "acme"). Indexed unique in der DB. */
  readonly key: string;
  /** Human-readable label (im Switcher angezeigt). */
  readonly name: string;
  readonly by?: SessionUser;
};

// seedTenant runs through the raw event-store executor, which fires no
// postSave hooks (#1463) — feature-registered entity hooks on "tenant"
// (e.g. tier-engine's auto-default-tier, an app's auto-default-compliance)
// silently never run for tenants created this way. Pass `hooks` to fire
// them explicitly, same lookup as the dispatcher (registry.getEntityPostSaveHooks
// by result.entityName), just without the full dispatch roundtrip. Omit it
// to keep today's hook-less behavior (existing fixture call-sites that don't
// care about hooks need no changes).
export type SeedTenantHooks = {
  readonly registry: Registry;
  readonly context: AppContext;
};

// Shared by seedTenant/seedTenantMembership/auth-email-password's
// seedUserWithPassword: fires the same entity-scoped postSave hooks the
// real dispatcher would (registry.getEntityPostSaveHooks by entityName),
// just without the full HTTP/JWT roundtrip a fixture doesn't need. Fresh
// lifecycle-hooks instance per call, no systemHooks — only feature-
// registered entity/handler hooks fire (search-index/SSE system hooks are
// wired at server-boot and out of reach here).
//
// Tenant re-scope (#1566): when `targetTenantId` is set we rebuild the
// tenant-bound pieces of the context (`_tenantId`, `db`, `notify`,
// `hasFeature`, `user.tenantId`) — a shallow `{ ...ctx, _tenantId }` left
// closures over the caller's tenant (self-signup is anonymous/system).
// `query`/`write` bridges still share the caller's identity; hooks that
// need a full identity switch use `writeAs`/`queryAs`.
//
// afterCommit (#1566): when `hooks.context.scheduleAfterCommit` is present
// (HandlerContext from a live write), afterCommit hooks are queued onto the
// dispatcher's sink and flush post-commit. Without a sink (fixture / plain
// Connection) they still fire immediately — there is no outer TX to wait for.
function resolveRawDb(db: AppContext["db"]): DbRunner | undefined {
  if (!db) return undefined;
  if (typeof db === "object" && "raw" in db) {
    return (db as { raw: DbRunner }).raw;
  }
  return db as DbRunner;
}

function scopeSeedHookContext(context: AppContext, targetTenantId: TenantId): AppContext {
  const raw = resolveRawDb(context.db);
  const db = raw
    ? createTenantDb(raw, targetTenantId, "system", context.tracer, context.meter, context.signal)
    : context.db;

  // HandlerContext carries `user`; AppContext only `systemUser`. Prefer the
  // live handler user when present so notify/hasFeature keep a real SessionUser.
  const handlerUser = (context as { user?: SessionUser }).user;
  const baseUser: SessionUser | undefined = handlerUser ?? context.systemUser;
  const scopedUser: SessionUser | undefined = baseUser
    ? { ...baseUser, tenantId: targetTenantId }
    : undefined;

  const notify =
    context._notifyFactory && scopedUser
      ? context._notifyFactory(scopedUser, targetTenantId)
      : context.notify;

  const features = context.effectiveFeatures as
    | (((tenantId: TenantId) => ReadonlySet<string>) & {
        trialGate?: (tenantId: TenantId, featureName: string) => Promise<boolean>;
      })
    | undefined;
  const hasFeature = features
    ? async (featureName: string): Promise<boolean> => {
        if (features(targetTenantId).has(featureName)) return true;
        if (!features.trialGate) return false;
        return features.trialGate(targetTenantId, featureName);
      }
    : "hasFeature" in context
      ? // Keep caller's hasFeature when no effectiveFeatures (always-on apps).
        (context as { hasFeature?: (n: string) => Promise<boolean> }).hasFeature
      : undefined;

  return {
    ...context,
    _tenantId: targetTenantId,
    ...(db !== undefined ? { db } : {}),
    ...(notify !== undefined ? { notify } : {}),
    ...(scopedUser && "user" in context ? { user: scopedUser } : {}),
    ...(hasFeature ? { hasFeature } : {}),
  };
}

export async function fireEntityPostSave(
  hooks: SeedTenantHooks | undefined,
  pseudoType: string,
  entityData: SaveContext,
  // Undefined for tenant-agnostic entities (user has no tenant_id column at
  // seed time) — keeps hooks.context._tenantId as the caller passed it.
  targetTenantId?: TenantId,
): Promise<void> {
  // skip: caller opted out of hooks (existing fixture/test call-sites that
  // don't pass them keep today's hook-less behavior, see seedTenant's doc).
  if (!hooks) return;
  const lifecycle = createLifecycleHooks(hooks.registry);
  const scopedContext =
    targetTenantId === undefined
      ? hooks.context
      : scopeSeedHookContext(hooks.context, targetTenantId);
  await lifecycle.runPostSave(pseudoType, entityData, scopedContext, HookPhases.inTransaction);
  const runAfterCommit = () =>
    lifecycle.runPostSave(pseudoType, entityData, scopedContext, HookPhases.afterCommit);
  if (scopedContext.scheduleAfterCommit) {
    scopedContext.scheduleAfterCommit(runAfterCommit);
  } else {
    await runAfterCommit();
  }
}

/**
 * Seed a tenant through the event-store executor. Idempotent add-only:
 * a second call for the same `id` is a no-op (no update path). Same
 * TX-semantics as the real `TenantHandlers.create`, minus the SystemAdmin-
 * access-check and minus ConflictError-on-duplicate.
 */
export async function seedTenant(
  db: DbRunner,
  options: SeedTenantOptions,
  hooks?: SeedTenantHooks,
): Promise<{ id: TenantId }> {
  const by = options.by ?? TestUsers.systemAdmin;
  // executor.create erwartet eine TenantDb (mit .insert()-API), nicht
  // die rohe DbConnection. Auch wenn das Tenant-Aggregat selbst NICHT
  // tenant-scoped ist, braucht der Wrap-Layer für die runtime-API zu
  // existieren. by.tenantId reicht — keine Override-Semantik wie bei
  // seedTenantMembership nötig.
  const tdb = createTenantDb(db, by.tenantId, "system");

  const existing = await fetchOne(db, tenantTable, { id: options.id });
  if (existing) return { id: options.id };

  // Idempotenz: Aggregate kann im Event-Store existieren ohne Projection-Row
  // (Projection-Drift nach rebuild, manuellem DELETE, oder async-lag). Wenn
  // Stream-Version > 0 → kein create() — wäre version_conflict. Caller
  // bekommt die ID, Projection wird beim nächsten Dispatcher-Cycle aufgebaut.
  const streamVersion = await getUnscopedAggregateStreamMaxVersion(db, options.id);
  if (streamVersion > 0) return { id: options.id };

  const result = await tenantExecutor.create(
    { id: options.id, key: options.key, name: options.name },
    by,
    tdb,
  );
  if (!result.isSuccess) {
    throw new Error(
      `seedTenant failed: ${result.error.code} — ${JSON.stringify(result.error.details ?? {})}`,
    );
  }

  // "tenant:seed" matches no handler-scoped hook, only entity-scoped ones
  // (keyed by result.entityName === "tenant") — that's exactly what
  // tier-engine's `r.hook("postSave", { allOf: "tenant" }, ...)` needs.
  await fireEntityPostSave(hooks, "tenant:seed", result.data, options.id);

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
  // (#1478): fires tenantMembership's postSave hooks (e.g. a Welcome-
  // notification or default-notification-preferences hook keyed off
  // `allOf: "tenantMembership"`) for fixtures/self-signup that opt in.
  // Omit to keep today's hook-less behavior.
  hooks?: SeedTenantHooks,
): Promise<{ id: string }> {
  // Chokepoint: invite-accept (×3) + seedAdmin/provisionSignup all flow
  // through here — reject reserved/global roles before they ever persist.
  assertAssignableMembershipRoles(options.roles);
  const by = options.by ?? TestUsers.systemAdmin;
  // Wrap into a system-scoped TenantDb so the insert respects the tenant-
  // override (we write into options.tenantId, which may differ from by.tenantId).
  const tdb = createTenantDb(db, by.tenantId, "system");

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

  const result = await executor.create(
    {
      userId: options.userId,
      tenantId: options.tenantId,
      roles: JSON.stringify(options.roles),
    },
    by,
    tdb,
  );
  if (!result.isSuccess) {
    throw new Error(
      `seedTenantMembership failed: ${result.error.code} — ${JSON.stringify(result.error.details ?? {})}`,
    );
  }
  await fireEntityPostSave(hooks, "tenant-membership:seed", result.data, options.tenantId);
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
