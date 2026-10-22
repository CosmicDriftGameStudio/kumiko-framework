import {
  createSubscriptionTierSync,
  SUBSCRIPTION_WEBHOOK_PATH,
  type TierSyncResult,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import {
  createSubscriptionDodoFeature,
  type SubscriptionDodoOptions,
} from "@cosmicdrift/kumiko-bundled-features/subscription-dodo";
import {
  createSubscriptionStripeFeature,
  type SubscriptionStripeOptions,
} from "@cosmicdrift/kumiko-bundled-features/subscription-stripe";
import type { ExtraRouteDefinition } from "@cosmicdrift/kumiko-framework/api";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

/** Mounts `subscription-stripe` and/or `subscription-dodo` plus one webhook
 *  route that writes the subscription and syncs the tenant's tier
 *  (`tier-engine`). Needs `billing-foundation`, `tier-engine`, `config` and
 *  `secrets` in `features`. The env keys (`STRIPE_API_KEY` /
 *  `STRIPE_WEBHOOK_SECRET`, `DODO_PAYMENTS_API_KEY` /
 *  `DODO_PAYMENTS_WEBHOOK_KEY`) are only the bridge fallback; the keys
 *  normally live in the secrets store.
 *
 *  @example
 *  runProdApp({ ..., billing: {
 *    stripe: { priceToTier: { [env.STRIPE_PRICE_PRO]: "pro" } },
 *    dodo: { priceToTier: { [env.DODO_PRODUCT_PRO]: "pro" } },
 *    defaultTier: "free",
 *  } })
 */
export type BillingBootOption = {
  /** At least one of `stripe` and `dodo` is required. */
  readonly stripe?: {
    readonly priceToTier: Readonly<Record<string, string>>;
    /** Default `SUBSCRIPTION_WEBHOOK_PATH`; must contain `:providerName`. Applies to every provider. */
    readonly webhookPath?: string;
    readonly oneOffPriceIds?: SubscriptionStripeOptions["oneOffPriceIds"];
    readonly paymentInvoiceCreation?: boolean;
  };
  readonly dodo?: {
    readonly priceToTier: Readonly<Record<string, string>>;
    readonly oneOffPriceIds?: SubscriptionDodoOptions["oneOffPriceIds"];
  };
  /** Tier a tenant falls back to without an active subscription. */
  readonly defaultTier: string;
  /** Valid tier names beyond `defaultTier` and the `priceToTier` targets. */
  readonly tierNames?: readonly string[];
  /** Default `"fail-webhook"`: the provider retries, so a failed tier sync gets another attempt. */
  readonly onTierSyncError?: "log" | "fail-webhook";
  /** Runs after every webhook whose tier sync succeeded, also when the tier stayed the same (`changed: false`). */
  readonly afterSync?: (result: TierSyncResult<string>) => Promise<void>;
};

const PROVIDER_NAME_PARAM = ":providerName";

function warnOnEmptyPriceMap(
  provider: "stripe" | "dodo",
  priceToTier: Readonly<Record<string, string>>,
) {
  if (Object.keys(priceToTier).length === 0) {
    // biome-ignore lint/suspicious/noConsole: boot-time warn, no logger configured this early
    console.warn(
      `[runProdApp] billing.${provider}.priceToTier is empty: every subscription webhook is ignored until a price maps to a tier.`,
    );
  }
}

function bridgeCredentials(
  envSource: Record<string, string | undefined>,
  apiKeyName: string,
  webhookSecretName: string,
) {
  const apiKey = envSource[apiKeyName];
  const webhookSecret = envSource[webhookSecretName];
  return { ...(apiKey && { apiKey }), ...(webhookSecret && { webhookSecret }) };
}

function providerFeatures(
  { stripe, dodo }: BillingBootOption,
  envSource: Record<string, string | undefined>,
): FeatureDefinition[] {
  const features: FeatureDefinition[] = [];
  if (stripe) {
    warnOnEmptyPriceMap("stripe", stripe.priceToTier);
    features.push(
      createSubscriptionStripeFeature({
        priceToTier: stripe.priceToTier,
        ...(stripe.oneOffPriceIds && { oneOffPriceIds: stripe.oneOffPriceIds }),
        ...(stripe.paymentInvoiceCreation !== undefined && {
          paymentInvoiceCreation: stripe.paymentInvoiceCreation,
        }),
        ...bridgeCredentials(envSource, "STRIPE_API_KEY", "STRIPE_WEBHOOK_SECRET"),
      }),
    );
  }
  if (dodo) {
    warnOnEmptyPriceMap("dodo", dodo.priceToTier);
    features.push(
      createSubscriptionDodoFeature({
        priceToTier: dodo.priceToTier,
        ...(dodo.oneOffPriceIds && { oneOffPriceIds: dodo.oneOffPriceIds }),
        ...bridgeCredentials(envSource, "DODO_PAYMENTS_API_KEY", "DODO_PAYMENTS_WEBHOOK_KEY"),
      }),
    );
  }
  return features;
}

export function resolveBillingOption(
  billing: BillingBootOption,
  envSource: Record<string, string | undefined>,
): { readonly features: readonly FeatureDefinition[]; readonly route: ExtraRouteDefinition } {
  const { stripe, dodo } = billing;
  if (!stripe && !dodo) {
    throw new Error(
      "[runProdApp] billing needs at least one provider: set billing.stripe or billing.dodo.",
    );
  }
  const webhookPath = stripe?.webhookPath ?? SUBSCRIPTION_WEBHOOK_PATH;
  if (!webhookPath.includes(PROVIDER_NAME_PARAM)) {
    throw new Error(
      `[runProdApp] billing.stripe.webhookPath "${webhookPath}" must contain ${PROVIDER_NAME_PARAM}.`,
    );
  }

  const features = providerFeatures(billing, envSource);

  const tierNames = new Set<string>([
    billing.defaultTier,
    ...Object.values(stripe?.priceToTier ?? {}),
    ...Object.values(dodo?.priceToTier ?? {}),
    ...(billing.tierNames ?? []),
  ]);
  const tierSync = createSubscriptionTierSync({
    isTierName: (value: string): value is string => tierNames.has(value),
    defaultTier: billing.defaultTier,
    onSyncError: billing.onTierSyncError ?? "fail-webhook",
    ...(billing.afterSync && { afterSync: billing.afterSync }),
  });
  return { features, route: tierSync.createWebhookRoute({ path: webhookPath }) };
}
