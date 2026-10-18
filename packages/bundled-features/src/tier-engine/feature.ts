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

// kumiko-lint-ignore app-feature-structure Phase-3 conversion tracked in #2312 (feature.ts > 300 lines)
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
  fetchOne,
  selectMany,
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
  type TrialGate,
} from "@cosmicdrift/kumiko-framework/engine";
import { getUnscopedAggregateStreamMaxVersion } from "@cosmicdrift/kumiko-framework/event-store";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import {
  CACHE_SYNC_TOPICS,
  type CacheSyncBus,
  isTierAssignmentSyncMessage,
  type TierAssignmentSyncMessage,
} from "@cosmicdrift/kumiko-framework/redis";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import * as z from "zod";
import { tenantTable } from "../tenant/index.ts";
import { tierAssignmentAggregateId } from "./aggregate-id.ts";
import type { TierMap } from "./compose-app.ts";
import {
  TIER_ADMIN_SCREEN_ID,
  TIER_ENGINE_FEATURE,
  TierAssignmentSources,
  TierEngineHandlers,
} from "./constants.ts";
import { tierAssignmentEntity } from "./entity.ts";
import { getActiveTierQuery } from "./handlers/active-tier.query.ts";
import { getTenantTierQuery } from "./handlers/get-tenant-tier.query.ts";
import { createSetTenantTierWrite } from "./handlers/set-tenant-tier.write.ts";
import { TIER_ENGINE_I18N } from "./i18n.ts";
import { isTrialActive, type TrialPolicy } from "./trial.ts";

