// Drives the real tenant-lifecycle destruction sweep: a direct hook call with a hand-built
// TenantDb hides the escapeHatch grant the "app-data" stage actually resolves.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { append, isStreamArchived, loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  resetPiiSubjectKmsForTests,
  resetTestTables,
  updateRows,
} from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { tenantMembershipEntity } from "../../tenant";
import { TenantHandlers } from "../../tenant/constants";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import {
  TENANT_AGGREGATE_TYPE,
  TENANT_DESTRUCTION_STARTED_EVENT_QN,
} from "../../tenant-lifecycle/constants";
import { runTenantDestructionSweep } from "../../tenant-lifecycle/run-tenant-destroy";
import { subscriptionAggregateId } from "../aggregate-id";
import { SubscriptionEventTypes, SubscriptionFoundationHandlers } from "../constants";
import { billingFoundationFeature } from "../feature";
import { subscriptionsProjectionTable } from "../projection";

const SET_PROFILE = "compliance-profiles:write:set-profile";

let stack: TestStack;
let db: DbConnection;

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

const tenantA = adminFor(9001);
const tenantB = adminFor(9002);

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      billingFoundationFeature,
    ],
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(db, tenantMembershipEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(async () => {
  stack.events.reset();
  await resetTestTables(db, [tenantTable, tenantComplianceProfileTable]);
  await stack.db.unsafe?.(`TRUNCATE kumiko_events, read_subscriptions RESTART IDENTITY CASCADE`);
});

async function seedTenant(user: typeof tenantA, profileKey = "eu-dsgvo"): Promise<void> {
  await stack.http.writeOk(
    TenantHandlers.create,
    { id: user.tenantId, key: `t-${user.tenantId}`, name: "Tenant" },
    TestUsers.systemAdmin,
  );
  await stack.http.writeOk(SET_PROFILE, { profileKey }, user);
}

async function seedSubscription(user: typeof tenantA, eventIdSuffix: string): Promise<void> {
  await stack.http.writeOk(
    SubscriptionFoundationHandlers.processEvent,
    {
      providerEventId: `evt_${eventIdSuffix}`,
      providerName: "stripe",
      type: SubscriptionEventTypes.created,
      status: "active",
      tier: "pro",
      providerCustomerId: `cus_${eventIdSuffix}`,
      providerSubscriptionId: `sub_${eventIdSuffix}`,
      currentPeriodEndIso: "2030-01-01T00:00:00Z",
      rawPayload: "{}",
    },
    user,
  );
}

async function seedDestroyingTenant(tenantId: TenantId): Promise<void> {
  const now = getTemporal().Now.instant();
  await updateRows(
    db,
    tenantTable,
    { status: "destroying", destroyStartedAt: now },
    { id: tenantId },
  );
  await append(db, {
    aggregateId: tenantId,
    aggregateType: TENANT_AGGREGATE_TYPE,
    tenantId,
    expectedVersion: (await loadAggregate(db, tenantId, tenantId)).at(-1)?.version ?? 0,
    type: TENANT_DESTRUCTION_STARTED_EVENT_QN,
    payload: { startedAt: now.toString() },
    metadata: { userId: "system", requestId: "test:destruction-started" },
  });
}

async function driveDestructionToCompletion(tenantId: TenantId): Promise<string> {
  const farFuture = getTemporal()
    .Now.instant()
    .add({ hours: 24 * 3650 });
  let status = "";
  for (let i = 0; i < 20; i++) {
    await runTenantDestructionSweep({ db: stack.db, registry: stack.registry, now: farFuture });
    const rows = await selectMany(db, tenantTable, { id: tenantId });
    status = String(rows[0]?.["status"]);
    if (status === "destroyed" || status === "destroyFailed") break;
  }
  return status;
}

describe("billing-foundation :: tenant destroy (#3196)", () => {
  test("deletes the subscription row for the destroyed tenant, archives its stream, leaves another tenant's row untouched", async () => {
    await seedTenant(tenantA);
    await seedTenant(tenantB);

    await seedSubscription(tenantA, "a");
    await seedSubscription(tenantB, "b");

    await seedDestroyingTenant(tenantA.tenantId);

    const finalStatus = await driveDestructionToCompletion(tenantA.tenantId);
    expect(finalStatus).toBe("destroyed");

    const rowsA = await selectMany(db, subscriptionsProjectionTable, {
      id: subscriptionAggregateId(tenantA.tenantId),
    });
    expect(rowsA).toHaveLength(0);

    const rowsB = await selectMany(db, subscriptionsProjectionTable, {
      id: subscriptionAggregateId(tenantB.tenantId),
    });
    expect(rowsB).toHaveLength(1);

    expect(
      await isStreamArchived(db, tenantA.tenantId, subscriptionAggregateId(tenantA.tenantId)),
    ).toBe(true);
  });

  test("HGB profile: redacts PII fields but keeps the row and archives its stream", async () => {
    const tenantHgb = adminFor(9003);
    await seedTenant(tenantHgb, "de-hr-dsgvo-hgb");

    await seedSubscription(tenantHgb, "c");

    await seedDestroyingTenant(tenantHgb.tenantId);

    const finalStatus = await driveDestructionToCompletion(tenantHgb.tenantId);
    expect(finalStatus).toBe("destroyed");

    const rowsA = await selectMany(db, subscriptionsProjectionTable, {
      id: subscriptionAggregateId(tenantHgb.tenantId),
    });
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]?.["providerCustomerId"]).toBe("[erased]");
    expect(rowsA[0]?.["providerSubscriptionId"]).toBe("[erased]");

    expect(
      await isStreamArchived(db, tenantHgb.tenantId, subscriptionAggregateId(tenantHgb.tenantId)),
    ).toBe(true);
  });
});
