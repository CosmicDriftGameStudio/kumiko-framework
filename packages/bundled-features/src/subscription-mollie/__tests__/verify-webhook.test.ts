// Unit tests for verifyAndParseMollieWebhook — Mollie's classic
// webhook pattern (lazy fetch, without signature verification). The Mollie
// client is injected as a minimal mock shape (`MollieClientShape`); plugin
// behavior is decoupled from the concrete Mollie SDK.

import { describe, expect, mock, spyOn, test } from "bun:test";
import {
  SubscriptionEventTypes,
  SubscriptionStatuses,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import {
  extractMollieId,
  type MollieClientShape,
  mapMollieEventType,
  mapMollieStatus,
  verifyAndParseMollieWebhook,
} from "../verify-webhook.ts";

// =============================================================================
// Test-helpers
// =============================================================================

function buildMockSubscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sub_test_001",
    customerId: "cst_test_001",
    status: "active",
    nextPaymentDate: "2026-06-15",
    startDate: "2026-05-15",
    metadata: { tenantId: "tenant-test", priceId: "plan_pro" },
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock — only 4 fields are used
  } as any;
}

function buildMockPayment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "tr_test_001",
    customerId: "cst_test_001",
    subscriptionId: "sub_test_001",
    sequenceType: "first",
    status: "paid",
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock
  } as any;
}

function buildClient(
  overrides: {
    paymentResolve?: ReturnType<typeof buildMockPayment>;
    paymentReject?: Error;
    subResolve?: ReturnType<typeof buildMockSubscription>;
    subReject?: Error;
    /** Existing subscriptions returned by `customerSubscriptions.list` (for
     * mandate-setup idempotency tests). */
    listResolve?: ReturnType<typeof buildMockSubscription>[];
    /** What `customerSubscriptions.create` returns. Default: a newly
     * created subscription with metadata from the payment. */
    createResolve?: ReturnType<typeof buildMockSubscription>;
  } = {},
): MollieClientShape {
  return {
    payments: {
      get: mock(async () => {
        if (overrides.paymentReject) throw overrides.paymentReject;
        return overrides.paymentResolve ?? buildMockPayment();
      }),
    },
    customerSubscriptions: {
      get: mock(async () => {
        if (overrides.subReject) throw overrides.subReject;
        return overrides.subResolve ?? buildMockSubscription();
      }),
      list: mock(async () => overrides.listResolve ?? []),
      create: mock(
        async () => overrides.createResolve ?? buildMockSubscription({ id: "sub_just_created" }),
      ),
    },
  };
}

const TEST_PRICE_CONFIG = {
  plan_pro: {
    amountValue: "9.99",
    amountCurrency: "EUR",
    interval: "1 month",
    description: "Pro-Abo monatlich",
  },
};

// =============================================================================
// extractMollieId — body-parsing
// =============================================================================

describe("extractMollieId", () => {
  test("form-urlencoded body → extract id", () => {
    expect(
      extractMollieId("id=tr_xxx", { "content-type": "application/x-www-form-urlencoded" }),
    ).toBe("tr_xxx");
  });

  test("default content-type is treated as form-urlencoded (Mollie-classic)", () => {
    expect(extractMollieId("id=sub_yyy", {})).toBe("sub_yyy");
  });

  test("JSON body with content-type", () => {
    expect(extractMollieId('{"id":"tr_zzz"}', { "content-type": "application/json" })).toBe(
      "tr_zzz",
    );
  });

  test("malformed JSON → null instead of throwing (defensive)", () => {
    expect(extractMollieId("not json", { "content-type": "application/json" })).toBeNull();
  });

  test("body without id → null", () => {
    expect(extractMollieId("foo=bar", {})).toBeNull();
  });
});

// =============================================================================
// Lazy-fetch
// =============================================================================

