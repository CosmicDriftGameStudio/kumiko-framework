// In-memory cache with push invalidation:
//   Closure state per feature instance stores each tenant's tier name. The
//   effective feature set per tier is computed once in build(). `r.entityHook`
//   on tier-assignment postSave/postDelete keeps the cache current. The
//   extension-pickup path pre-loads the cache through build(deps) at boot via
//   runDevApp/runProdApp.
//
// SYSTEM_TENANT_ID convention:
//   A resolver callback invoked with SYSTEM_TENANT_ID returns the union of all
//   tier features for asynchronous event dispatch and operator tooling.
//   See the DispatcherOptions.effectiveFeatures documentation.

import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  parseTenantId,
  SYSTEM_TENANT_ID,
  type TenantId,
  type TierResolverPlugin,
  type TrialGate,
} from "@cosmicdrift/kumiko-framework/engine";
import { systemScopedRunner } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import {
  CACHE_SYNC_TOPICS,
  type CacheSyncBus,
  isTierAssignmentSyncMessage,
  type TierAssignmentSyncMessage,
} from "@cosmicdrift/kumiko-framework/redis";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { tenantTable } from "../tenant/index.ts";
import type { TierMap } from "./compose-app.ts";
import { tierAssignmentTable } from "./table.ts";
import { isTrialActive, type TrialPolicy } from "./trial.ts";

const log = createFallbackLogger("tier-engine");

/**
 * Computes the union of features across all tiers for a
 * SYSTEM_TENANT_ID resolver call used by operator tooling and asynchronous
 * event dispatch. The operator UI sees every feature regardless of tier, and
 * asynchronous events run without tier restrictions.
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
 * Computes the feature set for a tier name. An unknown tier returns an empty
 * Set defensively because tier names are not validated at boot; tier-engine is
 * generic over tier values.
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
 * Merges always-on features (non-toggleable framework base) with tier-specific
 * features (toggleable per tier). The dispatcher gate blocks only features
 * that explicitly register `r.toggleable()`; all others are always active.
 * The tier resolver must provide the same shape.
 */
function mergeAlwaysOn(
  alwaysOn: ReadonlySet<string>,
  tierFeatures: ReadonlySet<string>,
): ReadonlySet<string> {
  const merged = new Set<string>(alwaysOn);
  for (const f of tierFeatures) merged.add(f);
  return merged;
}

type AssignmentRow = { tenantId: string; tier: string };

