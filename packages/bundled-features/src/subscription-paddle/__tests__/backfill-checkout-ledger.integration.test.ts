// The backfill-checkout-ledger job takes over Paddle checkouts opened by the release before the
// checkout ledger: it ledgers the ones still carrying the old tenantBinding, keeps sweeping for an
// hour after the first completed sweep, then stops calling Paddle. Paddle's API is the plugin's
// `send` seam; the rest is the real stack with an injected clock.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHmac, randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createManualClock, createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  paymentAggregateId,
  subscriptionAggregateId,
} from "../../billing-foundation/aggregate-id.ts";
import { CHECKOUT_OPENED_EVENT_QN } from "../../billing-foundation/events.ts";
import { createBillingFoundationFeature } from "../../billing-foundation/feature.ts";
import { paymentsProjectionTable } from "../../billing-foundation/projection.ts";
import { createSubscriptionWebhookRoute } from "../../billing-foundation/webhook-handler.ts";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigAccessorFactory } from "../../config/feature.ts";
import { configValuesTable, createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import {
  createSecretsContext,
  createSecretsFeature,
  tenantSecretsTable,
} from "../../secrets/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { createSubscriptionPaddleFeature } from "../feature.ts";
import {
  createSendMock,
  envelope,
  TEST_API_KEY,
  TEST_WEBHOOK_SECRET,
  webhookHeaders,
} from "./paddle-test-kit.ts";

const JOB = "subscription-paddle:job:backfill-checkout-ledger";
const PRICE_TO_TIER = { pri_pro: "pro" };
const ONE_OFF_PRICE = "pri_topup";
const clock = createManualClock(getTemporal().Now.instant());

const legacySubscriptionTenant = testTenantId(9201);
const legacyOneOffTenant = testTenantId(9202);
const modernTenant = testTenantId(9203);
const forgedBindingTenant = testTenantId(9204);

const LEGACY_BINDING_KEY = randomBytes(32).toString("base64");

// The release that signed bindings is gone; the test signs the way it did.
function legacyBindingFor(tenantId: string, key = LEGACY_BINDING_KEY): string {
  return createHmac("sha256", key)
    .update(`kumiko-paddle-tenant:v1:${tenantId}`)
    .digest("base64url");
}

const openTransactions = [
  {
    id: "txn_legacy_sub",
    custom_data: {
      tenantId: legacySubscriptionTenant,
      tenantBinding: legacyBindingFor(legacySubscriptionTenant),
      consentId: "consent-9201",
    },
    items: [{ price: { id: "pri_pro" } }],
  },
  {
    id: "txn_legacy_topup",
    custom_data: {
      tenantId: legacyOneOffTenant,
      tenantBinding: legacyBindingFor(legacyOneOffTenant),
    },
    items: [{ price: { id: ONE_OFF_PRICE } }],
  },
  {
    id: "txn_forged_binding",
    custom_data: {
      tenantId: forgedBindingTenant,
      tenantBinding: legacyBindingFor(forgedBindingTenant, "some-other-key"),
    },
    items: [{ price: { id: "pri_pro" } }],
  },
  {
    id: "txn_modern",
    custom_data: { tenantId: modernTenant },
    items: [{ price: { id: "pri_pro" } }],
  },
];

const paddle = createSendMock((call) =>
  call.method === "GET" && new URL(call.url).pathname.endsWith("/transactions")
    ? { body: { data: openTransactions, meta: { pagination: { has_more: false } } } }
    : { body: {} },
);

let stack: TestStack;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createSecretsFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createBillingFoundationFeature({ baseUrl: "https://app.example.com" }),
      createSubscriptionPaddleFeature({
        apiKey: TEST_API_KEY,
        webhookSecret: TEST_WEBHOOK_SECRET,
        priceToTier: PRICE_TO_TIER,
        oneOffPriceIds: [ONE_OFF_PRICE],
        legacyTenantBindingKey: LEGACY_BINDING_KEY,
        send: paddle.send,
      }),
    ],
    masterKeyProvider,
    extraContext: ({ db, registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      secrets: createSecretsContext({ db, masterKeyProvider, registry }),
      clock,
    }),
    jobs: { consumerLane: "worker" },
    extraRoutes: [createSubscriptionWebhookRoute()],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenant_secrets: tenantSecretsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  paddle.calls.length = 0;
});

async function runJob(): Promise<void> {
  await stack.jobRunner?.dispatch(JOB, {});
  await stack.drainJobs();
}

async function ledgerEntries(aggregateId: string, tenantId: string) {
  const events = await loadAggregate(stack.db, aggregateId, tenantId);
  return events.filter((event) => event.type === CHECKOUT_OPENED_EVENT_QN);
}

const transactionListCalls = () =>
  paddle.calls.filter((call) => new URL(call.url).pathname.endsWith("/transactions"));

