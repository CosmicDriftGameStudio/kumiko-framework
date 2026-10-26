import { describe, expect, test } from "bun:test";
import {
  BillingEventKinds,
  SubscriptionEventTypes,
  SubscriptionStatuses,
} from "../../billing-foundation/index.ts";
import { mapPaddleSubscriptionState } from "../subscription-state.ts";
import { signTenantBinding } from "../tenant-binding.ts";
import { verifyAndParsePaddleWebhook } from "../webhook-events.ts";
import {
  boundCustomData,
  envelope,
  NOW_SECONDS,
  subscriptionData,
  TEST_BINDING_KEY,
  TEST_WEBHOOK_SECRET,
  webhookHeaders,
} from "./paddle-test-kit.ts";

const PRICE_TO_TIER = { pri_pro: "pro", pri_team: "team" };
const TIMESTAMP = String(NOW_SECONDS);

function parser() {
  return verifyAndParsePaddleWebhook(
    {
      resolveWebhookSecret: async () => TEST_WEBHOOK_SECRET,
      resolveTenantBindingKey: async () => TEST_BINDING_KEY,
    },
    { priceToTier: PRICE_TO_TIER, nowSeconds: () => NOW_SECONDS },
  );
}

async function parse(body: string) {
  return parser()(body, webhookHeaders({ timestamp: TIMESTAMP, body }));
}

describe("subscription events", () => {
  test("subscription.created becomes a created event with the full mapping", async () => {
    const event = await parse(envelope("subscription.created", subscriptionData()));
    expect(event).toEqual({
      providerEventId: "evt_1",
      providerName: "paddle",
      type: SubscriptionEventTypes.created,
      tenantId: "tenant-paddle",
      consentId: "consent-1",
      providerCustomerId: "ctm_paddle_1",
      providerSubscriptionId: "sub_paddle_1",
      providerEventAt: "2026-11-01T10:00:00Z",
      status: SubscriptionStatuses.active,
      tier: "pro",
      currentPeriodEnd: "2026-12-01T10:00:00Z",
      cancelAt: null,
    });
  });

  test.each([
    ["subscription.activated", SubscriptionEventTypes.updated],
    ["subscription.updated", SubscriptionEventTypes.updated],
    ["subscription.trialing", SubscriptionEventTypes.updated],
    ["subscription.paused", SubscriptionEventTypes.updated],
    ["subscription.resumed", SubscriptionEventTypes.updated],
    ["subscription.past_due", SubscriptionEventTypes.invoicePaymentFailed],
    ["subscription.canceled", SubscriptionEventTypes.canceled],
  ])("%s maps to %s", async (paddleType, expected) => {
    const event = await parse(envelope(paddleType, subscriptionData()));
    expect(event).toMatchObject({ type: expected });
  });

  test.each([
    ["active", SubscriptionStatuses.active],
    ["trialing", SubscriptionStatuses.trialing],
    ["past_due", SubscriptionStatuses.pastDue],
    ["paused", SubscriptionStatuses.pastDue],
    ["canceled", SubscriptionStatuses.canceled],
  ])("status %s maps to %s", async (status, expected) => {
    const event = await parse(envelope("subscription.updated", subscriptionData({ status })));
    expect(event).toMatchObject({ status: expected });
  });

  test("a scheduled cancel sets cancelAt, other scheduled changes do not", async () => {
    const cancel = await parse(
      envelope(
        "subscription.updated",
        subscriptionData({
          scheduled_change: { action: "cancel", effective_at: "2026-12-01T10:00:00Z" },
        }),
      ),
    );
    expect(cancel).toMatchObject({ cancelAt: "2026-12-01T10:00:00Z" });
    const pause = await parse(
      envelope(
        "subscription.updated",
        subscriptionData({
          scheduled_change: { action: "pause", effective_at: "2026-12-01T10:00:00Z" },
        }),
      ),
    );
    expect(pause).toMatchObject({ cancelAt: null });
  });

  test("currentPeriodEnd falls back to next_billed_at, then canceled_at", async () => {
    const nextBilled = await parse(
      envelope(
        "subscription.updated",
        subscriptionData({
          current_billing_period: null,
          next_billed_at: "2026-12-05T00:00:00Z",
        }),
      ),
    );
    expect(nextBilled).toMatchObject({ currentPeriodEnd: "2026-12-05T00:00:00Z" });
    const canceledAt = await parse(
      envelope(
        "subscription.canceled",
        subscriptionData({
          status: "canceled",
          current_billing_period: null,
          next_billed_at: null,
          canceled_at: "2026-11-30T00:00:00Z",
        }),
      ),
    );
    expect(canceledAt).toMatchObject({ currentPeriodEnd: "2026-11-30T00:00:00Z" });
  });

  test("the tier comes from the first item whose price is mapped", async () => {
    const event = await parse(
      envelope(
        "subscription.updated",
        subscriptionData({
          items: [{ price: { id: "pri_addon" } }, { price: { id: "pri_team" } }],
        }),
      ),
    );
    expect(event).toMatchObject({ tier: "team" });
  });

  test("a price outside priceToTier drops the whole event", async () => {
    expect(
      await parse(
        envelope("subscription.created", subscriptionData({ items: [{ price: { id: "pri_x" } }] })),
      ),
    ).toBeNull();
  });

  test("unknown event types and schema drift are ignored", async () => {
    expect(await parse(envelope("adjustment.created", subscriptionData()))).toBeNull();
    expect(await parse(envelope("subscription.created", { id: "x" }))).toBeNull();
    expect(await parse(JSON.stringify({ event_type: "subscription.created" }))).toBeNull();
  });

  test("prototype keys are not event types, statuses or price ids", async () => {
    expect(await parse(envelope("constructor", subscriptionData()))).toBeNull();
    expect(await parse(envelope("toString", subscriptionData()))).toBeNull();
    expect(
      await parse(envelope("subscription.created", subscriptionData({ status: "constructor" }))),
    ).toBeNull();
    expect(
      await parse(
        envelope(
          "subscription.created",
          subscriptionData({ items: [{ price: { id: "constructor" } }] }),
        ),
      ),
    ).toBeNull();
  });
});

