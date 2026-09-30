// Integration-test for the sync-subscription write-handler (the
// sync-subscriptions job's backfill target) — real HTTP dispatch through
// setupTestStack, never createTestDispatcher. Provider-specific
// retrieveSubscription mapping (Stripe) is covered in subscription-stripe's
// own plugin-methods.test.ts; this only proves the foundation's own
// no-live-subscription/provider_cannot_retrieve/not_found/unchanged/synced
// branching and that a synced drift lands as a real subscription.updated
// event on the aggregate stream.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests, waitFor } from "@cosmicdrift/kumiko-framework/testing";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.js";
import { createConfigFeature } from "../../config/index.js";
import { TenantHandlers } from "../../tenant/constants.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.js";
import { subscriptionAggregateId } from "../aggregate-id.js";
import {
  SubscriptionFoundationHandlers,
  SubscriptionFoundationQueries,
  SubscriptionStatuses,
} from "../constants.js";
import { createBillingFoundationFeature } from "../feature.js";
import type { ProviderSubscriptionSnapshot, SubscriptionProviderPlugin } from "../types.js";

let retrieveSnapshot: ProviderSubscriptionSnapshot | null = null;
// Keyed by providerSubscriptionId — the job-path test fans the same
// dispatch out to multiple tenants concurrently, each needing its own
// snapshot; the single `retrieveSnapshot` above only serves the
// sequential single-tenant tests.
const retrieveSnapshotsById = new Map<string, ProviderSubscriptionSnapshot>();
const retrieveCalls: string[] = [];

const mockSyncProviderFeature = defineFeature("test-mock-sync-provider", (r) => {
  r.requires("billing-foundation");
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async () => null,
    retrieveSubscription: async (_ctx, providerSubscriptionId) => {
      retrieveCalls.push(providerSubscriptionId);
      return retrieveSnapshotsById.get(providerSubscriptionId) ?? retrieveSnapshot;
    },
  };
  r.useExtension("subscriptionProvider", "mock-sync-provider", plugin);
});

// No `retrieveSubscription` — exercises the "provider_cannot_retrieve" branch.
const mockNoRetrieveProviderFeature = defineFeature("test-mock-no-retrieve-provider", (r) => {
  r.requires("billing-foundation");
  const plugin: SubscriptionProviderPlugin = { verifyAndParseWebhook: async () => null };
  r.useExtension("subscriptionProvider", "mock-no-retrieve-provider", plugin);
});

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createBillingFoundationFeature({ baseUrl: "https://example.com" }),
      mockSyncProviderFeature,
      mockNoRetrieveProviderFeature,
    ],
    // Only the job-path describe-block below needs a real worker — every
    // other test dispatches syncSubscription directly. `getActiveTenantIds`
    // is omitted: the tenant feature is mounted, so the framework resolves
    // active tenants via tenant:query:active-tenant-ids itself, same as prod.
    jobs: { consumerLane: "worker" },
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  retrieveSnapshot = null;
  retrieveSnapshotsById.clear();
  retrieveCalls.length = 0;
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

async function createSubscription(
  tenantId: string,
  overrides: Partial<{
    providerEventId: string;
    providerName: string;
    status: string;
    tier: string;
    providerSubscriptionId: string;
    providerCustomerId: string;
    currentPeriodEndIso: string;
    cancelAtIso: string | null;
  }> = {},
) {
  const admin = createTestUser({ id: 0, tenantId, roles: ["TenantAdmin", "SystemAdmin"] });
  return stack.http.writeOk(
    SubscriptionFoundationHandlers.processEvent,
    {
      providerEventId: overrides.providerEventId ?? `evt_${tenantId}_create`,
      providerName: overrides.providerName ?? "mock-sync-provider",
      type: "subscription.created",
      providerCustomerId: overrides.providerCustomerId ?? `cus_${tenantId}`,
      providerSubscriptionId: overrides.providerSubscriptionId ?? `sub_${tenantId}`,
      status: overrides.status ?? SubscriptionStatuses.active,
      tier: overrides.tier ?? "pro",
      currentPeriodEndIso: overrides.currentPeriodEndIso ?? "2026-06-01T00:00:00Z",
      ...(overrides.cancelAtIso !== undefined && { cancelAtIso: overrides.cancelAtIso }),
      rawPayload: '{"raw":"payload"}',
    },
    admin,
  );
}

