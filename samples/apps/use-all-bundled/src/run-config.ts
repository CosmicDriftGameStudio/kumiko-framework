// Canonical smoke-sample: mounts every bundled-feature so framework-CI
// catches feature-coverage gaps. Real apps mount only what they use; the
// 12 bugs of Sprint 9.8 surfaced because 27 of 30 bundled-features had
// zero integration-coverage from any real app. This sample is the gate.
//
// config + user + tenant + auth-email-password get auto-prepended via
// composeFeatures(includeBundled:true) — exactly the pattern runProdApp's
// `auth: {…}` option auto-mounts. Listing them here would instantiate them
// twice, and the schema generator would then produce duplicate-table-exports.
//
// M0.1 also mounts the hold-back features with minimal-stub options
// (subscription-stripe, channel-email, …). Those stubs are only for
// boot-validation — no real transport/provider call happens.

import { createAdminShellFeature } from "@cosmicdrift/kumiko-bundled-features/admin-shell";
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
import { createCryptoShreddingFeature } from "@cosmicdrift/kumiko-bundled-features/crypto-shredding";
import { customFieldsFeature } from "@cosmicdrift/kumiko-bundled-features/custom-fields";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import type { NotificationRenderer } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createFeatureTogglesFeature } from "@cosmicdrift/kumiko-bundled-features/feature-toggles";
import { fileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { fileProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-inmemory";
import { fileProviderS3Feature } from "@cosmicdrift/kumiko-bundled-features/file-provider-s3";
import { fileProviderS3EnvFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-s3-env";
import { createFilesFeature } from "@cosmicdrift/kumiko-bundled-features/files";
import { foldersFeature } from "@cosmicdrift/kumiko-bundled-features/folders";
import { foldersUserDataFeature } from "@cosmicdrift/kumiko-bundled-features/folders-user-data";
import { createJobsFeature } from "@cosmicdrift/kumiko-bundled-features/jobs";
import { ledgerFeature } from "@cosmicdrift/kumiko-bundled-features/ledger";
import { createLegalPagesFeature } from "@cosmicdrift/kumiko-bundled-features/legal-pages";
import { mailFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import { mailTransportInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory";
import { mailTransportSmtpFeature } from "@cosmicdrift/kumiko-bundled-features/mail-transport-smtp";
import { createManagedPagesFeature } from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import { createPersonalAccessTokensFeature } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import { createRateLimitingFeature } from "@cosmicdrift/kumiko-bundled-features/rate-limiting";
import { readinessFeature } from "@cosmicdrift/kumiko-bundled-features/readiness";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createRendererSimpleFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-simple";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createStepDispatcherFeature } from "@cosmicdrift/kumiko-bundled-features/step-dispatcher";
import { createSubscriptionMollieFeature } from "@cosmicdrift/kumiko-bundled-features/subscription-mollie";
import { createSubscriptionStripeFeature } from "@cosmicdrift/kumiko-bundled-features/subscription-stripe";
import { createTagsFeature } from "@cosmicdrift/kumiko-bundled-features/tags";
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
  // Per-domain scopes (like cashcolt's credit/bauspar/miete): the token picks
  // WHICH API × the permission LEVEL (read vs read+write). Each domain declares
  // its read + write QN globs.
  createPersonalAccessTokensFeature({
    scopes: {
      pages: {
        label: "Pages",
        read: ["managed-pages:query:*"],
        write: ["managed-pages:write:*"],
      },
      tags: { label: "Tags", read: ["tags:query:*"], write: ["tags:write:*"] },
      ledger: { label: "Ledger", read: ["ledger:query:*"], write: ["ledger:write:*"] },
    },
  }),
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
  fileProviderS3EnvFeature,
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
  createCryptoShreddingFeature(),
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
  // the branding-custom-css key into the manifest. The managed-pages-css
  // companion toggle is handler-less, has no subpath export, and is recipe-
  // covered — not standalone-mounted here (smoke = one mount per subpath-export).
  createManagedPagesFeature({ resolveApexTenant: () => null, allowCustomCss: true }),

  // operational
  createRateLimitingFeature(),
  createAuditFeature(),
  // admin-shell: requires tenant (auto-mounted) + audit + jobs + tier-engine,
  // all mounted above.
  createAdminShellFeature(),

  // app-author-grade
  customFieldsFeature,
  // The default tag roles are TenantAdmin/TenantMember; this app's operator is a
  // global SystemAdmin (see server.ts admin), so add SystemAdmin or every tag
  // query/screen is access_denied — exactly what the constants doc warns about.
  createTagsFeature({ roles: ["TenantAdmin", "TenantMember", "SystemAdmin"] }),
  foldersFeature,
  // folders-user-data: GDPR hooks for folder entities. Depends (optionally)
  // on folders + (hard) on user-data-rights — both mounted above.
  foldersUserDataFeature,
  // ledger: double-entry bookkeeping primitive (account + immutable transaction).
  ledgerFeature,
] as const;
