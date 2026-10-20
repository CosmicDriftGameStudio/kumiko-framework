import {
  createBillingFoundationFeature,
  type ProviderPrice,
  type SubscriptionProviderPlugin,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { defineFeature, i18nKey } from "@cosmicdrift/kumiko-framework/engine";
import { toKeyFirst } from "../translations";
import { subscriptionPlansTranslations } from "./i18n";

export const PLAN_PROVIDER = "nordlicht-mock-provider";
export const PLAN_TERMS_SLUG = "portal-terms";
const PLAN_PATH = "/billing-plans";

const PRICE_IDS = { starter: "price_portal_starter", pro: "price_portal_professional" };

const PRICES: readonly ProviderPrice[] = [
  {
    priceId: PRICE_IDS.starter,
    unitAmount: 1900,
    currency: "eur",
    interval: "month",
    intervalCount: 1,
    active: true,
    metadata: {},
  },
  {
    priceId: PRICE_IDS.pro,
    unitAmount: 4900,
    currency: "eur",
    interval: "month",
    intervalCount: 1,
    active: true,
    metadata: {},
  },
];

// The sample talks to no payment provider: prices are fixed and checkout just returns to the plans screen.
const mockProvider: SubscriptionProviderPlugin = {
  verifyAndParseWebhook: async (rawBody) => JSON.parse(rawBody),
  priceToTier: { [PRICE_IDS.starter]: "starter", [PRICE_IDS.pro]: "pro" },
  retrievePrices: async (_ctx, priceIds) => PRICES.filter((p) => priceIds.includes(p.priceId)),
  createCheckoutSession: async (_ctx, options) => ({ url: options.successUrl }),
  cancelSubscription: async () => {},
};

export function createPortalBillingFeature(baseUrl: string) {
  return createBillingFoundationFeature({
    baseUrl,
    catalog: {
      plans: ["starter", "pro"],
      tierLabelKey: (tier) => `subscription-plans:plan.${tier}.label`,
      benefits: (tier) => [
        { labelKey: `subscription-plans:plan.${tier}.benefit.units` },
        { labelKey: `subscription-plans:plan.${tier}.benefit.support` },
      ],
      resolveCurrentTier: async () => "free",
      viewRoles: ["TenantAdmin", "SystemAdmin"],
      successPath: PLAN_PATH,
      cancelPath: PLAN_PATH,
      providerName: PLAN_PROVIDER,
      contact: {
        labelKey: "subscription-plans:plan.portfolio.label",
        benefits: [{ labelKey: "subscription-plans:plan.portfolio.benefit" }],
        actionLabelKey: "subscription-plans:plan.portfolio.action",
        href: "mailto:vertrieb@nordlicht-immobilien.de",
      },
    },
    consumerProtection: {
      termsTextBlock: PLAN_TERMS_SLUG,
      vatNote: { de: "Preise inkl. USt.", en: "Prices include VAT." },
      operatorEmail: "abrechnung@nordlicht-immobilien.de",
      legalLinks: {
        de: {
          terms: "https://nordlicht-immobilien.de/agb",
          withdrawal: "https://nordlicht-immobilien.de/widerruf",
          privacy: "https://nordlicht-immobilien.de/datenschutz",
        },
        en: {
          terms: "https://nordlicht-immobilien.de/terms",
          withdrawal: "https://nordlicht-immobilien.de/withdrawal",
          privacy: "https://nordlicht-immobilien.de/privacy",
        },
      },
    },
  });
}

// Named after the screen it opens: "billing" already belongs to the invoice mails.
export const subscriptionPlansFeature = defineFeature("subscription-plans", (r) => {
  r.describe("Plan overview of the tenant admin: nav entry, plan labels and the mock provider.");
  r.requires({ features: ["billing-foundation"] });
  r.translations({ keys: toKeyFirst(subscriptionPlansTranslations) });
  r.useExtension("subscriptionProvider", PLAN_PROVIDER, mockProvider);
  r.nav({
    id: "subscription-plans",
    label: i18nKey("subscription-plans.nav.plans"),
    icon: "file",
    screen: "billing-foundation:screen:billing-plans",
    order: 50,
    access: { roles: ["TenantAdmin", "SystemAdmin"] },
  });
  return {};
});