// Drizzle-table for the tier-assignment-entity. Built once at module-load
// from the entity definition — same shape buildEntityTable would produce
// in the App's drizzle/schema.generated.ts.
const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);
const log = createFallbackLogger("tier-engine");

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

  /**
   * Optionale Trial-Phase: jeder Tenant bekommt für `durationHours` ab seinem
   * Anlage-Datum zusätzlich die Features von `trial.tier` freigeschaltet,
   * danach fällt er automatisch auf sein gespeichertes Tier zurück. Erfordert
   * `tierMap` (der Trial-Tier muss ein Key sein). Zeit-abgeleitet aus
   * inserted_at — kein Stored-Flag, kein Scheduler.
   */
  readonly trial?: TrialPolicy;
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
  return defineFeature(
    TIER_ENGINE_FEATURE,
    (r) => {
      r.describe(
        'Stores a `tier-assignment` entity per tenant (which pricing tier is active) and, when configured with a `TierMap`, registers itself as the `tenantTierResolver` extension so the dispatcher automatically gates `r.toggleable()` features per tenant based on their assigned tier. Call `createTierEngineFeature({ defaultTier, tierMap })` to get full tier composition \u2014 including an `inTransaction` entity hook that atomically writes the default tier when a new tenant is created \u2014 or use `createTierEngineFeature()` without options for storage-only mode when you manage tier assignment yourself via `composeApp`. A SystemAdmin-only `set-tenant-tier` write plus `get-tenant-tier`/`tier-options` reads let an operator assign a tier to ANY tenant manually \u2014 without a billing purchase \u2014 stamping `source: "manual"` so a future Stripe\u2192tier sync won\'t overwrite the grant. Apps surface this via the `tier-admin` screen, which is always registered — in storage-only mode (no `tierMap`) it shows an honest "no tiers configured" message instead of a tier dropdown.',
      );
      r.uiHints({
        displayLabel: "Tier Engine \u00b7 Plan Composition",
        category: "billing",
        recommended: false,
      });
      r.requires({ features: ["config"] });
      r.requires({ features: ["tenant"] });

      r.entity({ name: "tier-assignment", ...tierAssignmentEntity });

      // Standard-CRUD via Helper.
      r.writeHandler(
        defineEntityCreateHandler("tier-assignment", tierAssignmentEntity, {
          ...writeAccess,
          // Bypasses the feature-gate refresh that set-tenant-tier performs.
          agent: { expose: false },
        }),
      );
      r.writeHandler(
        defineEntityUpdateHandler("tier-assignment", tierAssignmentEntity, {
          ...writeAccess,
          agent: { expose: false },
        }),
      );

      // Reads.
      r.queryHandler(
        defineEntityListHandler("tier-assignment", tierAssignmentEntity, {
          ...adminAccess,
          description:
            "Lists the tier-assignment rows visible to the caller with tier name and assignment source; use it to see which plan is stored for a tenant.",
        }),
      );
      r.queryHandler(getActiveTierQuery);

      // \u2500\u2500 Manueller Tier-Grant (SystemAdmin, ohne Billing) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      // Cross-tenant set + read f\u00fcr den tier-admin-Screen. tier-options liefert
      // dem Client die App-Tier-Namen aus der tierMap-Closure (sonst hartkodiert).
      //
      // onAssigned runs after commit (the direct executor write fires no postSave
      // hook). Late-bound: without tierMap it stays a no-op, the tierMap block
      // below installs the real cache update + publish.
      const onTierAssigned: { fn: (tenantId: TenantId, tier: string) => void } = { fn: () => {} };
      r.writeHandler(
        createSetTenantTierWrite({
          onAssigned: (tenantId, tier) => onTierAssigned.fn(tenantId, tier),
          validTiers: opts.tierMap ? new Set(Object.keys(opts.tierMap)) : undefined,
        }),
      );
      r.queryHandler(getTenantTierQuery);
      r.queryHandler(
        defineQueryHandler({
          name: "tier-options",
          description:
            "Returns the tier names the application defines in its tier map; use it to find out which values `set-tenant-tier` accepts.",
          schema: z.object({}),
          access: { roles: ["SystemAdmin"] },
          handler: async () => ({ tiers: opts.tierMap ? Object.keys(opts.tierMap) : [] }),
        }),
      );

      // Declarative form for the manual grant. SystemAdmin-only, hard-wired
      // (platform-admin authority, not app-configurable). Apps place it only
      // via r.nav("tier-engine:screen:tier-admin"); tier options are built
      // statically from the tierMap closure. Always registered — even in
      // storage-only mode (no tierMap) — so the screen shows an honest
      // "no tiers configured" message instead of vanishing (samples like
      // use-all-bundled deliberately mount storage-only to screenshot that
      // empty state).
      r.translations({ keys: TIER_ENGINE_I18N });
      r.screen({
        id: TIER_ADMIN_SCREEN_ID,
        type: "actionForm",
        handler: TierEngineHandlers.setTenantTier,
        fields: {
          tenantId: {
            type: "reference",
            entity: "tenant:tenant",
            labelField: "name",
            required: true,
          },
          tier: {
            type: "select",
            options: opts.tierMap ? Object.keys(opts.tierMap) : [],
            required: true,
          },
        },
        layout: {
          sections: [
            {
              fields: ["tenantId", "tier"],
              description: opts.tierMap ? "tier-admin.explainer" : "tier-admin.error.noTiers",
            },
          ],
        },
        submitLabel: "tier-admin.submit",
        successMessage: "tier-admin.success",
        cancelTarget: false,
        description: "tier-admin.screen.subtitle",
        access: { roles: ["SystemAdmin"] },
        // Apps place it via r.nav() (see above) — no nav area to resolve in
        // isolation.
        dormant: true,
      });

      // ───────────────────────────────────────────────────────────────────
      // Resolver-extension (only when tierMap is configured)
      // ───────────────────────────────────────────────────────────────────
      // skip: ohne tierMap ist die feature nur Storage (legacy back-compat
      // zu `tierEngineFeature`). Resolver-extension + invalidation-hooks
      // brauchen die tierMap zum Mapping tier-name → feature-set.
      if (!opts.tierMap) return;

      const tierMap = opts.tierMap;

      // Closure state: per-tenant cache of effective sets. Hooks keep the
      // cache current during the process lifetime; build() in the extension
      // pickup pre-loads existing assignments at boot.
      const cache = new Map<TenantId, ReadonlySet<string>>();
      // The alwaysOn set is computed in build(deps) from registry.features (all
      // non-toggleable features). Hooks need it for mergeAlwaysOn calls — late
      // bound via a mutable holder, filled before any request (build runs
      // pre-listen via the runDevApp/runProdApp pickup).
      const alwaysOnHolder: { set: ReadonlySet<string> } = { set: new Set() };
      // Bus handed to build(); hooks fire outside build and publish through it.
      const busHolder: { bus: CacheSyncBus | undefined } = { bus: undefined };
      // Out-of-order guard: every cache mutation or reload start takes a ticket; a
      // reload result is applied only while its ticket is still the tenant's latest.
      let ticketCounter = 0;
      const latestTicket = new Map<TenantId, number>();
      const takeTicket = (tenantId: TenantId): number => {
        ticketCounter += 1;
        latestTicket.set(tenantId, ticketCounter);
        return ticketCounter;
      };
      const publishAssignmentChange = (tenantId: TenantId): void => {
        const message: TierAssignmentSyncMessage = { tenantId };
        // The writer already updated its own cache; only other pods need to re-read.
        busHolder.bus?.publish(CACHE_SYNC_TOPICS.tierAssignment, message, { remoteOnly: true });
      };

      // Trial: derived from time (tenant.inserted_at ≈ signup) and checked live
      // at the feature gate — NOT in the resolver cache. The resolver is
      // boot-cached and synchronous, so it sees neither fresh signups nor the
      // passage of time; the trial status changes over time and applies from
      // second 1 after signup. That is why it lives as an async trialGate
      // (below, attached at the end of build) which the dispatcher consults
      // only on the disabled path. trialFeatures = fixed feature set of the
      // trial tier.
      if (opts.trial && !tierMap[opts.trial.tier]) {
        throw new Error(
          `tier-engine: trial.tier "${opts.trial.tier}" is not a key in tierMap — trial would unlock no features`,
        );
      }
      const trialFeatures: ReadonlySet<string> = opts.trial
        ? featuresForTier(tierMap, opts.trial.tier)
        : new Set();
      const nowMs = (): number => getTemporal().Now.instant().epochMilliseconds;

      // Immediate local visibility on the writing pod; other pods learn via the
      // bus and re-read the row.
      const applyAssignment = (tenantId: TenantId, tier: string): void => {
        takeTicket(tenantId);
        cache.set(tenantId, mergeAlwaysOn(alwaysOnHolder.set, featuresForTier(tierMap, tier)));
        publishAssignmentChange(tenantId);
      };
      onTierAssigned.fn = applyAssignment;

      // Invalidation: tier-assignment CRUD events (e.g. the billing webhook) update the cache.
      r.hook({
        type: "postSave",
        target: { allOf: "tier-assignment" },
        handler: async (result) => {
          // result.data has tenantId + tier (after entity-update merge)
          const data = result.data as { tenantId?: unknown; tier?: unknown }; // @cast-boundary engine-payload
          // skip: defensive guard on the payload shape. Correct entity events
          // always carry both fields as strings; a malformed payload (a custom
          // handler bug) skips the cache update instead of throwing, because a
          // hook error must not block the lifecycle pipeline (afterCommit,
          // best-effort side effect).
          if (typeof data.tenantId !== "string" || typeof data.tier !== "string") return;
          applyAssignment(data.tenantId as TenantId, data.tier);
        },
      });
      r.hook({
        type: "postDelete",
        target: { allOf: "tier-assignment" },
        handler: async (payload) => {
          const data = payload.data as { tenantId?: unknown }; // @cast-boundary engine-payload
          // skip: same type-guard semantics as the postSave hook above.
          if (typeof data.tenantId !== "string") return;
          const tenantId = data.tenantId as TenantId;
          takeTicket(tenantId);
          cache.delete(tenantId);
          publishAssignmentChange(tenantId);
        },
      });

      // Auto-default-tier-on-tenant-signup: the hook fires inTransaction (atomic
      // with the tenant-create rollback) and writes the tier-assignment via the
      // direct executor (not ctx.write — the hook has an AppContext). Same
      // pattern as seedTenant in tenant/seeding.ts.
      //
      // **Idempotency:** deterministic aggregate id derived from tenantId. A
      // re-replay (after a projection rebuild or hook retry) finds
      // stream-version > 0 and skips instead of throwing version_conflict. The
      // caller sees a successful tenant-create plus the existing
      // tier-assignment.
      //
      // **Cross-tenant write:** the executor needs a systemUser WITH tenantId =
      // the new tenant (memory `feedback_event_store_tenant_consistency`).
      if (opts.defaultTier !== undefined) {
        const defaultTier = opts.defaultTier;
        const autoDefaultTierHookReason =
          "seeds the default tier-assignment stream of the tenant just created";
        r.hook({
          type: "postSave",
          target: { allOf: "tenant" },
          handler: async (result, ctx) => {
            // result shape: kumiko-framework's SaveContext with isNew + data
            const saveResult = result as { isNew?: unknown; data?: unknown }; // @cast-boundary engine-payload
            // skip: only on tenant-create (initial) — tenant updates fire
            // postSave too, but a re-keying or name update must not create a
            // new tier-assignment.
            if (saveResult.isNew !== true) return;
            const data = saveResult.data as { id?: unknown }; // @cast-boundary engine-payload
            // skip: defensive type guard. The tenant entity always has an id, but
            // CrudExecutor's payload shape is unknown at runtime.
            if (typeof data.id !== "string") return;
            const newTenantId = data.id as TenantId; // @cast-boundary engine-payload
            const aggregateId = tierAssignmentAggregateId(newTenantId);

            // tenant is an r.systemScope() feature, so this cross-feature hook gets a
            // fail-closed ctx.db — reach for ctx.systemDb instead (see entity-handlers.ts).
            // Event-store paths need the raw DbConnection — TenantDb only exposes
            // select/insert/update/delete, not execute (db.execute(sql`SELECT pg_notify(...)`) would TypeError).
            const rawDb = ctx.systemDb
              ? ctx.systemDb.unsafeRaw(autoDefaultTierHookReason)
              : ctx.db && "unsafeRaw" in ctx.db
                ? ctx.db.unsafeRaw()
                : undefined;
            // skip: defensive — inTransaction phase always sets db, but AppContext's
            // type makes it optional. Throwing would be overreach (lifecycle
            // blocking), silent-skip is defensive-soft.
            if (!rawDb) return;

            // Idempotency: stream-existence check before create. Same pattern as
            // seedTenant.ts. On a re-replay (rebuild) do not bump the version.
            const streamVersion = await getUnscopedAggregateStreamMaxVersion(rawDb, aggregateId);
            // skip: idempotent — tier-assignment stream already seeded (rebuild/replay).
            if (streamVersion > 0) return;

            // SystemUser for the NEW tenant — the hook is triggered by the signup
            // user (another tenant, or SystemAdmin), but the tier-assignment has
            // to land in the stream of the newly created tenant (= aggregate id
            // deterministic on newTenantId). Memory
            // `feedback_event_store_tenant_consistency`: by.tenantId must equal
            // the target tenant.
            const systemUser: SessionUser = {
              id: "00000000-0000-4000-8000-000000000001",
              tenantId: newTenantId,
              roles: ["SystemAdmin"],
            };
            const tdb = createTenantDb({ db: rawDb, tenantId: newTenantId, mode: "system" });

            await tierAssignmentExecutor.create(
              { id: aggregateId, tier: defaultTier, source: TierAssignmentSources.default },
              systemUser,
              tdb,
            );
          },
          phase: HookPhases.inTransaction,
          escapeHatch: { reason: autoDefaultTierHookReason },
        });
      }

      // Extension-point declaration + self-registration. Same pattern as
      // mail-foundation/file-foundation: the feature declares the extension
      // point AND registers itself as the default plugin. Other features could
      // register there later (e.g. a future toggle-only resolver), but only one
      // plugin wins — see the "single-plugin" comment on findTierResolverUsage.
      r.extendsRegistrar(TENANT_TIER_RESOLVER_EXT, { onRegister: () => {} });

      // Plugin-registration: framework's runDevApp/runProdApp picks this up
      // post-stack-setup, calls build(deps), wires effectiveFeatures.
      const plugin: TierResolverPlugin = {
        build: async (deps) => {
          // Always-on set: all non-toggleable features in the registry. Canonical
          // Kumiko pattern (matches the feature-toggles resolver): only features
          // that explicitly register `r.toggleable()` are tier-cuttable.
          // Framework base features (auth-email-password, config, user, tenant,
          // sessions, etc.) are non-toggleable → ALWAYS active for every tenant
          // regardless of tier. Otherwise the dispatcher would answer 403 on the
          // login handler because "feature auth-email-password disabled".
          const computedAlwaysOn = new Set<string>();
          for (const feature of deps.registry.features.values()) {
            if (feature.toggleableDefault === undefined) computedAlwaysOn.add(feature.name);
          }
          alwaysOnHolder.set = computedAlwaysOn;

          // Pre-load all existing assignments into the cache. SaaS apps typically
          // have <100k tenants, so a single-pass scan is acceptable. The scaling
          // path (lazy load + LRU) is Sprint-8b, once a real need arises.
          type AssignmentRow = { tenantId: string; tier: string };
          const rows = await selectMany<AssignmentRow>(deps.db, tierAssignmentTable);
          for (const row of rows) {
            cache.set(
              row.tenantId as TenantId,
              mergeAlwaysOn(computedAlwaysOn, featuresForTier(tierMap, row.tier)),
            );
          }

          // Read first, then set — never clear-then-refill: a cache miss falls back
          // to the default tier, which would lock paying tenants out meanwhile.
          const reloadTenant = async (tenantId: TenantId): Promise<void> => {
            const ticket = takeTicket(tenantId);
            const row = await fetchOne<AssignmentRow>(deps.db, tierAssignmentTable, { tenantId });
            // skip: a newer write or reload for this tenant started meanwhile and owns the entry
            if (latestTicket.get(tenantId) !== ticket) return;
            if (row) {
              cache.set(
                tenantId,
                mergeAlwaysOn(computedAlwaysOn, featuresForTier(tierMap, row.tier)),
              );
            } else {
              cache.delete(tenantId);
            }
          };
          const reloadAllTenants = async (): Promise<void> => {
            ticketCounter += 1;
            const startedAtTicket = ticketCounter;
            const current = await selectMany<AssignmentRow>(deps.db, tierAssignmentTable);
            const loaded = new Map<TenantId, ReadonlySet<string>>();
            for (const row of current) {
              loaded.set(
                row.tenantId as TenantId,
                mergeAlwaysOn(computedAlwaysOn, featuresForTier(tierMap, row.tier)),
              );
            }
            const isNewerThanSnapshot = (tenantId: TenantId): boolean =>
              (latestTicket.get(tenantId) ?? 0) > startedAtTicket;
            for (const tenantId of [...cache.keys()]) {
              if (!loaded.has(tenantId) && !isNewerThanSnapshot(tenantId)) {
                cache.delete(tenantId);
                latestTicket.set(tenantId, startedAtTicket);
              }
            }
            for (const [tenantId, features] of loaded) {
              if (!isNewerThanSnapshot(tenantId)) {
                cache.set(tenantId, features);
                // Makes a single reload that started before this snapshot discard its older result.
                latestTicket.set(tenantId, startedAtTicket);
              }
            }
          };

          busHolder.bus = deps.cacheSync;
          deps.cacheSync?.subscribe(CACHE_SYNC_TOPICS.tierAssignment, (message) => {
            // skip: malformed message from another process
            if (!isTierAssignmentSyncMessage(message)) return;
            reloadTenant(message.tenantId).catch((err: unknown) => {
              log.error("tier reload failed, keeping cached set", {
                tenantId: message.tenantId,
                err,
              });
            });
          });
          deps.cacheSync?.onResync(() => {
            reloadAllTenants().catch((err: unknown) => {
              log.error("tier resync failed, keeping cached sets", { err });
            });
          });

          // Synchronous resolver-callback for dispatcher hot-path.
          const resolver = (tenantId: TenantId): ReadonlySet<string> => {
            // Operator-tooling + async-event-dispatch convention: SYSTEM_TENANT_ID
            // gets the union of all tier features (see DispatcherOptions doc).
            if (tenantId === SYSTEM_TENANT_ID) {
              return mergeAlwaysOn(computedAlwaysOn, unionAllTierFeatures(tierMap));
            }
            // Cache miss: the tenant is not in the cache yet (e.g. brand new after
            // boot, or the defaultTier hook has not fired yet). The default set
            // is least-privileged — typically free-tier features. Memory
            // `feedback_security_default_on`: secure by default. The trial is NOT
            // added here (sync/boot-cached, cannot see the passage of time) — the
            // trialGate below does that on the disabled-gate path.
            const fallbackTier = opts.defaultTier;
            return (
              cache.get(tenantId) ??
              (fallbackTier === undefined
                ? computedAlwaysOn
                : mergeAlwaysOn(computedAlwaysOn, featuresForTier(tierMap, fallbackTier)))
            );
          };

          const trial = opts.trial;
          if (trial === undefined) return resolver;

          // Live trial gate: reads tenant.inserted_at (≈ signup; exists for EVERY
          // tenant incl. auth-signup via seedTenant — unlike the tier-assignment
          // row, which the seed path does not create) and checks the window
          // against the current time. Consulted only on the disabled-gate path.
          // inserted_at is immutable → read once per tenant.
          // Promise-memo (not a plain value cache): N concurrent requests for the
          // same fresh tenant must await the SAME in-flight fetchOne, not each
          // fire their own — a plain `Map<TenantId, number>` set AFTER the await
          // lets every concurrent caller miss the cache and issue a redundant
          // read (benign but wasteful on a signup burst).
          const startedMemo = new Map<TenantId, Promise<number | undefined>>();
          const trialGate: TrialGate = async (tenantId, featureName) => {
            if (!trialFeatures.has(featureName)) return false;
            let startedMsPromise = startedMemo.get(tenantId);
            if (startedMsPromise === undefined) {
              startedMsPromise = fetchOne<{ insertedAt?: Temporal.Instant }>(deps.db, tenantTable, {
                id: tenantId,
              }).then((row) => row?.insertedAt?.epochMilliseconds);
              // Evict on rejection too — a transient DB error must not poison
              // every future call for this tenant with the same cached rejection.
              startedMsPromise.catch(() => startedMemo.delete(tenantId));
              startedMemo.set(tenantId, startedMsPromise);
            }
            const startedMs = await startedMsPromise;
            // Tenant row not projected yet (replay race) → do not memoize the
            // miss, re-read on the next request.
            if (startedMs === undefined) {
              startedMemo.delete(tenantId);
              return false;
            }
            return isTrialActive(startedMs, nowMs(), trial.durationHours);
          };
          return Object.assign(resolver, { trialGate });
        },
      };
      // biome-ignore lint/correctness/useHookAtTopLevel: r.useExtension is a framework registrar method, not a React hook.
      r.useExtension(TENANT_TIER_RESOLVER_EXT, TIER_ENGINE_FEATURE, plugin);
    },
    Object.keys(opts).length === 0 ? { dedupeOptions: {} } : undefined,
  );
}
