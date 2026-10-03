// Unit tests for the Mollie plugin methods (createCheckoutSession only —
// createPortalSession/cancelSubscription are not implemented, see
// plugin-methods.ts). Mollie-SDK calls are mocked via spyOn — we test our
// sequenceType/metadata mapping, NOT Mollie itself.

import { describe, expect, spyOn, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { MollieClient } from "@mollie/api-client";
import { createMollieCheckoutSession, type MolliePriceConfig } from "../plugin-methods.js";

const PRICE_CONFIG: Readonly<Record<string, MolliePriceConfig>> = {
  plan_pro: {
    amountValue: "9.99",
    amountCurrency: "EUR",
    interval: "1 month",
    description: "Pro Plan",
  },
};

const WEBHOOK_URL = "https://app.example.com/api/subscription/webhook/mollie";
const stubCtx = {} as HandlerContext;

// No `: MollieClient` return-type annotation — keeping the inferred narrow
// shape lets spyOn resolve a non-overloaded signature for `payments.create`
// (MollieClient's real signature is Promise|void-overloaded, which makes
// spyOn(...).mockResolvedValue infer `never`, see plugin-methods.ts's own
// `@cast-boundary` comment on the same overload).
function buildClient() {
  return {
    customers: {
      create: async () => ({ id: "cus_mock" }),
    },
    payments: {
      create: async () => ({ getCheckoutUrl: () => "https://www.mollie.com/checkout/mock" }),
    },
  };
}

describe("createMollieCheckoutSession", () => {
  test("mode omitted defaults to sequenceType 'first' (mandate-setup, Regression-Pin für bestehende Aufrufer)", async () => {
    const client = buildClient();
    const createMock = spyOn(client.payments, "create").mockResolvedValue({
      getCheckoutUrl: () => "https://www.mollie.com/checkout/mock",
    });

    const checkout = createMollieCheckoutSession(
      client as unknown as MollieClient,
      PRICE_CONFIG,
      WEBHOOK_URL,
    );
    const result = await checkout(stubCtx, {
      priceId: "plan_pro",
      tenantId: "tenant-001",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      providerCustomerId: "cus_existing",
    });

    expect(result).toEqual({ url: "https://www.mollie.com/checkout/mock" });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ sequenceType: "first" }));
  });

  test("consentId is sent in the payment metadata next to tenantId/priceId", async () => {
    const client = buildClient();
    const createMock = spyOn(client.payments, "create").mockResolvedValue({
      getCheckoutUrl: () => "https://www.mollie.com/checkout/mock",
    });
    const checkout = createMollieCheckoutSession(
      client as unknown as MollieClient,
      PRICE_CONFIG,
      WEBHOOK_URL,
    );
    await checkout(stubCtx, {
      priceId: "plan_pro",
      tenantId: "tenant-001",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      providerCustomerId: "cus_existing",
      consentId: "consent-1",
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { tenantId: "tenant-001", priceId: "plan_pro", consentId: "consent-1" },
      }),
    );
  });

  test("mode='payment': sequenceType wird zu 'oneoff' (One-off-Top-up, kein Mandate-setup)", async () => {
    const client = buildClient();
    const createMock = spyOn(client.payments, "create").mockResolvedValue({
      getCheckoutUrl: () => "https://www.mollie.com/checkout/topup",
    });

    const checkout = createMollieCheckoutSession(
      client as unknown as MollieClient,
      PRICE_CONFIG,
      WEBHOOK_URL,
    );
    const result = await checkout(stubCtx, {
      priceId: "plan_pro",
      tenantId: "tenant-002",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      providerCustomerId: "cus_existing",
      mode: "payment",
    });

    expect(result).toEqual({ url: "https://www.mollie.com/checkout/topup" });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ sequenceType: "oneoff" }));
  });

  const TOPUP_CONFIG: Readonly<Record<string, MolliePriceConfig>> = {
    topup_10: { amountValue: "10.00", amountCurrency: "EUR", description: "Top-up" },
  };
  const topupOptions = {
    priceId: "topup_10",
    tenantId: "tenant-003",
    successUrl: "https://example.com/success",
    cancelUrl: "https://example.com/cancel",
    providerCustomerId: "cus_existing",
  };

  test("price without interval booked as subscription → throws before any payment is created", async () => {
    const client = buildClient();
    const createMock = spyOn(client.payments, "create");
    const checkout = createMollieCheckoutSession(
      client as unknown as MollieClient,
      TOPUP_CONFIG,
      WEBHOOK_URL,
    );

    await expect(checkout(stubCtx, topupOptions)).rejects.toThrow(/no interval/);
    expect(createMock).not.toHaveBeenCalled();
  });

  test("price without interval with mode='payment' → one-off checkout works", async () => {
    const client = buildClient();
    const checkout = createMollieCheckoutSession(
      client as unknown as MollieClient,
      TOPUP_CONFIG,
      WEBHOOK_URL,
    );

    const result = await checkout(stubCtx, { ...topupOptions, mode: "payment" });
    expect(result).toEqual({ url: "https://www.mollie.com/checkout/mock" });
  });

  test("null checkout url: mandate hint only for first payments", async () => {
    const client = buildClient();
    spyOn(client.payments, "create").mockResolvedValue({ getCheckoutUrl: () => null } as never);
    const checkout = createMollieCheckoutSession(
      client as unknown as MollieClient,
      PRICE_CONFIG,
      WEBHOOK_URL,
    );
    const base = { ...topupOptions, priceId: "plan_pro" };

    await expect(checkout(stubCtx, base)).rejects.toThrow(/sequenceType=first.*mandates/);
    const oneoff = checkout(stubCtx, { ...base, mode: "payment" });
    await expect(oneoff).rejects.toThrow(/sequenceType=oneoff/);
    await expect(oneoff).rejects.not.toThrow(/mandates/);
  });
});
