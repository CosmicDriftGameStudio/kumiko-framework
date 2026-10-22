import { describe, expect, test } from "bun:test";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import {
  BillingEventKinds,
  SubscriptionEventTypes,
  SubscriptionStatuses,
} from "../../billing-foundation/index.ts";
import {
  mapDodoSubscriptionState,
  verifyAndParseDodoWebhook,
  verifyStandardWebhook,
  WEBHOOK_TOLERANCE_SECONDS,
} from "../verify-webhook.ts";
import {
  envelope,
  NOW_SECONDS,
  signStandardWebhook,
  subscriptionData,
  TEST_WEBHOOK_SECRET,
  webhookHeaders,
} from "./dodo-test-kit.ts";

const BODY = envelope("subscription.active", subscriptionData());
const TIMESTAMP = String(NOW_SECONDS);

function headersFor(body = BODY, overrides: Record<string, string> = {}) {
  return { ...webhookHeaders({ id: "msg_1", timestamp: TIMESTAMP, body }), ...overrides };
}

describe("verifyStandardWebhook", () => {
  test("accepts a valid signature", () => {
    expect(() =>
      verifyStandardWebhook(BODY, headersFor(), TEST_WEBHOOK_SECRET, NOW_SECONDS),
    ).not.toThrow();
  });

  test("accepts a secret with and without the whsec_ prefix", () => {
    const bare = TEST_WEBHOOK_SECRET.replace(/^whsec_/, "");
    expect(() => verifyStandardWebhook(BODY, headersFor(), bare, NOW_SECONDS)).not.toThrow();
  });

  test("rejects a wrong signature", () => {
    const other = signStandardWebhook({
      id: "msg_1",
      timestamp: TIMESTAMP,
      body: BODY,
      secret: `whsec_${Buffer.from("another-key").toString("base64")}`,
    });
    expect(() =>
      verifyStandardWebhook(
        BODY,
        headersFor(BODY, { "webhook-signature": other }),
        TEST_WEBHOOK_SECRET,
        NOW_SECONDS,
      ),
    ).toThrow(/signature verify failed/);
  });

  test("rejects a signature of a different length without throwing from timingSafeEqual", () => {
    expect(() =>
      verifyStandardWebhook(
        BODY,
        headersFor(BODY, { "webhook-signature": "v1,AAAA" }),
        TEST_WEBHOOK_SECRET,
        NOW_SECONDS,
      ),
    ).toThrow(/signature verify failed/);
  });

  test("accepts when one of several space-separated v1 entries is valid", () => {
    const valid = signStandardWebhook({ id: "msg_1", timestamp: TIMESTAMP, body: BODY });
    const header = `v1,${Buffer.from("junk").toString("base64")} v2,ignored ${valid}`;
    expect(() =>
      verifyStandardWebhook(
        BODY,
        headersFor(BODY, { "webhook-signature": header }),
        TEST_WEBHOOK_SECRET,
        NOW_SECONDS,
      ),
    ).not.toThrow();
  });

  test("rejects a timestamp older and newer than the tolerance, accepts the boundary", () => {
    const at = (timestamp: number) =>
      verifyStandardWebhook(
        BODY,
        webhookHeaders({ id: "msg_1", timestamp: String(timestamp), body: BODY }),
        TEST_WEBHOOK_SECRET,
        NOW_SECONDS,
      );
    expect(() => at(NOW_SECONDS - WEBHOOK_TOLERANCE_SECONDS - 1)).toThrow(/tolerance/);
    expect(() => at(NOW_SECONDS + WEBHOOK_TOLERANCE_SECONDS + 1)).toThrow(/tolerance/);
    expect(() => at(NOW_SECONDS - WEBHOOK_TOLERANCE_SECONDS)).not.toThrow();
    expect(() => at(NOW_SECONDS + WEBHOOK_TOLERANCE_SECONDS)).not.toThrow();
  });

  test("rejects a non-integer timestamp", () => {
    expect(() =>
      verifyStandardWebhook(
        BODY,
        webhookHeaders({ id: "msg_1", timestamp: "1770000000.5", body: BODY }),
        TEST_WEBHOOK_SECRET,
        NOW_SECONDS,
      ),
    ).toThrow(/Unix timestamp/);
  });

  test("rejects missing headers", () => {
    for (const header of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
      const { [header]: _removed, ...rest } = headersFor();
      expect(() => verifyStandardWebhook(BODY, rest, TEST_WEBHOOK_SECRET, NOW_SECONDS)).toThrow(
        /missing/,
      );
    }
  });

  test("verifies the raw string: a body re-serialized by JSON.stringify no longer matches", () => {
    const spaced = `{ "type" : "subscription.active",\n  "timestamp": "2026-11-01T10:00:00Z", "data": {} }`;
    const headers = webhookHeaders({ id: "msg_1", timestamp: TIMESTAMP, body: spaced });
    expect(() =>
      verifyStandardWebhook(spaced, headers, TEST_WEBHOOK_SECRET, NOW_SECONDS),
    ).not.toThrow();
    const reserialized = JSON.stringify(parseJsonOrThrow<unknown>(spaced, "fixture"));
    expect(() =>
      verifyStandardWebhook(reserialized, headers, TEST_WEBHOOK_SECRET, NOW_SECONDS),
    ).toThrow(/signature verify failed/);
  });
});

