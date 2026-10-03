// Drives the real tenant-lifecycle destruction sweep: a direct hook call with a hand-built
// TenantDb hides the escapeHatch grant the "app-data" stage actually resolves.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
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
  seedRow,
  updateRows,
} from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  ComplianceProfileHandlers,
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.js";
import { notificationPreferenceEntity } from "../../delivery/tables.js";
import { createTemplateResolverApi } from "../../template-resolver/api.js";
import { SYSTEM_TENANT_ID, TEXT_BLOCK_KIND } from "../../template-resolver/constants.js";
import { createTemplateResolverFeature } from "../../template-resolver/feature.js";
import { templateResourceEntity, templateResourcesTable } from "../../template-resolver/table.js";
import { TenantHandlers } from "../../tenant/constants.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantMembershipEntity } from "../../tenant/index.js";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.js";
import {
  TENANT_AGGREGATE_TYPE,
  TENANT_DESTRUCTION_STARTED_EVENT_QN,
} from "../../tenant-lifecycle/constants.js";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.js";
import { runTenantDestructionSweep } from "../../tenant-lifecycle/run-tenant-destroy.js";
import { createUserFeature } from "../../user/feature.js";
import { paymentAggregateId, subscriptionAggregateId } from "../aggregate-id.js";
import { SubscriptionEventTypes, SubscriptionFoundationHandlers } from "../constants.js";
import { consentTextVersion } from "../consumer-protection/consent-text.js";
import { CHECKOUT_CONSENT_RECORDED_EVENT_QN } from "../events.js";
import { createBillingFoundationFeature } from "../feature.js";
import { paymentsProjectionTable, subscriptionsProjectionTable } from "../projection.js";

const mockProviderFeature = defineFeature("test-mock-destroy-provider", (r) => {
  r.requires("billing-foundation");
  r.useExtension("subscriptionProvider", "mock-destroy-provider", {
    verifyAndParseWebhook: async () => null,
    oneOffPriceIds: ["price_topup"],
    createCheckoutSession: async () => ({ url: "https://mock.example/checkout" }),
  });
});

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
      createUserFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createTemplateResolverFeature(),
      createDeliveryFeature(),
      createBillingFoundationFeature({
        baseUrl: "https://app.example.com",
        consumerProtection: {
          termsTextBlock: "billing-terms",
          vatNote: { de: "inkl. USt.", en: "incl. VAT" },
          operatorEmail: "billing@example.com",
          legalLinks: { terms: "/terms", withdrawal: "/withdrawal", privacy: "/privacy" },
        },
      }),
      mockProviderFeature,
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      templateResolver: createTemplateResolverApi(deps.db),
    }),
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(db, tenantMembershipEntity);
  await unsafeCreateEntityTable(db, templateResourceEntity);
  await unsafeCreateEntityTable(db, notificationPreferenceEntity);
  await seedRow(db, templateResourcesTable, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "billing-terms",
    kind: TEXT_BLOCK_KIND,
    locale: "de",
    scope: "system",
    status: "active",
    content: "Terms",
    contentFormat: "markdown",
    variableSchema: JSON.stringify({}),
    linkedResources: JSON.stringify({}),
    parentTemplateId: null,
    insertedById: "test",
    modifiedById: "test",
  });
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(async () => {
  stack.events.reset();
  await resetTestTables(db, [tenantTable, tenantComplianceProfileTable]);
  await stack.db.unsafe?.(
    `TRUNCATE kumiko_events, read_subscriptions, read_payments RESTART IDENTITY CASCADE`,
  );
});

async function seedTenant(user: typeof tenantA, profileKey = "eu-dsgvo"): Promise<void> {
  await stack.http.writeOk(
    TenantHandlers.create,
    { id: user.tenantId, key: `t-${user.tenantId}`, name: "Tenant" },
    TestUsers.systemAdmin,
  );
  await stack.http.writeOk(ComplianceProfileHandlers.setProfile, { profileKey }, user);
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

async function seedPayment(user: typeof tenantA, eventIdSuffix: string): Promise<void> {
  await stack.http.writeOk(
    SubscriptionFoundationHandlers.processPaymentEvent,
    {
      providerEventId: `evt_pay_${eventIdSuffix}`,
      providerName: "stripe",
      providerCustomerId: `cus_pay_${eventIdSuffix}`,
      priceId: "price_one_off",
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
    await seedPayment(tenantA, "a");
    await seedPayment(tenantB, "b");

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

    expect(
      await selectMany(db, paymentsProjectionTable, { tenantId: tenantA.tenantId }),
    ).toHaveLength(0);
    expect(
      await selectMany(db, paymentsProjectionTable, { tenantId: tenantB.tenantId }),
    ).toHaveLength(1);
    expect(await isStreamArchived(db, tenantA.tenantId, paymentAggregateId(tenantA.tenantId))).toBe(
      true,
    );
  });

  test("HGB profile: redacts PII fields but keeps the row and archives its stream", async () => {
    const tenantHgb = adminFor(9003);
    await seedTenant(tenantHgb, "de-hr-dsgvo-hgb");

    await seedSubscription(tenantHgb, "c");
    await seedPayment(tenantHgb, "c");

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

    const paymentRows = await selectMany(db, paymentsProjectionTable, {
      tenantId: tenantHgb.tenantId,
    });
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0]?.["providerCustomerId"]).toBe("[erased]");
    expect(
      await isStreamArchived(db, tenantHgb.tenantId, paymentAggregateId(tenantHgb.tenantId)),
    ).toBe(true);
  });

  test("archives a recorded checkout consent together with its stream and keeps it readable", async () => {
    const tenant = adminFor(9004);
    await seedTenant(tenant);
    const consent = {
      earlyPerformanceRequested: true,
      withdrawalLossAcknowledged: true,
      consentTextVersion: consentTextVersion("de"),
      locale: "de",
    };
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.createCheckoutSession,
      {
        providerName: "mock-destroy-provider",
        priceId: "price_topup",
        successUrl: "https://app.example.com/ok",
        cancelUrl: "https://app.example.com/cancel",
        mode: "payment",
        consent,
      },
      tenant,
    );
    const paymentStream = paymentAggregateId(tenant.tenantId);
    const before = await loadAggregate(db, paymentStream, tenant.tenantId);
    expect(before.filter((e) => e.type === CHECKOUT_CONSENT_RECORDED_EVENT_QN)).toHaveLength(1);

    await seedDestroyingTenant(tenant.tenantId);
    expect(await driveDestructionToCompletion(tenant.tenantId)).toBe("destroyed");

    expect(await isStreamArchived(db, tenant.tenantId, paymentStream)).toBe(true);
    expect(await loadAggregate(db, paymentStream, tenant.tenantId)).toHaveLength(0);
    const archived = await loadAggregate(db, paymentStream, tenant.tenantId, {
      includeArchived: true,
    });
    expect(archived.filter((e) => e.type === CHECKOUT_CONSENT_RECORDED_EVENT_QN)).toHaveLength(1);
  });
});