function postCompletedTransaction(eventId: string, transactionId: string, tenantId: string) {
  const body = envelope(
    "transaction.completed",
    {
      id: transactionId,
      subscription_id: null,
      customer_id: "ctm_legacy",
      custom_data: { tenantId, tenantBinding: "binding-2" },
      items: [{ price: { id: ONE_OFF_PRICE } }],
    },
    eventId,
  );
  const timestamp = String(Math.floor(getTemporal().Now.instant().epochMilliseconds / 1000));
  return stack.app.request("/api/subscription/webhook/paddle", {
    method: "POST",
    body,
    headers: { ...webhookHeaders({ timestamp, body }), "content-type": "application/json" },
  });
}

describe("a legacy checkout that completes before the first sweep", () => {
  test("its webhook is answered with a retryable 503; once the sweep ledgered it, the redelivery is processed", async () => {
    const early = await postCompletedTransaction(
      "evt_legacy_1",
      "txn_legacy_topup",
      legacyOneOffTenant,
    );
    expect(early.status).toBe(503);
    expect(
      await selectMany(stack.db, paymentsProjectionTable, { tenantId: legacyOneOffTenant }),
    ).toHaveLength(0);

    await runJob();

    const redelivered = await postCompletedTransaction(
      "evt_legacy_1",
      "txn_legacy_topup",
      legacyOneOffTenant,
    );
    expect(redelivered.status).toBe(200);
    expect(await redelivered.json()).toMatchObject({ processed: true });
    expect(
      await selectMany(stack.db, paymentsProjectionTable, { tenantId: legacyOneOffTenant }),
    ).toHaveLength(1);
  });

  test("a checkout the sweep does not know and that has no tenantBinding is still a 200 ignore", async () => {
    const body = envelope(
      "transaction.completed",
      {
        id: "txn_forged",
        subscription_id: null,
        customer_id: "ctm_forged",
        custom_data: { tenantId: modernTenant },
        items: [{ price: { id: ONE_OFF_PRICE } }],
      },
      "evt_forged",
    );
    const timestamp = String(Math.floor(getTemporal().Now.instant().epochMilliseconds / 1000));
    const res = await stack.app.request("/api/subscription/webhook/paddle", {
      method: "POST",
      body,
      headers: { ...webhookHeaders({ timestamp, body }), "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
  });
});

describe("backfill-checkout-ledger job", () => {
  test("ledgers legacy checkouts with the mode their price implies, skips ones without a tenantBinding, and is idempotent", async () => {
    await runJob();

    const query = new URL(transactionListCalls()[0]?.url ?? "").searchParams;
    expect(query.get("status")).toBe("draft,ready,billed,paid,completed");
    expect(query.get("origin")).toBe("api");
    const since = Date.parse(query.get("created_at[GTE]") ?? "");
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(clock.now().epochMilliseconds - sevenDaysMs - since)).toBeLessThan(1000);

    const subscriptionEntries = await ledgerEntries(
      subscriptionAggregateId(legacySubscriptionTenant),
      legacySubscriptionTenant,
    );
    expect(subscriptionEntries.map((entry) => entry.payload)).toEqual([
      {
        providerName: "paddle",
        providerCheckoutId: "txn_legacy_sub",
        priceId: "pri_pro",
        mode: "subscription",
        consentId: "consent-9201",
      },
    ]);
    const paymentEntries = await ledgerEntries(
      paymentAggregateId(legacyOneOffTenant),
      legacyOneOffTenant,
    );
    expect(paymentEntries.map((entry) => entry.payload)).toEqual([
      {
        providerName: "paddle",
        providerCheckoutId: "txn_legacy_topup",
        priceId: ONE_OFF_PRICE,
        mode: "payment",
      },
    ]);
    expect(await ledgerEntries(subscriptionAggregateId(modernTenant), modernTenant)).toHaveLength(
      0,
    );
    // Paddle.js can send any customData, so a binding the legacy key did not sign is not ledgered.
    expect(
      await ledgerEntries(subscriptionAggregateId(forgedBindingTenant), forgedBindingTenant),
    ).toHaveLength(0);

    await runJob();
    expect(
      await ledgerEntries(
        subscriptionAggregateId(legacySubscriptionTenant),
        legacySubscriptionTenant,
      ),
    ).toHaveLength(1);
    expect(
      await ledgerEntries(paymentAggregateId(legacyOneOffTenant), legacyOneOffTenant),
    ).toHaveLength(1);
  });

  test("keeps sweeping inside the hour after the first sweep, then never calls Paddle again", async () => {
    clock.advance({ minutes: 59 });
    await runJob();
    expect(transactionListCalls().length).toBeGreaterThan(0);

    paddle.calls.length = 0;
    clock.advance({ minutes: 2 });
    await runJob();
    expect(paddle.calls).toHaveLength(0);
  });
});
