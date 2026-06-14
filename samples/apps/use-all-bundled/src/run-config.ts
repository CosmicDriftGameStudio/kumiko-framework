// Canonical smoke-sample: mounts every bundled-feature so framework-CI
// catches feature-coverage gaps. Real apps mount only what they use; the
// 12 bugs of Sprint 9.8 surfaced because 27 of 30 bundled-features had
// zero integration-coverage from any real app. This sample is the gate.
//
// config + user + tenant + auth-email-password werden via
// composeFeatures(includeBundled:true) automatisch geprepended — exakt
// das Pattern, das runProdApp's `auth: {…}`-Option auto-mountet. Sie
// hier zu listen würde sie doppelt instanziieren und der drizzle-
// Schema-Generator produziert dann duplicate-table-exports.
//
// M0.1 mountet auch die hold-back features mit minimal-stub options
// (subscription-stripe, channel-email, …). Diese stubs sind nur für
// boot-validation — kein realer transport/provider-call passiert.

import { createAuditFeature } from "@cosmicdrift/kumiko-bundled-features/audit";
import { billingFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { capCounterFeature } from "@cosmicdrift/kumiko-bundled-features/cap-counter";
import {
  createChannelEmailFeature,
  type EmailTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { createChannelInAppFeature } from "@cosmicdrift/kumiko-bundled-features/channel-in-app";
import {
  createChannelPushFeature,
  type PushTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-push";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { customFieldsFeature } from "@cosmicdrift/kumiko-bundled-features/custom-fields";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import type { NotificationRenderer } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createFeatureTogglesFeature } from "@cosmicdrift/kumiko-bundled-features/feature-toggles";
import { fileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { fileProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-inmemory";
import { fileProviderS3Feature } from "@cosmicdrift/kumiko-bundled-features/file-provider-s3";
import { createFilesFeature } from "@cosmicdrift/kumiko-bundled-features/files";
import { createJobsFeature } from "@cosmicdrift/kumiko-bundled-features/jobs";
import { createLegalPagesFeature } from "@cosmicdrift/kumiko-bundled-features/legal-pages";
import { mailFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import { mailTransportInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory";
import { mailTransportSmtpFeature } from "@cosmicdrift/kumiko-bundled-features/mail-transport-smtp";
import {
  createManagedPagesCssFeature,
  createManagedPagesFeature,
} from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import { createRateLimitingFeature } from "@cosmicdrift/kumiko-bundled-features/rate-limiting";
import { readinessFeature } from "@cosmicdrift/kumiko-bundled-features/readiness";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createRendererSimpleFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-simple";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createStepDispatcherFeature } from "@cosmicdrift/kumiko-bundled-features/step-dispatcher";
import { createSubscriptionMollieFeature } from "@cosmicdrift/kumiko-bundled-features/subscription-mollie";
import { createSubscriptionStripeFeature } from "@cosmicdrift/kumiko-bundled-features/subscription-stripe";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { createTextContentFeature } from "@cosmicdrift/kumiko-bundled-features/text-content";
import { tierEngineFeature } from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import { createUserDataRightsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { createUserDataRightsDefaultsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";
import { createUserProfileFeature } from "@cosmicdrift/kumiko-bundled-features/user-profile";

// Smoke-only stubs. Boot-mode skipt jede operative Methode — diese werden
// nie aufgerufen, nur typecheck'd.
const stubEmailTransport: EmailTransport = {
  send: async () => {
    /* smoke-only */
  },
};
const stubPushTransport: PushTransport = {
  send: async () => {
    /* smoke-only */
  },
};
const stubRenderer: NotificationRenderer = {
  name: "smoke",
  render: async () => "<smoke/>",
};

export const APP_FEATURES = [
  // foundations not in the auto-mounted bundled-set
  createSecretsFeature(),
  createSessionsFeature(),
  readinessFeature,

  // delivery + channels
  createDeliveryFeature(),
  createChannelInAppFeature(),
  createChannelEmailFeature({
    transport: stubEmailTransport,
    renderer: stubRenderer,
    resolveEmail: async () => "smoke@use-all-bundled.local",
  }),
  createChannelPushFeature({
    transport: stubPushTransport,
    resolveToken: async () => "smoke-push-token",
  }),

  // mail (foundation before transport)
  mailFoundationFeature,
  mailTransportInMemoryFeature,
  mailTransportSmtpFeature,

  // files (foundation before provider)
  fileFoundationFeature,
  fileProviderInMemoryFeature,
  fileProviderS3Feature,
  createFilesFeature(),

  // billing + providers
  billingFoundationFeature,
  createSubscriptionStripeFeature({
    apiKey: "sk_test_smoke",
    webhookSecret: "whsec_smoke",
    priceToTier: { price_smoke: "free" },
  }),
  createSubscriptionMollieFeature({
    apiKey: "test_smoke_key",
    webhookUrl: "https://smoke.example/webhook",
    priceToTier: { price_smoke: "free" },
    priceToConfig: {
      price_smoke: {
        amountValue: "0.00",
        amountCurrency: "EUR",
        interval: "1 month",
        description: "Smoke",
      },
    },
  }),

  // tiering + caps
  tierEngineFeature,
  capCounterFeature,

  // feature-toggles (smoke-only runtime stub)
  // No `getRuntime`: smoke-app never dispatches set; production wires the
  // accessor after buildServer returns.
  createFeatureTogglesFeature(),

  // jobs
  createJobsFeature(),
  createStepDispatcherFeature(),

  // compliance / DSGVO
  createComplianceProfilesFeature(),
  createDataRetentionFeature(),
  createUserDataRightsFeature(),
  createUserDataRightsDefaultsFeature(),
  createUserProfileFeature(),

  // CMS / content
  createTextContentFeature(),
  createLegalPagesFeature(),
  createTemplateResolverFeature(),
  createRendererFoundationFeature(),
  createRendererSimpleFeature(),

  // managed-pages: requires config (auto-bundled). Smoke resolver never serves
  // (boot-only). allowCustomCss:true boot-validates the CSS code path + emits
  // the branding-custom-css key into the manifest. The CSS companion toggle
  // requires managed-pages → must follow it.
  createManagedPagesFeature({ resolveApexTenant: () => null, allowCustomCss: true }),
  createManagedPagesCssFeature(),

  // operational
  createRateLimitingFeature(),
  createAuditFeature(),

  // app-author-grade
  customFieldsFeature,
] as const;
