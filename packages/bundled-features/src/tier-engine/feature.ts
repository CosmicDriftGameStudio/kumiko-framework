// tier-engine — Pricing-Tier-Mechanik als reguläres Bundled-Feature.
//
// **Was diese Feature macht:**
//   Speichert pro Plattform-Tenant ein Tier-Assignment (welcher Tier ist
//   aktiv). Optional (mit `tierMap` in Options): per-tenant feature-set
//   resolution via Framework's `tenantTierResolver`-extension — das
//   dispatcher-feature-gate fragt automatisch pro request den resolver
//   nach dem effective Set für den aktiven Tenant.
//
// **Zwei Use-Modes:**
//   1. `createTierEngineFeature()` ohne opts — nur Storage (Standard-CRUD
//      für tier-assignment-Entity). Apps die composeApp() oder eigene
//      logic nutzen.
//   2. `createTierEngineFeature({ defaultTier, tierMap })` — vollständige
//      Tier-Composition. Sprint-8a Pattern für multi-tenant SaaS-Apps.
//      Framework auto-wires effectiveFeatures via extension-pickup.
//
// **Generic über Tier-Werte:** das Feature kennt keine "free"/"pro"/etc.
//   konkreten Tier-Werte. App definiert ihre TierMap.
//
// **Auto-Default-Tier on Tenant-Signup:** wenn `opts.defaultTier` gesetzt
//   ist, schreibt ein r.entityHook("postSave", "tenant", phase: inTransaction)
//   automatisch eine tier-assignment für den neuen Tenant. Atomic mit
//   tenant-create — wenn tier-assignment fail't, tenant-create rolled back.
//   Idempotent via deterministic aggregate-id (re-replay re-checkt stream-
//   version, skip wenn schon da). Plus: cache-miss-fallback returnt
//   defaultTier-features wenn assignment-row fehlt (defense-in-depth gegen
//   replay-races wo der hook noch nicht durch ist).
//
// **In-Memory-Cache mit Push-Invalidation:**
//   Closure-state pro feature-instance hält die effective Sets pro Tenant.
//   r.entityHook auf tier-assignment:postSave/postDelete hält cache aktuell.
//   Erste-Request-Cold-Cache: pre-load via build(deps) im extension-pickup
//   Pfad (boot-time via runDevApp/runProdApp).
//
// **SYSTEM_TENANT_ID-Convention:**
//   resolver-callback bei call mit SYSTEM_TENANT_ID returnt union aller
//   tier-features (für event-dispatcher async-pass + operator-tooling).
//   Siehe DispatcherOptions.effectiveFeatures-doc.
//
// **Boot-Dependencies:** config + tenant.

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
} from "@cosmicdrift/kumiko-framework/db";
import {
  defineEntityCreateHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
  defineQueryHandler,
  type FeatureDefinition,
  HookPhases,
  type SessionUser,
  SYSTEM_TENANT_ID,
  TENANT_TIER_RESOLVER_EXT,
  type TenantId,
  type TierResolverPlugin,
} from "@cosmicdrift/kumiko-framework/engine";
import { getAggregateStreamMaxVersion } from "@cosmicdrift/kumiko-framework/event-store";
import { z } from "zod";
import { tierAssignmentAggregateId } from "./aggregate-id";
import type { TierMap } from "./compose-app";
import { TIER_ENGINE_FEATURE } from "./constants";
import { tierAssignmentEntity } from "./entity";
import { getActiveTierQuery } from "./handlers/active-tier.query";
import { getTenantTierQuery } from "./handlers/get-tenant-tier.query";
import { setTenantTierWrite } from "./handlers/set-tenant-tier.write";

// Drizzle-table for the tier-assignment-entity. Built once at module-load
// from the entity definition — same shape buildEntityTable would produce
// in the App's drizzle/schema.generated.ts.
const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);

// Event-store-executor für direct-write aus dem auto-default-tier-hook.
// Pattern wie tenant/seeding.ts: hook sieht AppContext (kein ctx.write),
// muss aber atomisch mit tenant-create im selben TX schreiben → executor
// direkt aufrufen, nicht via dispatcher.
const tierAssignmentExecutor = createEventStoreExecutor(tierAssignmentTable, tierAssignmentEntity, {
  entityName: "tier-assignment",
});

