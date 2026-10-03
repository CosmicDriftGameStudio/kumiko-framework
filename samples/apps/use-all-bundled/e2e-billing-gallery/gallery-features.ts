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
import { simpleRenderer } from "@cosmicdrift/kumiko-bundled-features/renderer-simple";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  GALLERY_OPERATOR_EMAIL,
  GALLERY_PLAN_PATH,
  GALLERY_PRICE_IDS,
  GALLERY_PROVIDER,
  GALLERY_TERMS_SLUG,
} from "./gallery-constants";

export const galleryMailTransport = createInMemoryTransport();

const PRICES: readonly ProviderPrice[] = [
  {
    priceId: GALLERY_PRICE_IDS.starter,
    unitAmount: 900,
    currency: "eur",
    interval: "month",
    intervalCount: 1,
    active: true,
    metadata: {},
  },
  {
    priceId: GALLERY_PRICE_IDS.pro,
    unitAmount: 1900,
    currency: "eur",
    interval: "month",
    intervalCount: 1,
    active: true,
    metadata: {},
  },
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
      tierLabelKey: (tier) => `gallery.plan.${tier}.label`,
      benefits: (tier) => [{ labelKey: `gallery.plan.${tier}.benefit` }],
      resolveCurrentTier,
      viewRoles: ["TenantAdmin", "SystemAdmin"],
      successPath: GALLERY_PLAN_PATH,
      cancelPath: GALLERY_PLAN_PATH,
      providerName: GALLERY_PROVIDER,
    },
    consumerProtection: {
      termsTextBlock: GALLERY_TERMS_SLUG,
      vatNote: { de: "Preise inkl. USt.", en: "Prices include VAT." },
      operatorEmail: GALLERY_OPERATOR_EMAIL,
      terminationScope: "platform",
      legalLinks: {
        terms: "/legal/terms",
        withdrawal: "/legal/withdrawal",
        privacy: "/legal/privacy",
      },
    },
  });
}

export function createGalleryEmailFeature(): FeatureDefinition {
  return createChannelEmailFeature({
    transport: galleryMailTransport,
    renderer: simpleRenderer,
    resolveEmail: async () => "unused@gallery.example",
  });
}

// The page URL carries the consent id so the spec can echo it on the webhook,
// exactly as a real provider echoes the checkout metadata.
const galleryProviderPlugin: SubscriptionProviderPlugin = {
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

export const galleryProviderFeature: FeatureDefinition = defineFeature(
  "gallery-mock-provider",
  (r) => {
    r.describe("E2E-only mock subscription provider for the consent/termination gallery.");
    r.requires("billing-foundation");
    r.useExtension("subscriptionProvider", GALLERY_PROVIDER, galleryProviderPlugin);
  },
);

export const galleryScreensFeature: FeatureDefinition = defineFeature("gallery-screens", (r) => {
  r.describe("E2E-only nav entry for the billing plans screen plus plan labels.");
  r.requires("billing-foundation", "admin-shell");
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
      "gallery.plan.free.label": { de: "Free", en: "Free" },
      "gallery.plan.starter.label": { de: "Starter", en: "Starter" },
      "gallery.plan.pro.label": { de: "Pro", en: "Pro" },
      "gallery.plan.starter.benefit": { de: "Für kleine Teams", en: "For small teams" },
      "gallery.plan.pro.benefit": { de: "Für wachsende Teams", en: "For growing teams" },
      "gallery.plan.free.benefit": { de: "Zum Ausprobieren", en: "To try things out" },
    },
  });
  return {};
});