describe("tenant binding", () => {
  test("a missing tenant or binding drops the event", async () => {
    for (const custom_data of [
      null,
      {},
      { tenantId: "tenant-paddle" },
      { tenantBinding: signTenantBinding(TEST_BINDING_KEY, "tenant-paddle") },
    ]) {
      expect(
        await parse(envelope("subscription.created", subscriptionData({ custom_data }))),
      ).toBeNull();
    }
  });

  test("a binding made for another tenant or with another key drops the event", async () => {
    const forVictim = {
      tenantId: "victim-tenant",
      tenantBinding: signTenantBinding(TEST_BINDING_KEY, "attacker-tenant"),
    };
    const wrongKey = {
      tenantId: "tenant-paddle",
      tenantBinding: signTenantBinding("some-other-key", "tenant-paddle"),
    };
    for (const custom_data of [forVictim, wrongKey]) {
      expect(
        await parse(envelope("subscription.created", subscriptionData({ custom_data }))),
      ).toBeNull();
    }
  });

  test("a malformed consentId is omitted, not forwarded", async () => {
    const event = await parse(
      envelope(
        "subscription.created",
        subscriptionData({
          custom_data: boundCustomData("tenant-paddle", { consentId: "bad id!" }),
        }),
      ),
    );
    expect(event).not.toBeNull();
    expect(event && "consentId" in event).toBe(false);
  });
});

describe("transaction.completed", () => {
  const transaction = (overrides: Record<string, unknown> = {}) => ({
    id: "txn_1",
    subscription_id: null,
    customer_id: "ctm_paddle_1",
    custom_data: boundCustomData("tenant-paddle"),
    items: [{ price: { id: "pri_topup" } }],
    ...overrides,
  });

  test("a one-off transaction becomes a PaymentEvent", async () => {
    const event = await parse(envelope("transaction.completed", transaction()));
    expect(event).toEqual({
      kind: BillingEventKinds.payment,
      providerEventId: "evt_1",
      providerName: "paddle",
      tenantId: "tenant-paddle",
      providerCheckoutId: "txn_1",
      providerCustomerId: "ctm_paddle_1",
      priceId: "pri_topup",
    });
  });

  test("a subscription's own transaction is covered by its subscription events", async () => {
    expect(
      await parse(envelope("transaction.completed", transaction({ subscription_id: "sub_1" }))),
    ).toBeNull();
  });

  test("an unbound transaction is ignored", async () => {
    expect(
      await parse(
        envelope("transaction.completed", transaction({ custom_data: { tenantId: "victim" } })),
      ),
    ).toBeNull();
  });
});

describe("rejection", () => {
  test("an unauthenticated request does not read the tenant binding key", async () => {
    let bindingReads = 0;
    const guarded = verifyAndParsePaddleWebhook(
      {
        resolveWebhookSecret: async () => TEST_WEBHOOK_SECRET,
        resolveTenantBindingKey: async () => {
          bindingReads += 1;
          return TEST_BINDING_KEY;
        },
      },
      { priceToTier: PRICE_TO_TIER, nowSeconds: () => NOW_SECONDS },
    );
    const body = envelope("subscription.created", subscriptionData());
    await expect(
      guarded(body, { "paddle-signature": `ts=${TIMESTAMP};h1=${"0".repeat(64)}` }),
    ).rejects.toThrow();
    expect(bindingReads).toBe(0);
  });

  test("throws on a wrong signature before parsing anything", async () => {
    const body = envelope("subscription.created", subscriptionData());
    const headers = webhookHeaders({ timestamp: TIMESTAMP, body: `${body} ` });
    await expect(parser()(body, headers)).rejects.toThrow(/signature verify failed/);
  });

  test("throws when no webhook secret is configured", async () => {
    const unconfigured = verifyAndParsePaddleWebhook(
      {
        resolveWebhookSecret: async () => {
          throw new Error("subscription-paddle: 'webhook-secret' unresolved");
        },
        resolveTenantBindingKey: async () => TEST_BINDING_KEY,
      },
      { priceToTier: PRICE_TO_TIER },
    );
    const body = envelope("subscription.created", subscriptionData());
    await expect(
      unconfigured(body, webhookHeaders({ timestamp: TIMESTAMP, body })),
    ).rejects.toThrow(/unresolved/);
  });
});

describe("mapPaddleSubscriptionState", () => {
  test("returns null for an unknown status", () => {
    const sub = subscriptionData({ status: "mystery" });
    expect(
      mapPaddleSubscriptionState(
        {
          id: sub.id,
          status: sub.status,
          customer_id: sub.customer_id,
          items: sub.items,
        },
        PRICE_TO_TIER,
      ),
    ).toBeNull();
  });
});
