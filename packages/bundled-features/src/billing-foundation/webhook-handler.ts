// Multi-provider: the plugin is selected via the `:providerName` path-param
// (Stripe → /stripe, PayPal → /paypal), one route mounts every plugin at once.
// rawBody is intentionally NOT JSON-parsed before verify() — Stripe's
// signature check needs the exact bytes. No JWT/cookie auth: the provider's
// webhook signature in verify() IS the auth, so no c.get("user") here.

import { ExtraRouteRejection, signatureRoute } from "@cosmicdrift/kumiko-framework/api";
import type { Context } from "hono";
import {
  BILLING_FOUNDATION_FEATURE,
  BillingEventKinds,
  SUBSCRIPTION_PROVIDER_EXTENSION,
  SubscriptionFoundationHandlers,
} from "./constants";
import type { PaymentEvent, SubscriptionEvent, SubscriptionProviderPlugin } from "./types";

export type SubscriptionWebhookRouteOptions = {
  /** Route path — MUST carry the `:providerName` path-param. Default
   *  "/api/subscription/webhook/:providerName". */
  readonly path?: string;
  /** Runs after a successful dispatchSystemWrite, before the 200 response —
   *  lets callers (e.g. subscription-tier-sync) chain a side-effect without
   *  duplicating the provider-resolve/payload-mapping logic above. Returning
   *  a failed WriteResult turns the response into the same 500 a dispatch
   *  failure would produce. */
  readonly afterDispatch?: (
    dispatched: import("@cosmicdrift/kumiko-framework/engine").WriteResult,
    tenantId: import("@cosmicdrift/kumiko-framework/engine").TenantId,
    deps: import("@cosmicdrift/kumiko-framework/api").SignatureExtraRouteDeps,
  ) => Promise<import("@cosmicdrift/kumiko-framework/engine").WriteResult>;
};

const DEFAULT_WEBHOOK_PATH = "/api/subscription/webhook/:providerName";

function resolveProvider(
  registry: import("@cosmicdrift/kumiko-framework/engine").Registry,
  providerName: string,
): SubscriptionProviderPlugin | undefined {
  return registry
    .getExtensionUsages(SUBSCRIPTION_PROVIDER_EXTENSION)
    .find((u) => u.entityName === providerName)?.options as SubscriptionProviderPlugin | undefined;
}

type VerifiedWebhook = {
  readonly providerName: string;
  readonly event: SubscriptionEvent | PaymentEvent | null;
};

/**
 * Builds the `entry:"signature"` extraRoute definition. Mount via
 * `extraRoutes: [createSubscriptionWebhookRoute()]`.
 */
export function createSubscriptionWebhookRoute(options: SubscriptionWebhookRouteOptions = {}) {
  const path = options.path ?? DEFAULT_WEBHOOK_PATH;
  return signatureRoute<VerifiedWebhook>({
    method: "POST",
    path,
    entry: "signature",
    verify: async ({ rawBody, headers, params }, deps) => {
      const providerName = params["providerName"];
      if (!providerName) {
        throw new ExtraRouteRejection(
          400,
          {
            error: {
              code: "subscription_provider_path_missing",
              message: `${BILLING_FOUNDATION_FEATURE}: mount the route with a :providerName path-param so each provider has its own URL (Stripe-Dashboard → /stripe, PayPal-Dashboard → /paypal).`,
            },
          },
          "subscription webhook route mounted without :providerName",
        );
      }
      const plugin = resolveProvider(deps.registry, providerName);
      if (!plugin) {
        throw new ExtraRouteRejection(
          404,
          {
            error: {
              code: "subscription_provider_not_registered",
              message: `${BILLING_FOUNDATION_FEATURE}: provider "${providerName}" not registered as '${SUBSCRIPTION_PROVIDER_EXTENSION}'-plugin. Mount the matching subscription-${providerName} feature.`,
            },
          },
          `subscription provider "${providerName}" not registered`,
        );
      }
      // Throws on sig-mismatch — the ExtraRoute wrapper maps any non-
      // ExtraRouteRejection throw to 401 extra_route_signature_invalid
      // (= config-bug, retry won't help, provider stop).
      const event = await plugin.verifyAndParseWebhook(rawBody, headers, deps.secrets);
      return { providerName, event };
    },
    handler: async (c: Context, verified, deps) => {
      if (verified.event === null) {
        return c.json({ ignored: true }, 200);
      }
      const parsed = verified.event;
      const tenantId = parsed.tenantId as import("@cosmicdrift/kumiko-framework/engine").TenantId;
      if (parsed.kind === BillingEventKinds.payment) {
        const dispatched = await deps.dispatchSystemWrite({
          handlerQn: SubscriptionFoundationHandlers.processPaymentEvent,
          tenantId,
          payload: {
            providerEventId: parsed.providerEventId,
            providerName: parsed.providerName,
            providerCustomerId: parsed.providerCustomerId,
            priceId: parsed.priceId,
            rawPayload: parsed.rawPayload,
          },
        });
        return respondFromDispatch(
          c,
          dispatched.isSuccess && options.afterDispatch
            ? await options.afterDispatch(dispatched, tenantId, deps)
            : dispatched,
          "subscription_payment_webhook_processing_failed",
          "Internal error processing payment event",
        );
      }
      const dispatched = await deps.dispatchSystemWrite({
        handlerQn: SubscriptionFoundationHandlers.processEvent,
        tenantId,
        payload: {
          providerEventId: parsed.providerEventId,
          providerName: parsed.providerName,
          type: parsed.type,
          providerCustomerId: parsed.providerCustomerId,
          providerSubscriptionId: parsed.providerSubscriptionId,
          status: parsed.status,
          tier: parsed.tier,
          currentPeriodEndIso: parsed.currentPeriodEnd,
          rawPayload: parsed.rawPayload,
        },
      });
      return respondFromDispatch(
        c,
        dispatched.isSuccess && options.afterDispatch
          ? await options.afterDispatch(dispatched, tenantId, deps)
          : dispatched,
        "subscription_webhook_processing_failed",
        "Internal error processing subscription event",
      );
    },
  });
}

/** Shared 500/200-mapping for both dispatch branches above. Internal error →
 *  provider should retry, hence 500 instead of 401/404 (transient, not a config-bug). */
function respondFromDispatch(
  c: Context,
  dispatched: import("@cosmicdrift/kumiko-framework/engine").WriteResult,
  errorCode: string,
  errorMessage: string,
): Response {
  if (!dispatched.isSuccess) {
    return c.json(
      { error: { code: errorCode, message: errorMessage, details: dispatched.error } },
      500,
    );
  }
  return c.json({ processed: true, ...((dispatched.data as object) ?? {}) }, 200); // @cast-boundary engine-bridge
}