describe("sync-subscription", () => {
  test("no subscription for the tenant → no_live_subscription, provider never called", async () => {
    const admin = adminFor(6001);
    const result = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.syncSubscription,
      {},
      admin,
    )) as { synced: boolean; reason?: string };
    expect(result).toEqual({ synced: false, reason: "no_live_subscription" });
    expect(retrieveCalls).toHaveLength(0);
  });

  test("provider drift (new cancel_at) → synced, projection updated, a sync:-prefixed updated event appended; a same-state re-sync then reports unchanged with no new event", async () => {
    const admin = adminFor(6002);
    await createSubscription(admin.tenantId, {
      providerSubscriptionId: "sub_6002",
      providerCustomerId: "cus_6002",
      tier: "pro",
    });

    retrieveSnapshot = {
      providerCustomerId: "cus_6002",
      providerSubscriptionId: "sub_6002",
      status: SubscriptionStatuses.active,
      tier: "pro",
      currentPeriodEnd: "2026-06-01T00:00:00Z",
      cancelAt: "2026-05-01T00:00:00Z",
      rawPayload: '{"raw":"provider-drift"}',
    };

    const result = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.syncSubscription,
      {},
      admin,
    )) as { synced: boolean };
    expect(result).toEqual({ synced: true });
    expect(retrieveCalls).toEqual(["sub_6002"]);

    const subs = (await stack.http.queryOk(
      "billing-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(String(subs.rows[0]?.["cancelAt"])).toBe(
      Temporal.Instant.from("2026-05-01T00:00:00Z").toString(),
    );

    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(admin.tenantId),
      admin.tenantId,
    );
    expect(esEvents).toHaveLength(2); // create + sync-update
    expect(esEvents[1]?.type).toBe("billing-foundation:event:subscription-updated");
    expect(esEvents[1]?.metadata.headers?.["providerEventId"]).toMatch(/^sync:/);

    // Round-trip: dispatching again against the SAME provider state (now
    // read back from the DB, not the seed) must compare as unchanged and
    // append nothing — proves the instant-comparison, not just the initial
    // string-equality-by-luck.
    const secondResult = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.syncSubscription,
      {},
      admin,
    )) as { synced: boolean; reason?: string };
    expect(secondResult).toEqual({ synced: false, reason: "unchanged" });

    const esEventsAfterSecondSync = await loadAggregate(
      db,
      subscriptionAggregateId(admin.tenantId),
      admin.tenantId,
    );
    expect(esEventsAfterSecondSync).toHaveLength(2);
  });

  test("cancel → sync → reactivate → sync → cancel-again → sync appends a third update, not a duplicate-hash skip", async () => {
    const admin = adminFor(6007);
    await createSubscription(admin.tenantId, {
      providerSubscriptionId: "sub_6007",
      providerCustomerId: "cus_6007",
      tier: "pro",
    });

    const cancelSnapshot: ProviderSubscriptionSnapshot = {
      providerCustomerId: "cus_6007",
      providerSubscriptionId: "sub_6007",
      status: SubscriptionStatuses.active,
      tier: "pro",
      currentPeriodEnd: "2026-06-01T00:00:00Z",
      cancelAt: "2026-05-01T00:00:00Z",
      rawPayload: '{"raw":"cancel"}',
    };
    const reactivatedSnapshot: ProviderSubscriptionSnapshot = { ...cancelSnapshot, cancelAt: null };

    retrieveSnapshot = cancelSnapshot;
    expect(
      (await stack.http.writeOk(SubscriptionFoundationHandlers.syncSubscription, {}, admin)) as {
        synced: boolean;
      },
    ).toEqual({ synced: true });

    retrieveSnapshot = reactivatedSnapshot;
    expect(
      (await stack.http.writeOk(SubscriptionFoundationHandlers.syncSubscription, {}, admin)) as {
        synced: boolean;
      },
    ).toEqual({ synced: true });

    retrieveSnapshot = cancelSnapshot; // same content as the FIRST sync's snapshot
    const thirdResult = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.syncSubscription,
      {},
      admin,
    )) as { synced: boolean };
    expect(thirdResult).toEqual({ synced: true });

    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(admin.tenantId),
      admin.tenantId,
    );
    expect(esEvents).toHaveLength(4); // create + 3 syncs, none skipped as a hash-duplicate
  });

  test("the sync-subscriptions job's own SYSTEM_ROLE-only actor (no SystemAdmin) can dispatch sync-subscription", async () => {
    const tenantId = testTenantId(6008);
    await createSubscription(tenantId, {
      providerSubscriptionId: "sub_6008",
      providerCustomerId: "cus_6008",
      tier: "pro",
    });

    retrieveSnapshot = {
      providerCustomerId: "cus_6008",
      providerSubscriptionId: "sub_6008",
      status: SubscriptionStatuses.active,
      tier: "pro",
      currentPeriodEnd: "2026-06-01T00:00:00Z",
      cancelAt: "2026-05-01T00:00:00Z",
      rawPayload: '{"raw":"system-actor"}',
    };

    // Mirrors createSystemUser(tenantId) exactly — no extraRoles — matching
    // what the sync-subscriptions job's JobContext.write actually dispatches
    // as (job-runner.ts), unlike every other test here which authenticates
    // as a SystemAdmin over HTTP.
    const systemUser = createSystemUser(tenantId);
    const result = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.syncSubscription,
      {},
      systemUser,
    )) as { synced: boolean };
    expect(result).toEqual({ synced: true });
  });

  test("the resolved provider plugin has no retrieveSubscription → provider_cannot_retrieve", async () => {
    const admin = adminFor(6004);
    await createSubscription(admin.tenantId, {
      providerName: "mock-no-retrieve-provider",
      providerSubscriptionId: "sub_6004",
      providerCustomerId: "cus_6004",
    });

    const result = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.syncSubscription,
      {},
      admin,
    )) as { synced: boolean; reason?: string };
    expect(result).toEqual({ synced: false, reason: "provider_cannot_retrieve" });
  });

  test("the provider no longer knows the subscription → not_found", async () => {
    const admin = adminFor(6005);
    await createSubscription(admin.tenantId, {
      providerSubscriptionId: "sub_6005",
      providerCustomerId: "cus_6005",
    });
    retrieveSnapshot = null;

    const result = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.syncSubscription,
      {},
      admin,
    )) as { synced: boolean; reason?: string };
    expect(result).toEqual({ synced: false, reason: "not_found" });
  });

  test("provider snapshot has gone terminal (canceled) → appends a canceled-type event, not updated", async () => {
    const admin = adminFor(6009);
    await createSubscription(admin.tenantId, {
      providerSubscriptionId: "sub_6009",
      providerCustomerId: "cus_6009",
      tier: "pro",
    });

    retrieveSnapshot = {
      providerCustomerId: "cus_6009",
      providerSubscriptionId: "sub_6009",
      status: SubscriptionStatuses.canceled,
      tier: "pro",
      currentPeriodEnd: "2026-06-01T00:00:00Z",
      cancelAt: "2026-05-01T00:00:00Z",
      rawPayload: '{"raw":"provider-canceled"}',
    };

    const result = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.syncSubscription,
      {},
      admin,
    )) as { synced: boolean };
    expect(result).toEqual({ synced: true });

    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(admin.tenantId),
      admin.tenantId,
    );
    expect(esEvents).toHaveLength(2); // create + sync-cancel
    expect(esEvents[1]?.type).toBe("billing-foundation:event:subscription-canceled");

    const subs = (await stack.http.queryOk(
      SubscriptionFoundationQueries.listSubscriptions,
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows[0]?.["status"]).toBe(SubscriptionStatuses.canceled);
  });

  test("a terminal (canceled) subscription → no_live_subscription, provider never called", async () => {
    const admin = adminFor(6006);
    await createSubscription(admin.tenantId, {
      providerSubscriptionId: "sub_6006",
      providerCustomerId: "cus_6006",
      status: SubscriptionStatuses.canceled,
    });

    const result = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.syncSubscription,
      {},
      admin,
    )) as { synced: boolean; reason?: string };
    expect(result).toEqual({ synced: false, reason: "no_live_subscription" });
    expect(retrieveCalls).toHaveLength(0);
  });
});

