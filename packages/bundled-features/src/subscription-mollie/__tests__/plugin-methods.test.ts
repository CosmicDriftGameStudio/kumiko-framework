// Unit tests for the Mollie plugin methods (createCheckoutSession only —
// createPortalSession/cancelSubscription are not implemented, see
// plugin-methods.ts). Mollie-SDK calls are mocked via spyOn — we test our
// sequenceType/metadata mapping, NOT Mollie itself.

import { describe, expect, spyOn, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { Client } from "mollie-api-typescript";
import { createMollieCheckoutSession, type MolliePriceConfig } from "../plugin-methods.ts";

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

// No `: Client` return-type annotation — the inferred narrow shape keeps
// spyOn(...).mockResolvedValue typed against the mock, not the full SDK.
function buildClient() {
  return {
    customers: {
      create: async () => ({ id: "cus_mock" }),
    },
    payments: {
      create: async () => ({
        id: "tr_mock",
        links: { checkout: { href: "https://www.mollie.com/checkout/mock" } },
      }),
    },
  };
}

describe("createMollieCheckoutSession", () => {
  test("mode omitted defaults to sequenceType 'first' (mandate-setup, regression safeguard for existing callers)", async () => {
    const client = buildClient();
    const createMock = spyOn(client.payments, "create").mockResolvedValue({
      id: "tr_first",
      links: { checkout: { href: "https://www.mollie.com/checkout/mock" } },
    });

    const checkout = createMollieCheckoutSession(
      client as unknown as Client,
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

    expect(result).toEqual({
      url: "https://www.mollie.com/checkout/mock",
      providerCheckoutId: "tr_first",
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentRequest: expect.objectContaining({ sequenceType: "first" }),
      }),
    );
  });

  test("only tenantId and priceId ride in the payment metadata", async () => {
    const client = buildClient();
    const createMock = spyOn(client.payments, "create").mockResolvedValue({
      id: "tr_meta",
      links: { checkout: { href: "https://www.mollie.com/checkout/mock" } },
    });
    const checkout = createMollieCheckoutSession(
      client as unknown as Client,
      PRICE_CONFIG,
      WEBHOOK_URL,
    );
    await checkout(stubCtx, {
      priceId: "plan_pro",
      tenantId: "tenant-001",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      providerCustomerId: "cus_existing",
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentRequest: expect.objectContaining({
          metadata: { tenantId: "tenant-001", priceId: "plan_pro" },
        }),
      }),
    );
  });

  test("mode='payment': sequenceType becomes 'oneoff' (one-off top-up, no Mandate-setup)", async () => {
    const client = buildClient();
    const createMock = spyOn(client.payments, "create").mockResolvedValue({
      id: "tr_topup",
      links: { checkout: { href: "https://www.mollie.com/checkout/topup" } },
    });

    const checkout = createMollieCheckoutSession(
      client as unknown as Client,
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

    expect(result).toEqual({
      url: "https://www.mollie.com/checkout/topup",
      providerCheckoutId: "tr_topup",
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentRequest: expect.objectContaining({ sequenceType: "oneoff" }),
      }),
    );
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
      client as unknown as Client,
      TOPUP_CONFIG,
      WEBHOOK_URL,
    );

    await expect(checkout(stubCtx, topupOptions)).rejects.toThrow(/no interval/);
    expect(createMock).not.toHaveBeenCalled();
  });

  test("price without interval with mode='payment' → one-off checkout works", async () => {
    const client = buildClient();
    const checkout = createMollieCheckoutSession(
      client as unknown as Client,
      TOPUP_CONFIG,
      WEBHOOK_URL,
    );

    const result = await checkout(stubCtx, { ...topupOptions, mode: "payment" });
    expect(result).toEqual({
      url: "https://www.mollie.com/checkout/mock",
      providerCheckoutId: "tr_mock",
    });
  });

  test("null checkout url: mandate hint only for first payments", async () => {
    const client = buildClient();
    spyOn(client.payments, "create").mockResolvedValue({ links: {} } as never);
    const checkout = createMollieCheckoutSession(
      client as unknown as Client,
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