describe("verifyAndParseMollieWebhook — payment-event happy path", () => {
  const verify = (client: MollieClientShape) =>
    verifyAndParseMollieWebhook(client, {
      priceToTier: { plan_pro: "pro" },
      priceToConfig: TEST_PRICE_CONFIG,
    });

  test("tr_xxx → fetch payment + subscription → SubscriptionEvent.created (first-payment paid)", async () => {
    const client = buildClient();
    const event = await verify(client)("id=tr_test_001", {});
    expect(event).not.toBeNull();
    expect(event?.providerName).toBe("mollie");
    expect(event?.providerEventId).toBe("tr_test_001");
    expect(event?.type).toBe(SubscriptionEventTypes.created);
    expect(event?.tenantId).toBe("tenant-test");
    expect(event?.tier).toBe("pro");
    expect(event?.providerSubscriptionId).toBe("sub_test_001");
    expect(event?.providerCustomerId).toBe("cst_test_001");
    expect(event?.status).toBe(SubscriptionStatuses.active);
  });

  test("subscription metadata.consentId → event.consentId; invalid → omitted", async () => {
    const withConsent = buildClient({
      subResolve: buildMockSubscription({
        metadata: { tenantId: "tenant-test", priceId: "plan_pro", consentId: "consent-1" },
      }),
    });
    expect((await verify(withConsent)("id=tr_test_001", {}))?.consentId).toBe("consent-1");
    const invalid = buildClient({
      subResolve: buildMockSubscription({
        metadata: { tenantId: "tenant-test", priceId: "plan_pro", consentId: "bad id!" },
      }),
    });
    expect(await verify(invalid)("id=tr_test_001", {})).not.toHaveProperty("consentId");
  });

  test("recurring-payment paid → invoicePaid", async () => {
    const client = buildClient({
      paymentResolve: buildMockPayment({ sequenceType: "recurring", status: "paid" }),
    });
    const event = await verify(client)("id=tr_renewal_001", {});
    expect(event?.type).toBe(SubscriptionEventTypes.invoicePaid);
  });

  test("recurring-payment failed → invoicePaymentFailed", async () => {
    const client = buildClient({
      paymentResolve: buildMockPayment({ sequenceType: "recurring", status: "failed" }),
    });
    const event = await verify(client)("id=tr_failed_001", {});
    expect(event?.type).toBe(SubscriptionEventTypes.invoicePaymentFailed);
  });

  test("subscription canceled → SubscriptionEventTypes.canceled (egal welche payment-status)", async () => {
    const client = buildClient({
      subResolve: buildMockSubscription({ status: "canceled" }),
    });
    const event = await verify(client)("id=tr_test_001", {});
    expect(event?.type).toBe(SubscriptionEventTypes.canceled);
    expect(event?.status).toBe(SubscriptionStatuses.canceled);
  });
});

describe("verifyAndParseMollieWebhook — mandate-setup-flow (= first-payment-paid OHNE existierende sub)", () => {
  const verify = (client: MollieClientShape) =>
    verifyAndParseMollieWebhook(client, {
      priceToTier: { plan_pro: "pro" },
      priceToConfig: TEST_PRICE_CONFIG,
    });

  test("first-payment paid, subscriptionId=null → list is empty → ensureSubscription creates new sub → Created event with the new sub-id", async () => {
    const newlyCreatedSub = buildMockSubscription({
      id: "sub_just_created",
      metadata: { tenantId: "tenant-test", priceId: "plan_pro" },
    });
    const client = buildClient({
      paymentResolve: buildMockPayment({
        subscriptionId: null,
        sequenceType: "first",
        status: "paid",
        metadata: { tenantId: "tenant-test", priceId: "plan_pro" },
      }),
      listResolve: [],
      createResolve: newlyCreatedSub,
    });

    const event = await verify(client)("id=tr_first_paid_001", {});

    expect(event).not.toBeNull();
    expect(event?.type).toBe(SubscriptionEventTypes.created);
    expect(event?.providerSubscriptionId).toBe("sub_just_created");
    expect(client.customerSubscriptions.create).toHaveBeenCalledTimes(1);
    expect(client.customerSubscriptions.create).toHaveBeenCalledWith("cst_test_001", {
      amount: { currency: "EUR", value: "9.99" },
      interval: "1 month",
      description: "Pro-Abo monatlich",
      metadata: { tenantId: "tenant-test", priceId: "plan_pro" },
    });
  });

  test("consentId from the first payment is copied onto the created subscription's metadata", async () => {
    const client = buildClient({
      paymentResolve: buildMockPayment({
        subscriptionId: null,
        sequenceType: "first",
        status: "paid",
        metadata: { tenantId: "tenant-test", priceId: "plan_pro", consentId: "consent-1" },
      }),
      listResolve: [],
      createResolve: buildMockSubscription({
        id: "sub_just_created",
        metadata: { tenantId: "tenant-test", priceId: "plan_pro", consentId: "consent-1" },
      }),
    });
    const event = await verify(client)("id=tr_first_paid_001", {});
    expect(event?.consentId).toBe("consent-1");
    expect(client.customerSubscriptions.create).toHaveBeenCalledWith(
      "cst_test_001",
      expect.objectContaining({
        metadata: { tenantId: "tenant-test", priceId: "plan_pro", consentId: "consent-1" },
      }),
    );
  });

  test("Replay (Mollie sends webhook again) → list finds existing active sub for priceId → no second create", async () => {
    const existingSub = buildMockSubscription({
      id: "sub_already_there",
      status: "active",
      metadata: { tenantId: "tenant-test", priceId: "plan_pro" },
    });
    const client = buildClient({
      paymentResolve: buildMockPayment({
        subscriptionId: null,
        sequenceType: "first",
        status: "paid",
        metadata: { tenantId: "tenant-test", priceId: "plan_pro" },
      }),
      listResolve: [existingSub],
    });

    const event = await verify(client)("id=tr_first_paid_replay", {});

    expect(event?.providerSubscriptionId).toBe("sub_already_there");
    expect(client.customerSubscriptions.create).not.toHaveBeenCalled();
  });

  test("List has sub for a DIFFERENT priceId (= App-Builder offers plan change) → still create for new priceId", async () => {
    const otherPlanSub = buildMockSubscription({
      id: "sub_basic_old",
      status: "active",
      metadata: { tenantId: "tenant-test", priceId: "plan_basic" },
    });
    const client = buildClient({
      paymentResolve: buildMockPayment({
        subscriptionId: null,
        sequenceType: "first",
        status: "paid",
        metadata: { tenantId: "tenant-test", priceId: "plan_pro" },
      }),
      listResolve: [otherPlanSub],
      createResolve: buildMockSubscription({
        id: "sub_pro_new",
        metadata: { tenantId: "tenant-test", priceId: "plan_pro" },
      }),
    });

    const event = await verify(client)("id=tr_upgrade", {});

    expect(event?.providerSubscriptionId).toBe("sub_pro_new");
    expect(client.customerSubscriptions.create).toHaveBeenCalledTimes(1);
  });
});

