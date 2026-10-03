// @runtime test
//
// Gallery boot: the stock dev app with consumer protection switched on. Only
// this server mounts the billing catalog, the mock provider, the in-memory
// mail transport, the webhook/termination routes and a host-based tenant
// resolver; the shared dev app and its specs stay untouched.

import {
  createContractTerminationRoutes,
  createSubscriptionWebhookRoute,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { createDeliveryTestContext } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createTemplateResolverApi } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { seedTextBlock } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";
import { runDevApp, type SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createE2eSeedRoutes } from "@cosmicdrift/kumiko-testing/e2e/seed-route";
import { devAppOptions } from "../src/app/dev-app-options";
import { GALLERY_TENANT_HOST, GALLERY_TERMS_SLUG } from "./gallery-constants";
import {
  createGalleryBillingFeature,
  createGalleryEmailFeature,
  galleryMailTransport,
  galleryProviderFeature,
  galleryScreensFeature,
} from "./gallery-features";

const port = Number.parseInt(process.env["PORT"] ?? "4196", 10);

const BILLING_FEATURE = "billing-foundation";
const EMAIL_FEATURE = "channel-email";

const features = [
  ...devAppOptions.features.map((feature) => {
    if (feature.name === BILLING_FEATURE)
      return createGalleryBillingFeature(`http://localhost:${port}`);
    if (feature.name === EMAIL_FEATURE) return createGalleryEmailFeature();
    return feature;
  }),
  galleryProviderFeature,
  galleryScreensFeature,
];

const TERMS_TEXT: Readonly<Record<string, string>> = {
  de: "## Allgemeine Geschäftsbedingungen\n\nDiese Bedingungen gelten für alle Verträge über die Plattform.",
  en: "## Terms and conditions\n\nThese terms apply to every contract concluded through the platform.",
};

const seedTerms: SeedFn = async (stack) => {
  for (const [locale, content] of Object.entries(TERMS_TEXT)) {
    await seedTextBlock(stack.db, {
      tenantId: SYSTEM_TENANT_ID,
      slug: GALLERY_TERMS_SLUG,
      locale,
      title: "Terms",
      content,
    });
  }
};

await runDevApp({
  ...devAppOptions,
  features,
  seeds: [...(devAppOptions.seeds ?? []), seedTerms],
  // The stock dev app pins every host to the SYSTEM tenant, which would hide
  // platform mode: here only the named host resolves a tenant.
  anonymousAccess: {
    tenantResolver: (c) =>
      c.req.header("host")?.startsWith(`${GALLERY_TENANT_HOST}:`) ? SYSTEM_TENANT_ID : null,
    resolverTrust: "authoritative",
    tenantExists: async (id) => id === SYSTEM_TENANT_ID,
  },
  extraContext: (deps) => ({
    ...createDeliveryTestContext(deps),
    templateResolver: createTemplateResolverApi(deps.db),
  }),
  extraRoutes: [
    ...createE2eSeedRoutes({ mailOutbox: galleryMailTransport }),
    createSubscriptionWebhookRoute(),
    ...createContractTerminationRoutes(),
  ],
});