export function createTierFeatureCache<TCaps extends Readonly<Record<string, unknown>>>(opts: {
  readonly tierMap: TierMap<TCaps>;
  readonly defaultTier: string | undefined;
  readonly trial: TrialPolicy | undefined;
}): {
  readonly applyAssignment: (tenantId: TenantId, tier: string) => void;
  readonly removeAssignment: (tenantId: TenantId) => void;
  readonly plugin: TierResolverPlugin;
} {
  const { tierMap, defaultTier, trial } = opts;

  // Per-tenant tier name. Hooks keep it current during the process lifetime;
  // build() pre-loads existing assignments at boot.
  const cache = new Map<TenantId, string>();
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
  if (trial && !tierMap[trial.tier]) {
    throw new Error(
      `tier-engine: trial.tier "${trial.tier}" is not a key in tierMap — trial would unlock no features`,
    );
  }
  const trialFeatures: ReadonlySet<string> = trial
    ? featuresForTier(tierMap, trial.tier)
    : new Set();
  const nowMs = (): number => getTemporal().Now.instant().epochMilliseconds;

  // Immediate local visibility on the writing pod; other pods learn via the
  // bus and re-read the row.
  const applyAssignment = (tenantId: TenantId, tier: string): void => {
    takeTicket(tenantId);
    cache.set(tenantId, tier);
    publishAssignmentChange(tenantId);
  };
  const removeAssignment = (tenantId: TenantId): void => {
    takeTicket(tenantId);
    cache.delete(tenantId);
    publishAssignmentChange(tenantId);
  };

  // Plugin-registration: framework's runDevApp/runProdApp picks this up
  // post-stack-setup, calls build(deps), wires effectiveFeatures.
  const plugin: TierResolverPlugin = {
    build: async (deps) => {
      // Preloads and bus-driven reloads run outside any request scope and read every
      // tenant's rows; the enforcing pool would return zero rows and lock paying tenants out.
      const systemDb = systemScopedRunner(
        deps.db,
        "tier cache preloads and reloads assignments and tenant creation times of all tenants",
      );
      // Always-on set: all non-toggleable features in the registry. Canonical
      // Kumiko pattern (matches the feature-toggles resolver): only features
      // that explicitly register `r.toggleable()` are tier-cuttable.
      // Framework base features (auth-email-password, config, user, tenant,
      // sessions, etc.) are non-toggleable → ALWAYS active for every tenant
      // regardless of tier. Otherwise the dispatcher would answer 403 on the
      // login handler because "feature auth-email-password disabled".
      const alwaysOn = new Set<string>();
      for (const feature of deps.registry.features.values()) {
        if (feature.toggleableDefault === undefined) alwaysOn.add(feature.name);
      }
      const effectiveByTier = new Map<string, ReadonlySet<string>>(
        Object.keys(tierMap).map((tier) => [
          tier,
          mergeAlwaysOn(alwaysOn, featuresForTier(tierMap, tier)),
        ]),
      );
      // Operator-tooling + async-event-dispatch convention: SYSTEM_TENANT_ID
      // gets the union of all tier features (see DispatcherOptions doc).
      const systemTenantFeatures = mergeAlwaysOn(alwaysOn, unionAllTierFeatures(tierMap));
      // Cache miss: the tenant is not in the cache yet (e.g. brand new after
      // boot, or the defaultTier hook has not fired yet). The default set
      // is least-privileged, secure by default: typically free-tier features.
      // The trial is NOT added here (sync/boot-cached, cannot see the passage
      // of time) — the trialGate below does that on the disabled-gate path.
      const fallbackFeatures =
        defaultTier === undefined ? alwaysOn : (effectiveByTier.get(defaultTier) ?? alwaysOn);

      // One feature instance can serve several stacks in a process; rebuild state from this DB only.
      // The cache is shared per instance, so this is safe only for sequential stack lifecycles
      // (no request of an earlier stack still running): clear-then-refill would lock its tenants out.
      cache.clear();
      latestTicket.clear();

      // Pre-load all existing assignments into the cache. SaaS apps typically
      // have <100k tenants, so a single-pass scan is acceptable. The scaling
      // path (lazy load + LRU) is planned once a real need arises.
      ticketCounter += 1;
      const preloadTicket = ticketCounter;
      const rows = await selectMany<AssignmentRow>(systemDb, tierAssignmentTable);
      for (const row of rows) {
        const tenantId = parseTenantId(row.tenantId);
        if (tenantId === null) continue;
        // skip: a tier write committed while the snapshot was read; its cache entry is newer
        if ((latestTicket.get(tenantId) ?? 0) > preloadTicket) continue;
        cache.set(tenantId, row.tier);
      }

      // Read first, then set — never clear-then-refill: a cache miss falls back
      // to the default tier, which would lock paying tenants out meanwhile.
      const reloadTenant = async (tenantId: TenantId): Promise<void> => {
        const ticket = takeTicket(tenantId);
        const row = await fetchOne<AssignmentRow>(systemDb, tierAssignmentTable, { tenantId });
        // skip: a newer write or reload for this tenant started meanwhile and owns the entry
        if (latestTicket.get(tenantId) !== ticket) return;
        if (row) {
          cache.set(tenantId, row.tier);
        } else {
          cache.delete(tenantId);
        }
      };
      const reloadAllTenants = async (): Promise<void> => {
        ticketCounter += 1;
        const startedAtTicket = ticketCounter;
        const current = await selectMany<AssignmentRow>(systemDb, tierAssignmentTable);
        const loaded = new Map<TenantId, string>();
        for (const row of current) {
          const tenantId = parseTenantId(row.tenantId);
          if (tenantId === null) continue;
          loaded.set(tenantId, row.tier);
        }
        const isNewerThanSnapshot = (tenantId: TenantId): boolean =>
          (latestTicket.get(tenantId) ?? 0) > startedAtTicket;
        for (const tenantId of [...cache.keys()]) {
          if (!loaded.has(tenantId) && !isNewerThanSnapshot(tenantId)) {
            cache.delete(tenantId);
            latestTicket.set(tenantId, startedAtTicket);
          }
        }
        for (const [tenantId, tier] of loaded) {
          if (!isNewerThanSnapshot(tenantId)) {
            cache.set(tenantId, tier);
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
        if (tenantId === SYSTEM_TENANT_ID) return systemTenantFeatures;
        const tier = cache.get(tenantId);
        if (tier === undefined) return fallbackFeatures;
        // Unknown tier name: only the always-on features.
        return effectiveByTier.get(tier) ?? alwaysOn;
      };

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
          startedMsPromise = fetchOne<{ insertedAt?: Temporal.Instant }>(systemDb, tenantTable, {
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

  return { applyAssignment, removeAssignment, plugin };
}