describe("verifyAndParseMollieWebhook — error + ignore paths", () => {
  const verify = (client: MollieClientShape) =>
    verifyAndParseMollieWebhook(client, {
      priceToTier: { plan_pro: "pro" },
      priceToConfig: TEST_PRICE_CONFIG,
    });

  test("body without id → throws", async () => {
    const client = buildClient();
    await expect(verify(client)("not-an-id-form", {})).rejects.toThrow(/no `id` field/);
  });

  test("unknown ID form (no tr_/sub_ prefix) → null", async () => {
    const client = buildClient();
    expect(await verify(client)("id=unknown_xyz", {})).toBeNull();
  });

  test("Mollie-API rejectet payment-fetch (= garbage-id) → null (foundation 200 ignored)", async () => {
    const client = buildClient({ paymentReject: new Error("Mollie 404: not found") });
    expect(await verify(client)("id=tr_garbage", {})).toBeNull();
  });

  test("payment without subscriptionId AND not first-payment-paid → null (= one-shot, not our domain)", async () => {
    const client = buildClient({
      paymentResolve: buildMockPayment({ subscriptionId: null, sequenceType: "oneoff" }),
    });
    expect(await verify(client)("id=tr_oneshot", {})).toBeNull();
  });

  test("first-payment-paid WITHOUT payment.metadata → null (App-Builder did not set tenantId/priceId)", async () => {
    const client = buildClient({
      paymentResolve: buildMockPayment({
        subscriptionId: null,
        sequenceType: "first",
        status: "paid",
        metadata: null,
      }),
    });
    expect(await verify(client)("id=tr_no_metadata", {})).toBeNull();
  });

  test("first-payment-paid with unknown priceId → null (priceToConfig drift)", async () => {
    const client = buildClient({
      paymentResolve: buildMockPayment({
        subscriptionId: null,
        sequenceType: "first",
        status: "paid",
        metadata: { tenantId: "tenant-test", priceId: "plan_unknown" },
      }),
    });
    expect(await verify(client)("id=tr_unknown_price", {})).toBeNull();
  });

  test("first-payment-paid for a price without interval → null, no Mollie subscription", async () => {
    const client = buildClient({
      paymentResolve: buildMockPayment({
        subscriptionId: null,
        sequenceType: "first",
        status: "paid",
        metadata: { tenantId: "tenant-test", priceId: "topup_10" },
      }),
    });
    const verifyNoInterval = verifyAndParseMollieWebhook(client, {
      priceToTier: { topup_10: "pro" },
      priceToConfig: {
        topup_10: { amountValue: "10.00", amountCurrency: "EUR", description: "Top-up" },
      },
    });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await verifyNoInterval("id=tr_topup", {})).toBeNull();
      expect(client.customerSubscriptions.create).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test("subscription without metadata.tenantId → null", async () => {
    const client = buildClient({
      subResolve: buildMockSubscription({ metadata: { priceId: "plan_pro" } }),
    });
    expect(await verify(client)("id=tr_no_tenant", {})).toBeNull();
  });

  test("priceId not in mapping → null", async () => {
    const client = buildClient({
      subResolve: buildMockSubscription({
        metadata: { tenantId: "t", priceId: "plan_unknown" },
      }),
    });
    expect(await verify(client)("id=tr_test_001", {})).toBeNull();
  });

  test("sub_xxx-direct-events are currently NOT supported (= null) — App-Builder receives them indirectly via tr_xxx-payment-events", async () => {
    const client = buildClient();
    expect(await verify(client)("id=sub_direct_evt", {})).toBeNull();
  });

  test("subscription without nextPaymentDate AND without startDate → throws (Mollie API drift)", async () => {
    const client = buildClient({
      subResolve: buildMockSubscription({ nextPaymentDate: null, startDate: null }),
    });
    await expect(verify(client)("id=tr_no_dates", {})).rejects.toThrow(
      /has neither nextPaymentDate nor startDate/,
    );
  });

  test("malformed nextPaymentDate (z.B. 'invalid') → throws (Mollie-API-Drift)", async () => {
    const client = buildClient({
      subResolve: buildMockSubscription({ nextPaymentDate: "garbage-date" }),
    });
    // Temporal.Instant.from wirft RangeError bei malformed input.
    await expect(verify(client)("id=tr_bad_date", {})).rejects.toThrow();
  });
});

describe("verifyAndParseMollieWebhook — no ambient Temporal global", () => {
  const verify = (client: MollieClientShape) =>
    verifyAndParseMollieWebhook(client, {
      priceToTier: { plan_pro: "pro" },
      priceToConfig: TEST_PRICE_CONFIG,
    });

  test("computes currentPeriodEnd without relying on globalThis.Temporal", async () => {
    const client = buildClient();
    const savedGlobal = (globalThis as { Temporal?: unknown }).Temporal;
    delete (globalThis as { Temporal?: unknown }).Temporal;
    try {
      const event = await verify(client)("id=tr_test_001", {});
      expect(event?.currentPeriodEnd).toBe("2026-06-15T00:00:00Z");
    } finally {
      if (savedGlobal === undefined) delete (globalThis as { Temporal?: unknown }).Temporal;
      else (globalThis as { Temporal?: unknown }).Temporal = savedGlobal;
    }
  });
});

// =============================================================================
// Mapping-helpers
// =============================================================================

describe("mapMollieStatus — Mollie-status → normalized", () => {
  test("active/canceled/completed", () => {
    // Mollie status strings are a typed enum; casts are used here because we
    // test the values as plain literals (analogous to how they arrive from
    // the Mollie API as `status: string` JSON).
    expect(mapMollieStatus("active" as never)).toBe(SubscriptionStatuses.active);
    expect(mapMollieStatus("canceled" as never)).toBe(SubscriptionStatuses.canceled);
    // completed = subscription is finished (all `times` charges are done) — like canceled
    expect(mapMollieStatus("completed" as never)).toBe(SubscriptionStatuses.canceled);
  });

  test("suspended → past_due (= grace period on mandate failure)", () => {
    expect(mapMollieStatus("suspended" as never)).toBe(SubscriptionStatuses.pastDue);
  });

  test("pending → incomplete (= mandate not yet confirmed)", () => {
    expect(mapMollieStatus("pending" as never)).toBe(SubscriptionStatuses.incomplete);
  });
});

describe("mapMollieEventType — heuristik", () => {
  test("subscription canceled trumps alles", () => {
    const sub = buildMockSubscription({ status: "canceled" });
    expect(mapMollieEventType(sub, null)).toBe(SubscriptionEventTypes.canceled);
  });

  test("active sub without payment context → updated (e.g. metadata change via API)", () => {
    const sub = buildMockSubscription({ status: "active" });
    expect(mapMollieEventType(sub, null)).toBe(SubscriptionEventTypes.updated);
  });

  test("pending sub without payment context → null (= nothing decided yet)", () => {
    const sub = buildMockSubscription({ status: "pending" });
    expect(mapMollieEventType(sub, null)).toBeNull();
  });
});