const PRICE_TO_TIER = { pdt_pro: "pro", pdt_team: "team" };

function parser() {
  return verifyAndParseDodoWebhook(
    { resolveWebhookSecret: async () => TEST_WEBHOOK_SECRET },
    { priceToTier: PRICE_TO_TIER, nowSeconds: () => NOW_SECONDS },
  );
}

async function parse(body: string) {
  return parser()(body, webhookHeaders({ id: "msg_evt_1", timestamp: TIMESTAMP, body }));
}

describe("verifyAndParseDodoWebhook — subscription events", () => {
  test("subscription.active becomes a created event with the full mapping", async () => {
    const event = await parse(envelope("subscription.active", subscriptionData()));
    expect(event).toEqual({
      providerEventId: "msg_evt_1",
      providerName: "dodo",
      type: SubscriptionEventTypes.created,
      tenantId: "tenant-dodo",
      consentId: "consent-1",
      providerCustomerId: "cus_dodo_1",
      providerSubscriptionId: "sub_dodo_1",
      providerEventAt: "2026-11-01T10:00:00Z",
      status: SubscriptionStatuses.active,
      tier: "pro",
      currentPeriodEnd: "2026-12-01T10:00:00Z",
      cancelAt: null,
    });
  });

  test.each([
    ["subscription.updated", SubscriptionEventTypes.updated],
    ["subscription.plan_changed", SubscriptionEventTypes.updated],
    ["subscription.paused", SubscriptionEventTypes.updated],
    ["subscription.unpaused", SubscriptionEventTypes.updated],
    ["subscription.update_payment_method", SubscriptionEventTypes.updated],
    ["subscription.renewed", SubscriptionEventTypes.invoicePaid],
    ["subscription.past_due", SubscriptionEventTypes.invoicePaymentFailed],
    ["subscription.on_hold", SubscriptionEventTypes.invoicePaymentFailed],
    ["subscription.cancelled", SubscriptionEventTypes.canceled],
    ["subscription.expired", SubscriptionEventTypes.canceled],
    ["subscription.failed", SubscriptionEventTypes.canceled],
  ])("%s maps to %s", async (dodoType, expected) => {
    const event = await parse(envelope(dodoType, subscriptionData()));
    expect(event).toMatchObject({ type: expected });
  });

  test.each([
    ["pending", SubscriptionStatuses.incomplete],
    ["active", SubscriptionStatuses.active],
    ["on_hold", SubscriptionStatuses.pastDue],
    ["past_due", SubscriptionStatuses.pastDue],
    ["paused", SubscriptionStatuses.pastDue],
    ["cancelled", SubscriptionStatuses.canceled],
    ["failed", SubscriptionStatuses.canceled],
    ["expired", SubscriptionStatuses.canceled],
  ])("status %s maps to %s", async (status, expected) => {
    const event = await parse(envelope("subscription.updated", subscriptionData({ status })));
    expect(event).toMatchObject({ status: expected });
  });

  test("cancel_at_next_billing_date sets cancelAt to the next billing date", async () => {
    const event = await parse(
      envelope("subscription.updated", subscriptionData({ cancel_at_next_billing_date: true })),
    );
    expect(event).toMatchObject({ cancelAt: "2026-12-01T10:00:00Z" });
  });

  test("a product outside priceToTier drops the whole event", async () => {
    expect(
      await parse(envelope("subscription.active", subscriptionData({ product_id: "pdt_unknown" }))),
    ).toBeNull();
  });

  test("a subscription without tenant metadata is dropped", async () => {
    expect(
      await parse(envelope("subscription.active", subscriptionData({ metadata: {} }))),
    ).toBeNull();
    expect(
      await parse(envelope("subscription.active", subscriptionData({ metadata: null }))),
    ).toBeNull();
  });

  test("a malformed consentId is omitted, not forwarded", async () => {
    const event = await parse(
      envelope(
        "subscription.active",
        subscriptionData({ metadata: { tenantId: "tenant-dodo", consentId: "bad id!" } }),
      ),
    );
    expect(event).not.toBeNull();
    expect(event && "consentId" in event).toBe(false);
  });

  test("unknown event types and schema drift are ignored", async () => {
    expect(await parse(envelope("dispute.opened", subscriptionData()))).toBeNull();
    expect(await parse(envelope("subscription.active", { subscription_id: "x" }))).toBeNull();
  });
});

