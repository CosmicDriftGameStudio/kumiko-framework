import {
  createSubscriptionTierSync,
  SUBSCRIPTION_WEBHOOK_PATH,
  type TierSyncResult,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import {
  createSubscriptionStripeFeature,
  type SubscriptionStripeOptions,
} from "@cosmicdrift/kumiko-bundled-features/subscription-stripe";
import type { ExtraRouteDefinition } from "@cosmicdrift/kumiko-framework/api";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

/** Mounts `subscription-stripe` plus the webhook route that writes the
 *  subscription and syncs the tenant's tier (`tier-engine`). Needs
 *  `billing-foundation`, `tier-engine`, `config` and `secrets` in `features`.
 *  `STRIPE_API_KEY` / `STRIPE_WEBHOOK_SECRET` from the env are only the
 *  bridge fallback; the keys normally live in the secrets store.
 *
 *  @example
 *  runProdApp({ ..., billing: {
 *    stripe: { priceToTier: { [env.STRIPE_PRICE_PRO]: "pro" } },
 *    defaultTier: "free",
 *  } })
 */
export type BillingBootOption = {
  readonly stripe: {
    readonly priceToTier: Readonly<Record<string, string>>;
    /** Default `SUBSCRIPTION_WEBHOOK_PATH`; must contain `:providerName`. */
    readonly webhookPath?: string;
    readonly oneOffPriceIds?: SubscriptionStripeOptions["oneOffPriceIds"];
    readonly paymentInvoiceCreation?: boolean;
  };
  /** Tier a tenant falls back to without an active subscription. */
  readonly defaultTier: string;
  /** Valid tier names beyond `defaultTier` and the `priceToTier` targets. */
  readonly tierNames?: readonly string[];
  /** Default `"fail-webhook"`: Stripe retries, so a failed tier sync gets another attempt. */
  readonly onTierSyncError?: "log" | "fail-webhook";
  /** Runs after every webhook whose tier sync succeeded, also when the tier stayed the same (`changed: false`). */
  readonly afterSync?: (result: TierSyncResult<string>) => Promise<void>;
};

const PROVIDER_NAME_PARAM = ":providerName";

export function resolveBillingOption(
  billing: BillingBootOption,
  envSource: Record<string, string | undefined>,
): { readonly feature: FeatureDefinition; readonly route: ExtraRouteDefinition } {
  const webhookPath = billing.stripe.webhookPath ?? SUBSCRIPTION_WEBHOOK_PATH;
  if (!webhookPath.includes(PROVIDER_NAME_PARAM)) {
    throw new Error(
      `[runProdApp] billing.stripe.webhookPath "${webhookPath}" must contain ${PROVIDER_NAME_PARAM}.`,
    );
  }
  if (Object.keys(billing.stripe.priceToTier).length === 0) {
    // biome-ignore lint/suspicious/noConsole: boot-time warn, no logger configured this early
    console.warn(
      "[runProdApp] billing.stripe.priceToTier is empty: every subscription webhook is ignored until a price maps to a tier.",
    );
  }
  const apiKey = envSource["STRIPE_API_KEY"];
  const webhookSecret = envSource["STRIPE_WEBHOOK_SECRET"];
  const feature = createSubscriptionStripeFeature({
    priceToTier: billing.stripe.priceToTier,
    ...(billing.stripe.oneOffPriceIds && { oneOffPriceIds: billing.stripe.oneOffPriceIds }),
    ...(billing.stripe.paymentInvoiceCreation !== undefined && {
      paymentInvoiceCreation: billing.stripe.paymentInvoiceCreation,
    }),
    ...(apiKey && { apiKey }),
    ...(webhookSecret && { webhookSecret }),
  });
  const tierNames = new Set<string>([
    billing.defaultTier,
    ...Object.values(billing.stripe.priceToTier),
    ...(billing.tierNames ?? []),
  ]);
  const tierSync = createSubscriptionTierSync({
    isTierName: (value: string): value is string => tierNames.has(value),
    defaultTier: billing.defaultTier,
    onSyncError: billing.onTierSyncError ?? "fail-webhook",
    ...(billing.afterSync && { afterSync: billing.afterSync }),
  });
  return { feature, route: tierSync.createWebhookRoute({ path: webhookPath }) };
}