const adminAccess = { access: { roles: ["TenantAdmin", "SystemAdmin"] } } as const;
// Tier-Wechsel ist Plattform-/Billing-Hoheit — ein Tenant-Admin darf den
// eigenen Tier NIE setzen (sonst Gratis-Self-Upgrade). Daher sind die
// Writes SystemAdmin-only; Reads (list, get-active-tier) bleiben
// TenantAdmin-sichtbar. Auto-default-Hook + Billing schreiben als System,
// hängen also nicht an diesem Handler-Access.
const writeAccess = { access: { roles: ["SystemAdmin"] } } as const;

/**
 * Options for createTierEngineFeature. Both fields optional — wenn beide
 * leer, ist die feature nur Storage (back-compat zu legacy `tierEngineFeature`).
 *
 * @template TCaps - App-spezifischer Cap-Shape. Type-leakt durch tierMap →
 * future capsFor() resolver returnt diesen Shape exakt.
 */
export type CreateTierEngineOptions<TCaps extends Readonly<Record<string, unknown>>> = {
  /**
   * Tier-Name der bei Tenant-signup automatisch geschrieben wird. Erfordert
   * dass `tierMap` diesen Tier-Namen kennt (Boot-Validation).
   * Wenn weggelassen, kein auto-assign — App schreibt manuell.
   */
  readonly defaultTier?: string;

  /**
   * App-spezifische Tier-Map. Wenn gesetzt, registriert das feature sich
   * als plugin für `tenantTierResolver`-extension → framework auto-wires
   * effectiveFeatures pro tenant.
   * Wenn weggelassen, keine Resolver-extension — App muss `composeApp`
   * oder eigene resolution-logic nutzen (legacy-pattern).
   */
  readonly tierMap?: TierMap<TCaps>;
};

/**
 * Compute the union of features across all tiers — verwendet bei
 * SYSTEM_TENANT_ID-resolver-call (operator-tooling, async-event-dispatch).
 * Operator-UI sieht alle features unabhängig vom tier-cut, async-events
 * laufen tier-agnostic durch.
 */
function unionAllTierFeatures<TCaps extends Readonly<Record<string, unknown>>>(
  tierMap: TierMap<TCaps>,
): ReadonlySet<string> {
  const all = new Set<string>();
  for (const tier of Object.values(tierMap)) {
    for (const f of tier.features) all.add(f);
  }
  return all;
}

/**
 * Compute the feature-set for a given tier-name. Unknown tier → empty Set
 * (defensive — verwendete tier-namen werden nicht an boot-time validiert
 * weil tier-engine generic über tier-Werte ist).
 */
function featuresForTier<TCaps extends Readonly<Record<string, unknown>>>(
  tierMap: TierMap<TCaps>,
  tierName: string,
): ReadonlySet<string> {
  const tier = tierMap[tierName];
  if (!tier) return new Set();
  return new Set(tier.features);
}

/**
 * Merge always-on features (non-toggleable framework-base) mit tier-cut
 * features (toggleable per tier). Canonical Kumiko: dispatcher-gate
 * blockt nur features die explizit `r.toggleable()` haben — alle anderen
 * sind immer aktiv. Tier-resolver muss das selbe pattern liefern.
 */
function mergeAlwaysOn(
  alwaysOn: ReadonlySet<string>,
  tierFeatures: ReadonlySet<string>,
): ReadonlySet<string> {
  const merged = new Set<string>(alwaysOn);
  for (const f of tierFeatures) merged.add(f);
  return merged;
}

/**
 * Factory: create a tier-engine feature instance with optional auto-tier-
 * resolution + default-tier-on-signup behavior. Returns FeatureDefinition
 * mountable in run-config.
 */
export function createTierEngineFeature<
  TCaps extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
