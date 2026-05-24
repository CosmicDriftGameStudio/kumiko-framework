// Unit-Tests für createSubscriptionWebhookHandler. Treibt alle 5
// HTTP-Pfade durch (400/401/404/500 + 200) via Hono `app.request()` —
// ohne setupTestStack, weil der webhook-handler nur über die deps-
// injection geht und keinen DB-roundtrip braucht.

import { Hono } from "hono";
import { describe, expect, mock, test } from "bun:test";
import { SubscriptionEventTypes, SubscriptionStatuses } from "../constants";
import type { SubscriptionEvent, SubscriptionProviderPlugin } from "../types";
import { createSubscriptionWebhookHandler, type SubscriptionWebhookDeps } from "../webhook-handler";

// =============================================================================
// Test-helpers
// =============================================================================

function buildEvent(): SubscriptionEvent {
  return {
    providerEventId: "evt_test_001",
    providerName: "stripe",
    type: SubscriptionEventTypes.created,
    tenantId: "tenant-test",
    providerCustomerId: "cus_test",
    providerSubscriptionId: "sub_test",
    status: SubscriptionStatuses.active,
    tier: "pro",
    currentPeriodEnd: "2026-06-01T00:00:00Z",
    rawPayload: '{"raw":"payload"}',
  };
}

function buildPlugin(
  overrides: Partial<SubscriptionProviderPlugin> = {},
): SubscriptionProviderPlugin {
  return {
    verifyAndParseWebhook: async () => buildEvent(),
    ...overrides,
  };
}

function buildDeps(overrides: Partial<SubscriptionWebhookDeps> = {}): SubscriptionWebhookDeps {
  return {
    dispatchWrite: async () => ({ isSuccess: true, data: { duplicate: false } }),
    resolveProvider: () => buildPlugin(),
    ...overrides,
  };
}

function buildApp(deps: SubscriptionWebhookDeps) {
  const app = new Hono();
  app.post("/api/subscription/webhook/:providerName", createSubscriptionWebhookHandler(deps));
  return app;
}

async function postWebhook(app: Hono, providerName: string, body = '{"id":"evt_test"}') {
  return app.request(`/api/subscription/webhook/${providerName}`, {
    method: "POST",
    body,
    headers: { "stripe-signature": "test_sig" },
  });
}

// =============================================================================
// Happy path — 200 OK + processed
// =============================================================================

describe("webhook-handler — happy path", () => {
  test("verifyAndParseWebhook → SubscriptionEvent → dispatchWrite → 200 processed", async () => {
    const dispatchWrite = mock(async () => ({
      isSuccess: true,
      data: { duplicate: false, eventAggregateId: "evt-id" },
    }));
    const app = buildApp(buildDeps({ dispatchWrite }));

    const res = await postWebhook(app, "stripe");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { processed: boolean; duplicate: boolean };
    expect(body.processed).toBe(true);
    expect(body.duplicate).toBe(false);

    expect(dispatchWrite).toHaveBeenCalledTimes(1);
    expect(dispatchWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        handlerQn: "billing-foundation:write:process-event",
        tenantId: "tenant-test",
        payload: expect.objectContaining({
          providerEventId: "evt_test_001",
          providerName: "stripe",
          type: "subscription.created",
          tier: "pro",
        }),
      }),
    );
  });

  test("plugin returns null (= unbekannter event-type) → 200 ignored, kein dispatch", async () => {
    const dispatchWrite = mock();
    const plugin = buildPlugin({ verifyAndParseWebhook: async () => null });
    const app = buildApp(buildDeps({ dispatchWrite, resolveProvider: () => plugin }));

    const res = await postWebhook(app, "stripe");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ignored: boolean };
    expect(body.ignored).toBe(true);
    expect(dispatchWrite).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Error paths — 400/401/404/500
// =============================================================================

describe("webhook-handler — error paths", () => {
  test("provider not registered → 404 mit subscription_provider_not_registered", async () => {
    const app = buildApp(buildDeps({ resolveProvider: () => undefined }));

    const res = await postWebhook(app, "ghost");
    expect(res.status).toBe(404);
    // Drift-Pin: error-code stable damit Stripe-/Mollie-retry-Logik
    // sich auf den Code verlassen kann.
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("subscription_provider_not_registered");
    expect(body.error.message).toMatch(/ghost/);
  });

  test("plugin throws beim sig-verify → 401 mit subscription_webhook_signature_invalid", async () => {
    const plugin = buildPlugin({
      verifyAndParseWebhook: async () => {
        throw new Error("HMAC mismatch — wrong webhook secret?");
      },
    });
    const app = buildApp(buildDeps({ resolveProvider: () => plugin }));

    const res = await postWebhook(app, "stripe");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("subscription_webhook_signature_invalid");
    expect(body.error.message).toMatch(/HMAC mismatch/);
  });

  test("dispatchWrite returns isSuccess: false → 500 mit subscription_webhook_processing_failed", async () => {
    const dispatchWrite = mock(async () => ({
      isSuccess: false,
      error: { code: "internal_error", message: "DB unavailable" },
    }));
    const app = buildApp(buildDeps({ dispatchWrite }));

    const res = await postWebhook(app, "stripe");
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: { code: string; message: string; details: unknown };
    };
    expect(body.error.code).toBe("subscription_webhook_processing_failed");
    // Provider sees 500 + retries — that's the design (transient failure).
    expect(body.error.details).toMatchObject({ code: "internal_error" });
  });
});

// =============================================================================
// Mounting-Pattern
// =============================================================================

describe("webhook-handler — Mounting-Pattern", () => {
  test("Multi-Provider: zwei verschiedene URL-Pfade → unterschiedliche plugins", async () => {
    // Drift-Pin für die Multi-Provider-Architektur: stripe-Plugin hat
    // einen anderen verifyAndParseWebhook als paypal-Plugin. Wenn ein
    // Refactor den path-segment-Lookup auf etwas anderes umstellt
    // (z.B. globaler config-key wieder), würde dieser Test failen.
    const stripeCalls: string[] = [];
    const paypalCalls: string[] = [];
    const stripePlugin = buildPlugin({
      verifyAndParseWebhook: async () => {
        stripeCalls.push("called");
        return buildEvent();
      },
    });
    const paypalPlugin = buildPlugin({
      verifyAndParseWebhook: async () => {
        paypalCalls.push("called");
        return { ...buildEvent(), providerName: "paypal", providerEventId: "I-PAYPAL-001" };
      },
    });
    const app = buildApp(
      buildDeps({
        resolveProvider: (name) => {
          if (name === "stripe") return stripePlugin;
          if (name === "paypal") return paypalPlugin;
          return undefined;
        },
      }),
    );

    const stripeRes = await postWebhook(app, "stripe");
    const paypalRes = await postWebhook(app, "paypal");

    expect(stripeRes.status).toBe(200);
    expect(paypalRes.status).toBe(200);
    expect(stripeCalls).toHaveLength(1);
    expect(paypalCalls).toHaveLength(1);
  });
});