// --- The actual `sync-subscriptions` job (perTenant fan-out via a real
// jobRunner/BullMQ worker), not the handler dispatched directly — every test
// above proves the handler's own branching; this proves the job wrapper
// resolves active tenants and fans out to each of them independently. ---
describe("sync-subscriptions job (perTenant fan-out)", () => {
  test("dispatching the job syncs every active tenant's own live subscription independently", async () => {
    if (!stack.jobRunner) {
      throw new Error("stack.jobRunner not wired — setupTestStack's `jobs` option is required");
    }
    const admin1 = adminFor(6020);
    const admin2 = adminFor(6021);
    // active-tenant-ids (the framework's own perTenant fan-out source, since
    // this stack mounts the tenant feature) only returns rows that actually
    // exist in tenantTable — adminFor()'s tenantId alone is not enough.
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: admin1.tenantId, key: `t-${admin1.tenantId}`, name: "Job-Fanout Tenant A" },
      admin1,
    );
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: admin2.tenantId, key: `t-${admin2.tenantId}`, name: "Job-Fanout Tenant B" },
      admin2,
    );

    await createSubscription(admin1.tenantId, {
      providerSubscriptionId: "sub_6020",
      providerCustomerId: "cus_6020",
      tier: "pro",
    });
    await createSubscription(admin2.tenantId, {
      providerSubscriptionId: "sub_6021",
      providerCustomerId: "cus_6021",
      tier: "pro",
    });

    retrieveSnapshotsById.set("sub_6020", {
      providerCustomerId: "cus_6020",
      providerSubscriptionId: "sub_6020",
      status: SubscriptionStatuses.active,
      tier: "pro",
      currentPeriodEnd: "2026-06-01T00:00:00Z",
      cancelAt: "2026-05-01T00:00:00Z",
      rawPayload: '{"raw":"job-fanout-a"}',
    });
    retrieveSnapshotsById.set("sub_6021", {
      providerCustomerId: "cus_6021",
      providerSubscriptionId: "sub_6021",
      status: SubscriptionStatuses.active,
      tier: "pro",
      currentPeriodEnd: "2026-06-01T00:00:00Z",
      cancelAt: "2026-04-15T00:00:00Z",
      rawPayload: '{"raw":"job-fanout-b"}',
    });

    await stack.jobRunner.dispatch("billing-foundation:job:sync-subscriptions", {});

    async function cancelAtFor(admin: ReturnType<typeof adminFor>): Promise<unknown> {
      const subs = (await stack.http.queryOk(
        SubscriptionFoundationQueries.listSubscriptions,
        {},
        admin,
      )) as { rows: Array<Record<string, unknown>> };
      return subs.rows[0]?.["cancelAt"];
    }

    await waitFor(async () => {
      expect(await cancelAtFor(admin1)).not.toBeNull();
      expect(await cancelAtFor(admin2)).not.toBeNull();
    });

    expect(await cancelAtFor(admin1)).toBe(
      Temporal.Instant.from("2026-05-01T00:00:00Z").toString(),
    );
    expect(await cancelAtFor(admin2)).toBe(
      Temporal.Instant.from("2026-04-15T00:00:00Z").toString(),
    );
  });
});