>(opts: CreateTierEngineOptions<TCaps> = {}): FeatureDefinition {
  return defineFeature(TIER_ENGINE_FEATURE, (r) => {
    r.describe(
      'Stores a `tier-assignment` entity per tenant (which pricing tier is active) and, when configured with a `TierMap`, registers itself as the `tenantTierResolver` extension so the dispatcher automatically gates `r.toggleable()` features per tenant based on their assigned tier. Call `createTierEngineFeature({ defaultTier, tierMap })` to get full tier composition \u2014 including an `inTransaction` entity hook that atomically writes the default tier when a new tenant is created \u2014 or use `createTierEngineFeature()` without options for storage-only mode when you manage tier assignment yourself via `composeApp`. A SystemAdmin-only `set-tenant-tier` write plus `get-tenant-tier`/`tier-options` reads let an operator assign a tier to ANY tenant manually \u2014 without a billing purchase \u2014 stamping `source: "manual"` so a future Stripe\u2192tier sync won\'t overwrite the grant. Apps surface this via the `tier-admin` screen.',
    );
    r.requires("config");
    r.requires("tenant");

    r.entity("tier-assignment", tierAssignmentEntity);

    // Standard-CRUD via Helper.
    r.writeHandler(defineEntityCreateHandler("tier-assignment", tierAssignmentEntity, writeAccess));
    r.writeHandler(defineEntityUpdateHandler("tier-assignment", tierAssignmentEntity, writeAccess));

    // Reads.
    r.queryHandler(defineEntityListHandler("tier-assignment", tierAssignmentEntity, adminAccess));
    r.queryHandler(getActiveTierQuery);

    // \u2500\u2500 Manueller Tier-Grant (SystemAdmin, ohne Billing) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // Cross-tenant set + read f\u00fcr den tier-admin-Screen. tier-options liefert
    // dem Client die App-Tier-Namen aus der tierMap-Closure (sonst hartkodiert).
    r.writeHandler(setTenantTierWrite);
    r.queryHandler(getTenantTierQuery);
    r.queryHandler(
      defineQueryHandler({
        name: "tier-options",
        schema: z.object({}),
        access: { roles: ["SystemAdmin"] },
        handler: async () => ({ tiers: opts.tierMap ? Object.keys(opts.tierMap) : [] }),
      }),
    );

    // ───────────────────────────────────────────────────────────────────
    // Resolver-extension (only when tierMap is configured)
    // ───────────────────────────────────────────────────────────────────
    // skip: ohne tierMap ist die feature nur Storage (legacy back-compat
    // zu `tierEngineFeature`). Resolver-extension + invalidation-hooks
    // brauchen die tierMap zum Mapping tier-name → feature-set.
    if (!opts.tierMap) return;

    const tierMap = opts.tierMap;

    // Closure-state: cache per-tenant effective Sets. Hooks halten den
    // cache aktuell during process-lifetime; build() im extension-pickup
    // pre-loaded existing assignments at boot.
    const cache = new Map<TenantId, ReadonlySet<string>>();
    // alwaysOn-Set wird in build(deps) aus registry.features berechnet (alle
    // non-toggleable features). Hooks brauchen Zugriff darauf für
    // mergeAlwaysOn-calls — Late-bind via mutable holder, gefüllt vor allen
    // Requests (build läuft pre-listen via runDevApp/runProdApp-pickup).
    const alwaysOnHolder: { set: ReadonlySet<string> } = { set: new Set() };

    // Invalidation: tier-assignment events update the cache.
    r.entityHook("postSave", "tier-assignment", async (result) => {
      // result.data has tenantId + tier (after entity-update merge)
      const data = result.data as { tenantId?: unknown; tier?: unknown }; // @cast-boundary engine-payload
      // skip: defensive type-guard auf payload-shape. Bei korrekt gerenderten
      // entity-events sind beide fields immer strings; ein malformed-payload
      // (custom-handler-bug) würde hier silent zum cache-skip führen statt
      // throwing — der lifecycle-pipeline darf nicht durch hook-fehler
      // blocken (afterCommit-pattern, side-effect-best-effort).
      if (typeof data.tenantId !== "string" || typeof data.tier !== "string") return;
      cache.set(
        data.tenantId as TenantId,
        mergeAlwaysOn(alwaysOnHolder.set, featuresForTier(tierMap, data.tier)),
      );
    });
    r.entityHook("postDelete", "tier-assignment", async (payload) => {
      const data = payload.data as { tenantId?: unknown }; // @cast-boundary engine-payload
      // skip: gleiche type-guard semantik wie postSave-hook oben.
      if (typeof data.tenantId !== "string") return;
      cache.delete(data.tenantId as TenantId);
    });

    // Auto-default-tier-on-tenant-signup: hook fires inTransaction (atomic
    // mit tenant-create rollback), schreibt tier-assignment via Direct-
    // Executor (nicht ctx.write — hook hat AppContext). Pattern analog
    // tenant/seeding.ts seedTenant.
    //
    // **Idempotency:** deterministic aggregate-id aus tenantId. Re-replay
    // (nach projection-rebuild oder hook-retry) findet stream-version > 0
    // und skipt, statt version_conflict zu werfen. Caller sieht erfolgreichen
    // tenant-create + bestehende tier-assignment.
    //
    // **Cross-tenant write:** executor braucht systemUser MIT tenantId =
    // neuer Tenant (Memory `feedback_event_store_tenant_consistency`).
    if (opts.defaultTier !== undefined) {
      const defaultTier = opts.defaultTier;
      r.entityHook(
        "postSave",
        "tenant",
        async (result, ctx) => {
          // result-shape: kumiko-framework's SaveContext mit isNew + data
          const saveResult = result as { isNew?: unknown; data?: unknown }; // @cast-boundary engine-payload
          // skip: nur bei tenant-create (initial) — tenant-updates feuern
          // auch postSave aber wir wollen kein neues tier-assignment bei
          // re-keying oder name-update.
          if (saveResult.isNew !== true) return;
          const data = saveResult.data as { id?: unknown }; // @cast-boundary engine-payload
          // skip: defensive type-guard. Tenant-entity hat id zwingend, aber
          // CrudExecutor's payload-shape ist runtime-unknown.
          if (typeof data.id !== "string") return;
          const newTenantId = data.id as TenantId; // @cast-boundary engine-payload
          const aggregateId = tierAssignmentAggregateId(newTenantId);

          // skip: defensive — inTransaction phase hat ctx.db immer gesetzt,
          // aber AppContext type macht's optional. Throw wäre overreach
          // (lifecycle blocking), silent-skip ist defensive-soft.
          if (!ctx.db) return;

          // ctx.db ist im inTransaction-phase eine TenantDb (tenant-scoped
          // proxy auf die echte TX). Für event-store-Pfade brauchen wir
          // die rohe DbConnection — TenantDb exposes nur select/insert/
          // update/delete, NICHT execute (event-store-append.ts:102 ruft
          // db.execute(sql`SELECT pg_notify(...)`) → TypeError sonst).
          // Pattern matched signup-confirm.write.ts:107 (.raw), nicht
          // `as DbConnection` — das ist Type-Lie der erst beim ersten
          // .execute()-Call crashed.
          //
          // AppContext.db ist union (DbConnection | TenantDb). Im
          // inTransaction-phase garantiert TenantDb — der dispatcher
          // wrapped vorher (siehe pipeline/dispatcher.ts createTenantDb-
          // Aufruf). TypeGuard via `"raw" in ...` ist robuster als
          // `as TenantDb` gegen future refactor.
          // skip: defensive — sollte im inTransaction nie greifen.
          if (!("raw" in ctx.db)) return;
          const rawDb = ctx.db.raw as DbConnection; // @cast-boundary db-runner

          // Idempotency: stream-existence-check vor create. Pattern aus
          // seedTenant.ts. Bei re-replay (rebuild) nicht versionsbumpen.
          const streamVersion = await getAggregateStreamMaxVersion(rawDb, aggregateId);
          // skip: idempotent — tier-assignment stream already seeded (rebuild/replay).
          if (streamVersion > 0) return;

          // SystemUser für den NEUEN tenant — der Hook wird vom signup-
          // user (anderer tenant, oder SystemAdmin) ausgelöst, aber das
          // tier-assignment muss im stream des neu-erzeugten tenants
          // landen (= aggregate-id deterministic auf newTenantId). Memory
          // `feedback_event_store_tenant_consistency`: by.tenantId muss =
          // ziel-tenant.
          const systemUser: SessionUser = {
            id: "00000000-0000-4000-8000-000000000001",
            tenantId: newTenantId,
            roles: ["SystemAdmin"],
          };
          const tdb = createTenantDb(rawDb, newTenantId, "system");

          await tierAssignmentExecutor.create(
            { id: aggregateId, tier: defaultTier, source: "default" },
            systemUser,
            tdb,
          );
        },
        { phase: HookPhases.inTransaction },
      );
    }

    // Extension-point declaration + self-registration. Pattern analog
    // mail-foundation/file-foundation: das feature deklariert den
    // extension-point UND registriert sich als default-plugin. Andere
    // features könnten später auch dort registrieren (z.B. ein future
    // toggle-only-resolver), aber nur ein plugin gewinnt — siehe
    // findTierResolverUsage's "single-plugin"-comment.
    r.extendsRegistrar(TENANT_TIER_RESOLVER_EXT, { onRegister: () => {} });

    // Plugin-registration: framework's runDevApp/runProdApp picks this up
    // post-stack-setup, calls build(deps), wires effectiveFeatures.
    const plugin: TierResolverPlugin = {
      build: async (deps) => {
        // Always-on-Set: alle non-toggleable features im registry. Canonical
        // Kumiko-pattern (matches feature-toggles' resolver): nur features
        // die explizit `r.toggleable()` registrieren sind tier-cuttable.
        // Framework-base-features (auth-email-password, config, user, tenant,
        // sessions, etc.) sind non-toggleable → IMMER aktiv für jeden Tenant
        // unabhängig vom tier. Sonst würde dispatcher 403 auf login-handler
        // werfen weil "feature auth-email-password disabled".
        const computedAlwaysOn = new Set<string>();
        for (const feature of deps.registry.features.values()) {
          if (feature.toggleableDefault === undefined) computedAlwaysOn.add(feature.name);
        }
        alwaysOnHolder.set = computedAlwaysOn;

        // Pre-load all existing assignments into cache. SaaS-Apps haben
        // typischerweise <100k tenants — single-pass scan akzeptabel.
        // Skalierungs-Pfad (lazy-load + LRU) ist Sprint-8b wenn echtes
        // Bedürfnis entsteht.
        type AssignmentRow = { tenantId: string; tier: string };
        const rows = await selectMany<AssignmentRow>(deps.db, tierAssignmentTable);
        for (const row of rows) {
          cache.set(
            row.tenantId as TenantId,
            mergeAlwaysOn(computedAlwaysOn, featuresForTier(tierMap, row.tier)),
          );
        }

        // Synchronous resolver-callback for dispatcher hot-path.
        return (tenantId: TenantId): ReadonlySet<string> => {
          // Operator-tooling + async-event-dispatch convention: SYSTEM_TENANT_ID
          // gets the union of all tier-features (siehe DispatcherOptions doc).
          if (tenantId === SYSTEM_TENANT_ID) {
            return mergeAlwaysOn(computedAlwaysOn, unionAllTierFeatures(tierMap));
          }
          const cached = cache.get(tenantId);
          if (cached !== undefined) return cached;
          // Cache-miss: tenant ist noch nicht im cache (z.B. brandneu nach
          // boot, oder defaultTier-hook hat noch nicht gefired). Default-Set
          // ist least-privileged — typisch Free-Tier-features. Memory
          // `feedback_security_default_on`: secure-by-default.
          const fallbackTier = opts.defaultTier;
          if (fallbackTier === undefined) return computedAlwaysOn;
          return mergeAlwaysOn(computedAlwaysOn, featuresForTier(tierMap, fallbackTier));
        };
      },
    };
    // biome-ignore lint/correctness/useHookAtTopLevel: r.useExtension is a framework registrar method, not a React hook.
    r.useExtension(TENANT_TIER_RESOLVER_EXT, TIER_ENGINE_FEATURE, plugin);
  });
}

/**
 * Legacy named export — equivalent to `createTierEngineFeature()` ohne opts.
 * Storage-only mode (no resolver, no auto-default). Existing apps die
 * `tierEngineFeature` referenzieren bekommen identical behavior.
 *
 * Migration zu `createTierEngineFeature({ defaultTier, tierMap })` gibt
 * volle Tier-Composition (Sprint-8a Pattern).
 */
export const tierEngineFeature: FeatureDefinition = createTierEngineFeature();