describe("verifyAndParseDodoWebhook — payment events", () => {
  const payment = (overrides: Record<string, unknown> = {}) => ({
    payment_id: "pay_1",
    subscription_id: null,
    checkout_session_id: "cks_1",
    customer: { customer_id: "cus_dodo_1" },
    metadata: { tenantId: "tenant-dodo" },
    product_cart: [{ product_id: "pdt_topup", quantity: 1 }],
    ...overrides,
  });

  test("payment.succeeded without a subscription becomes a PaymentEvent", async () => {
    const event = await parse(envelope("payment.succeeded", payment()));
    expect(event).toEqual({
      kind: BillingEventKinds.payment,
      providerEventId: "msg_evt_1",
      providerName: "dodo",
      tenantId: "tenant-dodo",
      providerCheckoutId: "cks_1",
      providerCustomerId: "cus_dodo_1",
      priceId: "pdt_topup",
    });
  });

  test("a subscription's own payment is covered by its subscription events", async () => {
    expect(
      await parse(envelope("payment.succeeded", payment({ subscription_id: "sub_dodo_1" }))),
    ).toBeNull();
  });

  test("other payment events and payments without tenant metadata are ignored", async () => {
    expect(await parse(envelope("payment.failed", payment()))).toBeNull();
    expect(await parse(envelope("payment.succeeded", payment({ metadata: {} })))).toBeNull();
  });
});

describe("verifyAndParseDodoWebhook — rejection", () => {
  test("throws on a wrong signature before parsing anything", async () => {
    const body = envelope("subscription.active", subscriptionData());
    const headers = webhookHeaders({ id: "msg_evt_1", timestamp: TIMESTAMP, body: `${body} ` });
    await expect(parser()(body, headers)).rejects.toThrow(/signature verify failed/);
  });

  test("throws when no webhook secret is configured", async () => {
    const unconfigured = verifyAndParseDodoWebhook(
      {
        resolveWebhookSecret: async () => {
          throw new Error("subscription-dodo: 'webhook-secret' unresolved");
        },
      },
      { priceToTier: PRICE_TO_TIER },
    );
    await expect(unconfigured(BODY, headersFor())).rejects.toThrow(/unresolved/);
  });
});

describe("mapDodoSubscriptionState", () => {
  test("returns null for an unknown status", () => {
    const sub = {
      subscription_id: "s",
      product_id: "pdt_pro",
      status: "mystery",
      customer: { customer_id: "c" },
      next_billing_date: "2026-12-01T10:00:00Z",
    };
    expect(mapDodoSubscriptionState(sub, PRICE_TO_TIER)).toBeNull();
  });
});
