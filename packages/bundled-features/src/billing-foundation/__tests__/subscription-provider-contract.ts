import { describe, expect, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { SubscriptionProviderPlugin } from "../types";

export type SubscriptionProviderContractFixture = {
  readonly plugin: SubscriptionProviderPlugin;
  readonly ctx: HandlerContext;
  readonly checkout: Parameters<
    NonNullable<SubscriptionProviderPlugin["createCheckoutSession"]>
  >[1];
  // Providers without a customer-portal (e.g. Mollie) omit this — the
  // portal-test then skips, mirroring `createPortalSession` being optional.
  readonly portal?: Parameters<NonNullable<SubscriptionProviderPlugin["createPortalSession"]>>[1];
  readonly cancelSubscriptionId?: string;
  // A real, provider-signed/verifiable webhook payload for the happy path.
  // Providers without a fixture skip the webhook-parsing test — building one
  // needs provider-specific signing (Stripe HMAC) or a mocked API client
  // (Mollie lazy-fetch), which the provider's own verify-webhook.test.ts
  // already assembles.
  readonly webhook?: {
    readonly rawBody: string;
    readonly headers: Record<string, string>;
    readonly expectedTenantId: string;
    readonly expectedTier: string;
  };
};

export type SubscriptionProviderContractOptions = {
  // Providers without portal/cancel support (e.g. Mollie) must say so
  // explicitly — a bare `if (!plugin.x) return` inside the test body makes
  // the skip invisible in test output (a coverage illusion: Stripe's
  // portal/cancel tests and Mollie's "skip" both show as green) (#1339).
  readonly hasPortal: boolean;
  readonly hasCancel: boolean;
};

export function describeSubscriptionProviderContract(
  name: string,
  factory: () => SubscriptionProviderContractFixture | Promise<SubscriptionProviderContractFixture>,
  options: SubscriptionProviderContractOptions,
): void {
  describe(`${name} — SubscriptionProviderPlugin contract`, () => {
    test("implements verifyAndParseWebhook", async () => {
      const { plugin } = await factory();
      expect(typeof plugin.verifyAndParseWebhook).toBe("function");
    });

    test("verifyAndParseWebhook parses a valid provider event into a SubscriptionEvent", async () => {
      const { plugin, webhook } = await factory();
      if (!webhook) return;
      const event = await plugin.verifyAndParseWebhook(webhook.rawBody, webhook.headers);
      expect(event).not.toBeNull();
      expect(event?.tenantId).toBe(webhook.expectedTenantId);
      expect(event?.tier).toBe(webhook.expectedTier);
    });

    test("createCheckoutSession returns a hosted-page url", async () => {
      const { plugin, ctx, checkout } = await factory();
      if (!plugin.createCheckoutSession) return;
      const result = await plugin.createCheckoutSession(ctx, checkout);
      expect(typeof result.url).toBe("string");
      expect(result.url.length).toBeGreaterThan(0);
    });

    (options.hasPortal ? test : test.skip)(
      "createPortalSession returns a hosted-page url",
      async () => {
        const { plugin, ctx, portal } = await factory();
        if (!plugin.createPortalSession || !portal) {
          throw new Error(
            "describeSubscriptionProviderContract: hasPortal:true but the fixture has no createPortalSession/portal",
          );
        }
        const result = await plugin.createPortalSession(ctx, portal);
        expect(typeof result.url).toBe("string");
        expect(result.url.length).toBeGreaterThan(0);
      },
    );

    (options.hasCancel ? test : test.skip)(
      "cancelSubscription resolves without throwing",
      async () => {
        const { plugin, ctx, cancelSubscriptionId } = await factory();
        if (!plugin.cancelSubscription || !cancelSubscriptionId) {
          throw new Error(
            "describeSubscriptionProviderContract: hasCancel:true but the fixture has no cancelSubscription/cancelSubscriptionId",
          );
        }
        await expect(plugin.cancelSubscription(ctx, cancelSubscriptionId)).resolves.toBeUndefined();
      },
    );
  });
}
