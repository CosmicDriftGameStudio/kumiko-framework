// Canonical smoke-sample: mounts every bundled-feature so framework-CI
// catches feature-coverage gaps. Real apps mount only what they use; the
// 12 bugs of Sprint 9.8 surfaced because 27 of 30 bundled-features had
// zero integration-coverage from any real app. This sample is the gate.
//
// config + user + tenant + auth-email-password get auto-prepended via
// composeFeatures(includeBundled:true) — exactly the pattern runProdApp's
// `auth: {…}` option auto-mounts. Listing them here would instantiate them
// twice, and the schema generator would then produce duplicate-table-exports.
// With AUTH_COMPOSE_OPTIONS.signup set, composeFeatures also prepends
// auth-self-registration (runtime toggle for self-signup) — #1521.
//
// M0.1 also mounts the hold-back features with minimal-stub options
// (subscription-stripe, channel-email, …). Those stubs are only for
// boot-validation — no real transport/provider call happens.

import { createAdminShellFeature } from "@cosmicdrift/kumiko-bundled-features/admin-shell";
import { createAuditFeature } from "@cosmicdrift/kumiko-bundled-features/audit";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createAuthMfaFeature } from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { authMfaUserDataFeature } from "@cosmicdrift/kumiko-bundled-features/auth-mfa-user-data";
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
import { documentIngestFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/document-ingest-foundation";
import { createFeatureTogglesFeature } from "@cosmicdrift/kumiko-bundled-features/feature-toggles";
import { fileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { fileProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-inmemory";
import { fileProviderS3Feature } from "@cosmicdrift/kumiko-bundled-features/file-provider-s3";
import { fileProviderS3EnvFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-s3-env";
import { createFilesFeature } from "@cosmicdrift/kumiko-bundled-features/files";
import { foldersFeature } from "@cosmicdrift/kumiko-bundled-features/folders";
import { foldersUserDataFeature } from "@cosmicdrift/kumiko-bundled-features/folders-user-data";
import { inboundMailFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { inboundProviderImapFeature } from "@cosmicdrift/kumiko-bundled-features/inbound-provider-imap";
import { inboundProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/inbound-provider-inmemory";
import { createJobsFeature } from "@cosmicdrift/kumiko-bundled-features/jobs";
import { ledgerFeature } from "@cosmicdrift/kumiko-bundled-features/ledger";
import { createLegalPagesFeature } from "@cosmicdrift/kumiko-bundled-features/legal-pages";
import { mailFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import { mailTransportInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory";
import { mailTransportSmtpFeature } from "@cosmicdrift/kumiko-bundled-features/mail-transport-smtp";
import { createManagedPagesFeature } from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import { createNotesHistoryFeature } from "@cosmicdrift/kumiko-bundled-features/notes-history";
import { notesHistoryUserDataFeature } from "@cosmicdrift/kumiko-bundled-features/notes-history-user-data";
import { createPersonalAccessTokensFeature } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import { createRateLimitingFeature } from "@cosmicdrift/kumiko-bundled-features/rate-limiting";
import { readinessFeature } from "@cosmicdrift/kumiko-bundled-features/readiness";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createRendererSimpleFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-simple";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createSeoFeature } from "@cosmicdrift/kumiko-bundled-features/seo";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createStepDispatcherFeature } from "@cosmicdrift/kumiko-bundled-features/step-dispatcher";
import { createSubscriptionMollieFeature } from "@cosmicdrift/kumiko-bundled-features/subscription-mollie";
import { createSubscriptionStripeFeature } from "@cosmicdrift/kumiko-bundled-features/subscription-stripe";
import { createTagsFeature } from "@cosmicdrift/kumiko-bundled-features/tags";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { templateResolverUserDataFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver-user-data";
import { createTenantLifecycleFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-lifecycle";
import { createTenantSettingsFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-settings";
import { tierEngineFeature } from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import { createUserDataRightsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { createUserDataRightsDefaultsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";
import { createUserProfileFeature } from "@cosmicdrift/kumiko-bundled-features/user-profile";
import { collectionLabelsFeature } from "./app/collection-labels-feature";

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
  // auth-mfa: composeFeatures auto-threads mfaStatusCheckerFromFeature into
  // the auto-mounted auth-email-password login handler when this feature is
  // present in appFeatures (see dev-server/src/compose-features.ts) — no
  // manual login.write.ts wiring needed here.
  createAuthMfaFeature({
    setupTokenSecret: "smoke-mfa-setup-secret-at-least-32-bytes-long!!",
    challengeTokenSecret: "smoke-mfa-challenge-secret-at-least-32-bytes-long!!",
    issuer: "Kumiko Sample",
  }),
  // Owns the `tokenVerifier` extension-point personal-access-tokens
  // registers against below — required whenever a bearer-auth provider is
  // mounted (kumiko-framework#1369).
  authFoundationFeature,
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
      notesHistory: {
        label: "Notes",
        read: ["notes-history:query:*"],
        write: ["notes-history:write:*"],
      },
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

  // inbound mail (foundation before providers)
  inboundMailFoundationFeature,
  inboundProviderInMemoryFeature,
  inboundProviderImapFeature,

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
  createTenantLifecycleFeature(),
  createCryptoShreddingFeature(),
  createDataRetentionFeature(),
  createUserDataRightsFeature(),
  createUserDataRightsDefaultsFeature(),
  createUserProfileFeature(),

  // CMS / content
  createLegalPagesFeature(),
  createTemplateResolverFeature({
    // One collection per ownership mode so the smoke app exercises both paths:
    // a shared set an admin curates, and a per-user set every agent keeps.
    collections: [
      {
        id: "reply-snippets",
        kind: "mail-html",
        access: { roles: ["TenantAdmin", "TenantMember", "SystemAdmin"] },
        // Without an explicit workspace the node lands in none of the three
        // shells and the collection is unreachable in the UI.
        nav: {
          label: "templateResolver:nav.snippets",
          workspaces: ["admin-shell:workspace:platform"],
        },
        // rich + variableSchema so the smoke app renders the WYSIWYG with
        // insertable chips, not just the plain textarea — the preview
        // substitutes these example values for `{{customerName}}` & co.
        contentFormat: "rich",
        variableSchema: {
          customerName: "Max Mustermann",
          orderId: "A-1042",
          agentName: "Alex Bruns",
        },
      },
      {
        id: "signatures",
        kind: "mail-html",
        ownership: "user",
        access: { roles: ["TenantAdmin", "TenantMember", "SystemAdmin"] },
        nav: {
          label: "templateResolver:nav.signatures",
          workspaces: ["admin-shell:workspace:platform"],
        },
        contentFormat: "rich",
      },
    ],
  }),
  // template-resolver-user-data: GDPR export/erase coverage for the
  // user-content-entry rows the `signatures` collection writes. Mandatory
  // whenever a user-owned collection is mounted — the boot guard refuses the
  // subject-carrying entity without it.
  templateResolverUserDataFeature,
  // collection-labels: the app-side nav labels for the two collections above.
  collectionLabelsFeature,
  createRendererFoundationFeature(),
  createRendererSimpleFeature(),

  // managed-pages: requires config (auto-bundled). Smoke resolver never serves
  // (boot-only). allowCustomCss:true boot-validates the CSS code path + emits
  // the branding-custom-css key into the manifest. The managed-pages-css
  // companion toggle is handler-less, has no subpath export, and is recipe-
  // covered — not standalone-mounted here (smoke = one mount per subpath-export).
  createManagedPagesFeature({ resolveApexTenant: () => null, allowCustomCss: true }),

  // seo: requires config (auto-bundled). Smoke resolver never serves (boot-
  // only) — includeLegalPages:true gives the boot-check a real source
  // without needing real page data; managedPages reuses the same never-
  // resolving smoke resolver as createManagedPagesFeature above.
  createSeoFeature({
    sitemapEntries: () => [],
    includeLegalPages: true,
    managedPages: { resolveApexTenant: () => null },
  }),

  // tenant-settings: requires config (auto-bundled).
  createTenantSettingsFeature(),

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
  // notes-history: default roles are TenantAdmin/TenantMember; same
  // SystemAdmin-operator reasoning as tags above.
  createNotesHistoryFeature({ roles: ["TenantAdmin", "TenantMember", "SystemAdmin"] }),
  // notes-history-user-data: GDPR export/erase coverage for note-entry.
  // Depends (optionally) on notes-history + (hard) on user-data-rights —
  // both mounted here.
  notesHistoryUserDataFeature,
  foldersFeature,
  // folders-user-data: GDPR hooks for folder entities. Depends (optionally)
  // on folders + (hard) on user-data-rights — both mounted above.
  foldersUserDataFeature,
  // auth-mfa-user-data: GDPR hooks for the user-mfa entity. Depends
  // (optionally) on auth-mfa + (hard) on user-data-rights — both mounted
  // above.
  authMfaUserDataFeature,
  // ledger: double-entry bookkeeping primitive (account + immutable transaction).
  ledgerFeature,
  // document-ingest-foundation: Phase-1 skeleton — documentExtract entity +
  // ocrLanguage/maxPagesPerFile config, no handlers yet (kumiko-framework#1497).
  documentIngestFoundationFeature,
] as const;

// Smoke signup — enables createAuthSelfRegistrationToggleFeature via
// composeFeatures when passed as authOptions (#1521 Option A). Same shape
// as run{Dev,Prod}App's auth.signup; appUrl is a stub (no real mail in boot).
export const AUTH_COMPOSE_OPTIONS = {
  signup: {
    appUrl: "http://localhost:4186/signup",
    tokenTtlMinutes: 60,
  },
} as const;

/** schema-check: auth-self-registration is mounted when signup is set. */
export const HAS_SIGNUP = true;
