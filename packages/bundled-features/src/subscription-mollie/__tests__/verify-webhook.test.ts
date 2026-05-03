// Unit-Tests für verifyAndParseMollieWebhook — Mollie's classic
// webhook-pattern (lazy-fetch, ohne sig-verify). Mollie-Client wird
// als minimal-mock-shape (`MollieFetchClient`) injiziert; Plugin-
// Verhalten ist vom konkreten Mollie-SDK entkoppelt.

import {
  SubscriptionEventTypes,
  SubscriptionStatuses,
} from "@kumiko/bundled-features/subscription-foundation";
import { describe, expect, test, vi } from "vitest";
import {
  extractMollieId,
  type MollieFetchClient,
  mapMollieEventType,
  mapMollieStatus,
  verifyAndParseMollieWebhook,
} from "../verify-webhook";

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
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock — wir nutzen nur 4 Felder
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
    /** Bestehende subs die `customerSubscriptions.list` zurückgibt (für
     *  mandate-setup-idempotency-tests). */
    listResolve?: ReturnType<typeof buildMockSubscription>[];
    /** Was `customerSubscriptions.create` zurückgibt. Default: eine
     *  neu-erstellte sub mit metadata vom payment. */
    createResolve?: ReturnType<typeof buildMockSubscription>;
  } = {},
): MollieFetchClient {
  return {
    payments: {
      get: vi.fn(async () => {
        if (overrides.paymentReject) throw overrides.paymentReject;
        return overrides.paymentResolve ?? buildMockPayment();
      }),
    },
    customerSubscriptions: {
      get: vi.fn(async () => {
        if (overrides.subReject) throw overrides.subReject;
        return overrides.subResolve ?? buildMockSubscription();
      }),
      list: vi.fn(async () => overrides.listResolve ?? []),
      create: vi.fn(
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

  test("default content-type wird als form-urlencoded behandelt (Mollie-classic)", () => {
    expect(extractMollieId("id=sub_yyy", {})).toBe("sub_yyy");
  });

  test("JSON body mit content-type", () => {
    expect(extractMollieId('{"id":"tr_zzz"}', { "content-type": "application/json" })).toBe(
      "tr_zzz",
    );
  });

  test("malformed JSON → null statt throw (defensive)", () => {
    expect(extractMollieId("not json", { "content-type": "application/json" })).toBeNull();
  });

  test("body ohne id → null", () => {
    expect(extractMollieId("foo=bar", {})).toBeNull();
  });
});

// =============================================================================
// Lazy-fetch
// =============================================================================

describe("verifyAndParseMollieWebhook — payment-event happy path", () => {
  const verify = (client: MollieFetchClient) =>
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
  const verify = (client: MollieFetchClient) =>
    verifyAndParseMollieWebhook(client, {
      priceToTier: { plan_pro: "pro" },
      priceToConfig: TEST_PRICE_CONFIG,
    });

  test("first-payment paid, subscriptionId=null → list ist leer → ensureSubscription erstellt neue Sub → Created-Event mit der neuen sub-id", async () => {
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
    expect(client.customerSubscriptions.create).toHaveBeenCalledExactlyOnceWith("cst_test_001", {
      amount: { currency: "EUR", value: "9.99" },
      interval: "1 month",
      description: "Pro-Abo monatlich",
      metadata: { tenantId: "tenant-test", priceId: "plan_pro" },
    });
  });

  test("Replay (Mollie sendet webhook nochmal) → list findet existing-active-sub für priceId → kein zweiter create", async () => {
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

  test("List hat sub für ANDEREN priceId (= App-Builder bietet Plan-Wechsel) → trotzdem create für neuen priceId", async () => {
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
    expect(client.customerSubscriptions.create).toHaveBeenCalledOnce();
  });
});

describe("verifyAndParseMollieWebhook — error + ignore paths", () => {
  const verify = (client: MollieFetchClient) =>
    verifyAndParseMollieWebhook(client, {
      priceToTier: { plan_pro: "pro" },
      priceToConfig: TEST_PRICE_CONFIG,
    });

  test("body ohne id → throws", async () => {
    const client = buildClient();
    await expect(verify(client)("not-an-id-form", {})).rejects.toThrow(/no `id` field/);
  });

  test("unbekannte ID-form (kein tr_/sub_ prefix) → null", async () => {
    const client = buildClient();
    expect(await verify(client)("id=unknown_xyz", {})).toBeNull();
  });

  test("Mollie-API rejectet payment-fetch (= garbage-id) → null (foundation 200 ignored)", async () => {
    const client = buildClient({ paymentReject: new Error("Mollie 404: not found") });
    expect(await verify(client)("id=tr_garbage", {})).toBeNull();
  });

  test("payment ohne subscriptionId UND nicht first-payment-paid → null (= one-shot, nicht unsere domain)", async () => {
    const client = buildClient({
      paymentResolve: buildMockPayment({ subscriptionId: null, sequenceType: "oneoff" }),
    });
    expect(await verify(client)("id=tr_oneshot", {})).toBeNull();
  });

  test("first-payment-paid OHNE payment.metadata → null (App-Builder hat tenantId/priceId nicht gesetzt)", async () => {
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

  test("first-payment-paid mit unbekanntem priceId → null (priceToConfig-Drift)", async () => {
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

  test("subscription ohne metadata.tenantId → null", async () => {
    const client = buildClient({
      subResolve: buildMockSubscription({ metadata: { priceId: "plan_pro" } }),
    });
    expect(await verify(client)("id=tr_no_tenant", {})).toBeNull();
  });

  test("priceId nicht im Mapping → null", async () => {
    const client = buildClient({
      subResolve: buildMockSubscription({
        metadata: { tenantId: "t", priceId: "plan_unknown" },
      }),
    });
    expect(await verify(client)("id=tr_test_001", {})).toBeNull();
  });

  test("sub_xxx-direct-events sind heute NICHT supported (= null) — App-Builder bekommt sie indirekt via tr_xxx-payment-events", async () => {
    const client = buildClient();
    expect(await verify(client)("id=sub_direct_evt", {})).toBeNull();
  });
});

// =============================================================================
// Mapping-helpers
// =============================================================================

describe("mapMollieStatus — Mollie-status → normalized", () => {
  test("active/canceled/completed", () => {
    // Mollie-status-strings sind ein typed enum, casts hier weil wir
    // die Werte als plain literals testen (analog zu wie sie aus dem
    // Mollie-API als `status: string` JSON kommen).
    expect(mapMollieStatus("active" as never)).toBe(SubscriptionStatuses.active);
    expect(mapMollieStatus("canceled" as never)).toBe(SubscriptionStatuses.canceled);
    // completed = sub ist fertig (alle times-charges durch) — wie canceled
    expect(mapMollieStatus("completed" as never)).toBe(SubscriptionStatuses.canceled);
  });

  test("suspended → past_due (= grace-period bei mandate-fail)", () => {
    expect(mapMollieStatus("suspended" as never)).toBe(SubscriptionStatuses.pastDue);
  });

  test("pending → incomplete (= mandate noch nicht confirmed)", () => {
    expect(mapMollieStatus("pending" as never)).toBe(SubscriptionStatuses.incomplete);
  });
});

describe("mapMollieEventType — heuristik", () => {
  test("subscription canceled trumps alles", () => {
    const sub = buildMockSubscription({ status: "canceled" });
    expect(mapMollieEventType(sub, null)).toBe(SubscriptionEventTypes.canceled);
  });

  test("active sub ohne payment-context → updated (z.B. metadata-change via API)", () => {
    const sub = buildMockSubscription({ status: "active" });
    expect(mapMollieEventType(sub, null)).toBe(SubscriptionEventTypes.updated);
  });

  test("pending sub ohne payment-context → null (= noch nichts entschieden)", () => {
    const sub = buildMockSubscription({ status: "pending" });
    expect(mapMollieEventType(sub, null)).toBeNull();
  });
});
