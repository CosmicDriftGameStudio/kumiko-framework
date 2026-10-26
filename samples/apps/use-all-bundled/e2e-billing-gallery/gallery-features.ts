// @runtime test
//
// E2E-only wiring for the consent/termination review gallery: a mock billing
// provider (the only fake — real handlers, real dispatcher), the catalog and
// the nav entry that makes billing-foundation's dormant plans screen reachable.

import {
  createBillingFoundationFeature,
  type ProviderPrice,
  type SubscriptionProviderPlugin,
  SubscriptionStatuses,
  subscriptionAggregateId,
  subscriptionsProjectionTable,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import {
  createChannelEmailFeature,
  createInMemoryTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import type { ExtraRouteDefinition } from "@cosmicdrift/kumiko-framework/api";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  GALLERY_MOR_PRICE_IDS,
  GALLERY_MOR_PROVIDER,
  GALLERY_OPERATOR_EMAIL,
  GALLERY_PLAN_PATH,
  GALLERY_PRICE_IDS,
  GALLERY_PROVIDER,
  GALLERY_TERMS_SLUG,
} from "./gallery-constants";

export const galleryMailTransport = createInMemoryTransport();

// The merchant-of-record mock is only offered to tenants the spec opts in, so
// the single-provider flows keep their original screens.
const morEnabledTenants = new Set<string>();

export const GALLERY_MOR_ENABLE_PATH = "/gallery/mor/:tenantId";

export function createGalleryMorEnableRoute(): ExtraRouteDefinition {
  return {
    method: "POST",
    path: GALLERY_MOR_ENABLE_PATH,
    entry: "anonymous",
    handler: (c) => {
      morEnabledTenants.add(c.req.param("tenantId") ?? "");
      return c.body(null, 204);
    },
  };
}

function monthlyPrice(priceId: string, unitAmount: number): ProviderPrice {
  return {
    priceId,
    unitAmount,
    currency: "eur",
    interval: "month",
    intervalCount: 1,
    active: true,
    metadata: {},
  };
}

const PRICES: readonly ProviderPrice[] = [
  monthlyPrice(GALLERY_PRICE_IDS.starter, 900),
  monthlyPrice(GALLERY_PRICE_IDS.pro, 1900),
];

const MOR_PRICES: readonly ProviderPrice[] = [
  monthlyPrice(GALLERY_MOR_PRICE_IDS.starter, 990),
  monthlyPrice(GALLERY_MOR_PRICE_IDS.pro, 1990),
];

async function resolveCurrentTier(db: TenantDb, tenantId: string): Promise<string> {
  const rows = await db.selectMany(
    subscriptionsProjectionTable,
    { id: subscriptionAggregateId(tenantId) },
    { limit: 1 },
  );
  const row = rows[0];
  if (!row) return "free";
  const status = row["status"] as string;
  return status === SubscriptionStatuses.active || status === SubscriptionStatuses.trialing
    ? (row["tier"] as string)
    : "free";
}

export function createGalleryBillingFeature(baseUrl: string): FeatureDefinition {
  return createBillingFoundationFeature({
    baseUrl,
    catalog: {
      plans: ["starter", "pro"],
      tierLabelKey: (tier) => `gallery-screens:plan.${tier}.label`,
      benefits: (tier) => [{ labelKey: `gallery-screens:plan.${tier}.benefit` }],
      resolveCurrentTier,
      viewRoles: ["TenantAdmin", "SystemAdmin"],
      successPath: GALLERY_PLAN_PATH,
      cancelPath: GALLERY_PLAN_PATH,
      contact: {
        labelKey: "gallery-screens:plan.enterprise.label",
        benefits: [{ labelKey: "gallery-screens:plan.enterprise.benefit" }],
        actionLabelKey: "gallery-screens:plan.enterprise.action",
        href: "mailto:sales@gallery.example",
      },
    },
    consumerProtection: {
      termsTextBlock: GALLERY_TERMS_SLUG,
      vatNote: { de: "Preise inkl. USt.", en: "Prices include VAT." },
      providerTexts: {
        [GALLERY_PROVIDER]: {
          checkoutNote: {
            de: "Rechnung von Gallery Beispiel GmbH",
            en: "Invoiced by Gallery Beispiel GmbH",
          },
        },
        [GALLERY_MOR_PROVIDER]: {
          checkoutNote: {
            de: "Verkäufer ist Paddle · Rechnung und USt von Paddle",
            en: "Sold by Paddle · invoice and VAT from Paddle",
          },
          vatNote: {
            de: "Rechnung und Umsatzsteuer stellt Paddle als Merchant of Record.",
            en: "Paddle, as merchant of record, issues the invoice and charges the VAT.",
          },
        },
      },
      operatorEmail: GALLERY_OPERATOR_EMAIL,
      terminationScope: "platform",
      legalLinks: {
        de: { terms: "/legal/terms", withdrawal: "/legal/withdrawal", privacy: "/legal/privacy" },
        en: { terms: "/legal/terms", withdrawal: "/legal/withdrawal", privacy: "/legal/privacy" },
      },
    },
  });
}

export function createGalleryEmailFeature(): FeatureDefinition {
  return createChannelEmailFeature({
    transport: galleryMailTransport,
    resolveEmail: async () => "unused@gallery.example",
  });
}

// The page URL carries the consent id so the spec can echo it on the webhook,
// exactly as a real provider echoes the checkout metadata.
const galleryProviderPlugin: SubscriptionProviderPlugin = {
  displayName: "Stripe",
  verifyAndParseWebhook: async (rawBody) => JSON.parse(rawBody),
  priceToTier: {
    [GALLERY_PRICE_IDS.starter]: "starter",
    [GALLERY_PRICE_IDS.pro]: "pro",
  },
  retrievePrices: async (_ctx, priceIds) => PRICES.filter((p) => priceIds.includes(p.priceId)),
  createCheckoutSession: async (_ctx, options) => {
    const url = new URL(options.successUrl);
    if (options.consentId !== undefined) url.searchParams.set("consentId", options.consentId);
    return { url: url.toString() };
  },
  cancelSubscription: async () => {},
};

// Merchant-of-record stand-in: switches plans in the app with fixed figures
// (Starter to Pro: 6.67 EUR due now, 1.06 EUR of it VAT). Applying without a
// consent id fails, so a successful switch in the spec proves the consent went
// through.
const galleryMorProviderPlugin: SubscriptionProviderPlugin = {
  displayName: "Paddle",
  isBillingEnabled: async (ctx) => morEnabledTenants.has(ctx.user.tenantId),
  verifyAndParseWebhook: async (rawBody) => JSON.parse(rawBody),
  priceToTier: {
    [GALLERY_MOR_PRICE_IDS.starter]: "starter",
    [GALLERY_MOR_PRICE_IDS.pro]: "pro",
  },
  retrievePrices: async (_ctx, priceIds) => MOR_PRICES.filter((p) => priceIds.includes(p.priceId)),
  createCheckoutSession: async (_ctx, options) => {
    const url = new URL(options.successUrl);
    url.searchParams.set("provider", "mor");
    if (options.consentId !== undefined) url.searchParams.set("consentId", options.consentId);
    return { url: url.toString() };
  },
  cancelSubscription: async () => {},
  previewPlanSwitch: async () => ({
    amountDueNow: 667,
    tax: 106,
    currency: "eur",
    credit: 333,
    effectiveAt: "2027-01-15T00:00:00Z",
  }),
  applyPlanSwitch: async (_ctx, options) => {
    if (options.consentId === undefined) {
      throw new Error("gallery MoR mock: plan switch applied without a consent id");
    }
  },
};

export const galleryProviderFeature: FeatureDefinition = defineFeature(
  "gallery-mock-provider",
  (r) => {
    r.describe("E2E-only mock subscription provider for the consent/termination gallery.");
    r.requires({ features: ["billing-foundation"] });
    r.useExtension("subscriptionProvider", GALLERY_PROVIDER, galleryProviderPlugin);
    r.useExtension("subscriptionProvider", GALLERY_MOR_PROVIDER, galleryMorProviderPlugin);
  },
);

export const galleryScreensFeature: FeatureDefinition = defineFeature("gallery-screens", (r) => {
  r.describe("E2E-only nav entry for the billing plans screen plus plan labels.");
  r.requires({ features: ["billing-foundation", "admin-shell"] });
  r.nav({
    id: "billing",
    label: "gallery:nav.billing",
    icon: "file",
    screen: "billing-foundation:screen:billing-plans",
    order: 20,
    access: { roles: ["TenantAdmin", "SystemAdmin"] },
    workspaces: ["admin-shell:workspace:tenant-admin"],
  });
  r.translations({
    keys: {
      "gallery:nav.billing": { de: "Abrechnung", en: "Billing" },
      "gallery-screens:plan.free.label": { de: "Free", en: "Free" },
      "gallery-screens:plan.starter.label": { de: "Starter", en: "Starter" },
      "gallery-screens:plan.pro.label": { de: "Pro", en: "Pro" },
      "gallery-screens:plan.enterprise.label": { de: "Enterprise", en: "Enterprise" },
      "gallery-screens:plan.enterprise.benefit": {
        de: "Individuelle Konditionen und persönlicher Ansprechpartner",
        en: "Custom terms and a dedicated contact",
      },
      "gallery-screens:plan.enterprise.action": { de: "Kontakt aufnehmen", en: "Contact us" },
      "gallery-screens:plan.starter.benefit": { de: "Für kleine Teams", en: "For small teams" },
      "gallery-screens:plan.pro.benefit": { de: "Für wachsende Teams", en: "For growing teams" },
      "gallery-screens:plan.free.benefit": { de: "Zum Ausprobieren", en: "To try things out" },
    },
  });
  return {};
});
