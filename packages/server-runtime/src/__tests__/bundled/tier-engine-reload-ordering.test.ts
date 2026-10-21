// A single-tenant reload that started before a full resync must not overwrite the resync's
// fresher snapshot when it resolves last. The DB is a hand-driven fake so resolution order is explicit.
import { describe, expect, test } from "bun:test";
import type { TierMap } from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import { createTierEngineFeature } from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import {
  createRegistry,
  findTierResolverUsage,
  isTierResolverPlugin,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { CACHE_SYNC_TOPICS, type CacheSyncBus } from "@cosmicdrift/kumiko-framework/redis";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import type { DbConnection } from "@cosmicdrift/kumiko-types/db-connection";

const TIER_MAP: TierMap<{ readonly maxItems: number }> = {
  free: { features: [], caps: { maxItems: 1 } },
  pro: { features: ["feat-pro"], caps: { maxItems: 5 } },
};
const tenant = "00000000-0000-4000-8000-0000000000d1" as TenantId;

type PendingQuery = {
  readonly resolve: (rows: readonly Record<string, unknown>[]) => void;
};

function createManualDb(): { readonly db: DbConnection; readonly pending: PendingQuery[] } {
  const pending: PendingQuery[] = [];
  const db: DbConnection = {
    unsafe: () =>
      new Promise<readonly Record<string, unknown>[]>((resolve) => {
        pending.push({ resolve });
      }),
    begin: () => {
      throw new Error("not used");
    },
  };
  return { db, pending };
}

function createCapturingBus(): {
  readonly bus: CacheSyncBus;
  readonly deliver: (topic: string, message: unknown) => void;
  readonly fireResync: () => void;
} {
  const listeners = new Map<string, (message: unknown) => void>();
  const resyncListeners: Array<() => void> = [];
  return {
    bus: {
      publish: () => {},
      subscribe: (topic, listener) => {
        listeners.set(topic, listener);
        return () => listeners.delete(topic);
      },
      onResync: (listener) => {
        resyncListeners.push(listener);
        return () => {};
      },
    },
    deliver: (topic, message) => listeners.get(topic)?.(message),
    fireResync: () => {
      for (const listener of resyncListeners) listener();
    },
  };
}

describe("tier cache reload ordering", () => {
  test("a single reload started before a resync is discarded when it resolves last", async () => {
    const features = composeFeatures([createTierEngineFeature({ tierMap: TIER_MAP })], {
      includeBundled: true,
    });
    const usage = findTierResolverUsage(features);
    if (!usage || !isTierResolverPlugin(usage.options)) throw new Error("no tier-resolver plugin");
    const manual = createManualDb();
    const captured = createCapturingBus();

    const building = usage.options.build({
      db: manual.db,
      registry: createRegistry(features),
      cacheSync: captured.bus,
    });
    await waitFor(() => manual.pending.length > 0);
    manual.pending.shift()?.resolve([]);
    const resolver = await building;

    captured.deliver(CACHE_SYNC_TOPICS.tierAssignment, { tenantId: tenant });
    const singleReload = manual.pending.shift();
    captured.fireResync();
    const resync = manual.pending.shift();
    expect(singleReload).toBeDefined();
    expect(resync).toBeDefined();

    resync?.resolve([{ tenant_id: tenant, tier: "pro" }]);
    await waitFor(() => resolver(tenant).has("feat-pro"));
    expect(resolver(tenant).has("feat-pro")).toBe(true);

    singleReload?.resolve([{ tenant_id: tenant, tier: "free" }]);
    await Bun.sleep(0);
    expect(resolver(tenant).has("feat-pro")).toBe(true);
  });
});
