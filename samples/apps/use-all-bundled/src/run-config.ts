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

import { createAccountSecurityFeature } from "@cosmicdrift/kumiko-bundled-features/account-security";
import { createAdminShellFeature } from "@cosmicdrift/kumiko-bundled-features/admin-shell";
import { createAgentToolsFeature } from "@cosmicdrift/kumiko-bundled-features/agent-tools";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createAuthMfaFeature } from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { createAuthMfaUserDataFeature } from "@cosmicdrift/kumiko-bundled-features/auth-mfa-user-data";
import { createBillingFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { createCapCounterFeature } from "@cosmicdrift/kumiko-bundled-features/cap-counter";
import { createCapOverviewFeature } from "@cosmicdrift/kumiko-bundled-features/cap-overview";
import { createChannelDiscordFeature } from "@cosmicdrift/kumiko-bundled-features/channel-discord";
import {
  createChannelEmailFeature,
  type EmailTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { createChannelInAppFeature } from "@cosmicdrift/kumiko-bundled-features/channel-in-app";
import {
  createChannelPushFeature,
  type PushTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-push";
import { createChannelSlackFeature } from "@cosmicdrift/kumiko-bundled-features/channel-slack";
import { createChannelTeamsFeature } from "@cosmicdrift/kumiko-bundled-features/channel-teams";
import { createChannelTelegramFeature } from "@cosmicdrift/kumiko-bundled-features/channel-telegram";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createComplianceProfilesOpsFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles-ops";
import { createCustomFieldsFeature } from "@cosmicdrift/kumiko-bundled-features/custom-fields";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createDerivativesSharpFeature } from "@cosmicdrift/kumiko-bundled-features/derivatives-sharp";
import { createDocumentIngestFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/document-ingest-foundation";
import {
  createFeatureTogglesFeature,
  FEATURE_TOGGLES_FEATURE,
} from "@cosmicdrift/kumiko-bundled-features/feature-toggles";
import { createFileDerivativesFeature } from "@cosmicdrift/kumiko-bundled-features/file-derivatives";
import { createFilesTenantDataFeature } from "@cosmicdrift/kumiko-bundled-features/files-tenant-data";
import { createFoldersFeature } from "@cosmicdrift/kumiko-bundled-features/folders";
import { createFoldersUserDataFeature } from "@cosmicdrift/kumiko-bundled-features/folders-user-data";
import { createFormDraftFeature } from "@cosmicdrift/kumiko-bundled-features/form-draft";
import { createFormDraftUserDataFeature } from "@cosmicdrift/kumiko-bundled-features/form-draft-user-data";
import { createHostRoutingFeature } from "@cosmicdrift/kumiko-bundled-features/host-routing";
import { createInboundMailFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { createInboundProviderImapFeature } from "@cosmicdrift/kumiko-bundled-features/inbound-provider-imap";
import { createInboundProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/inbound-provider-inmemory";
import { createJobsFeature } from "@cosmicdrift/kumiko-bundled-features/jobs";
import { createLedgerFeature } from "@cosmicdrift/kumiko-bundled-features/ledger";
import { createLegalPagesFeature } from "@cosmicdrift/kumiko-bundled-features/legal-pages";
import { createManagedPagesFeature } from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import {
  createMetricsFeature,
  createSystemMetricsFeature,
  DEFAULT_METRICS,
} from "@cosmicdrift/kumiko-bundled-features/metrics";
import { createNotesHistoryFeature } from "@cosmicdrift/kumiko-bundled-features/notes-history";
import { createNotesHistoryUserDataFeature } from "@cosmicdrift/kumiko-bundled-features/notes-history-user-data";
import { createPersonalAccessTokensFeature } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import { createReadinessFeature } from "@cosmicdrift/kumiko-bundled-features/readiness";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createRendererPdfFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-pdf";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createSeoFeature } from "@cosmicdrift/kumiko-bundled-features/seo";
import { createStepDispatcherFeature } from "@cosmicdrift/kumiko-bundled-features/step-dispatcher";
import { createSubscriptionDodoFeature } from "@cosmicdrift/kumiko-bundled-features/subscription-dodo";
import { createSubscriptionMollieFeature } from "@cosmicdrift/kumiko-bundled-features/subscription-mollie";
import { createSubscriptionStripeFeature } from "@cosmicdrift/kumiko-bundled-features/subscription-stripe";
import { createTagsFeature } from "@cosmicdrift/kumiko-bundled-features/tags";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { createTemplateResolverUserDataFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver-user-data";
import { createTenantHandoverFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-handover";
import { createTenantLifecycleFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-lifecycle";
import { createTenantSettingsFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-settings";
import { createTierEngineFeature } from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import { createUserDataRightsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { createUserDataRightsDefaultsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";
import { createUserProfileFeature } from "@cosmicdrift/kumiko-bundled-features/user-profile";
import { createWaitlistFeature } from "@cosmicdrift/kumiko-bundled-features/waitlist";
import { createWorkflowRunnerFeature } from "@cosmicdrift/kumiko-bundled-features/workflow-runner";
import {
  composeFileStack,
  composeMailStack,
  composeSecurityStack,
} from "@cosmicdrift/kumiko-dev-server/compose-stacks";
import { createDocumentDesignerFeature } from "@cosmicdrift/kumiko-document-designer";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { createRendererPuppeteerClientFeature } from "@cosmicdrift/kumiko-renderer-puppeteer-client";
import { ADMIN_NAV_QN, ADMIN_NAV_WORKSPACES, adminNavFeature } from "./app/admin-nav-feature";
import { DEV_TENANT_ID } from "./app/auth-constants";
import { CAP_OVERVIEW_CAPS } from "./app/cap-overview-caps";
import { capOverviewLabelsFeature } from "./app/cap-overview-labels-feature";
import { collectionLabelsFeature } from "./app/collection-labels-feature";
import { patScopeLabelsFeature } from "./app/pat-scope-labels-feature";

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

// Fixed dev-only signing key for the reset/verify/unlock magic-links (and,
// below, tenant-handover's row-bound grant). The factory rejects anything
// under 32 chars, and this sample never runs outside `bun dev` / CI boot —
// no token minted here is ever trusted by a deployment.
const SMOKE_HMAC_SECRET = "use-all-bundled-smoke-hmac-key-0123456789";

export const APP_FEATURES = [
  localeDe(),
  // foundations not in the auto-mounted bundled-set
  createSecretsFeature(),
  ...composeSecurityStack(),
  // auth-mfa: composeFeatures auto-threads mfaStatusCheckerFromFeature into
  // the auto-mounted auth-email-password login handler when this feature is
  // present in appFeatures (see dev-server/src/compose-features.ts) — no
  // manual login.write.ts wiring needed here.
  createAuthMfaFeature({
    setupTokenSecret: "smoke-mfa-setup-secret-at-least-32-bytes-long!!",
    challengeTokenSecret: "smoke-mfa-challenge-secret-at-least-32-bytes-long!!",
    issuer: "Kumiko Sample",
  }),
  // Self-service MFA + own sessions on one screen, in the sidebar.
  createAccountSecurityFeature({ nav: {} }),
  // Owns the `tokenVerifier` extension-point personal-access-tokens
  // registers against below — required whenever a bearer-auth provider is
  // mounted (kumiko-framework#1369).
  createAuthFoundationFeature(),
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
  patScopeLabelsFeature,
  adminNavFeature,
  createReadinessFeature({ nav: { parent: ADMIN_NAV_QN, workspaces: ADMIN_NAV_WORKSPACES } }),

  // delivery + channels
  createDeliveryFeature(),
  createChannelInAppFeature(),
  createChannelEmailFeature({
    transport: stubEmailTransport,
    resolveEmail: async () => "smoke@use-all-bundled.local",
  }),
  createChannelPushFeature({
    transport: stubPushTransport,
    resolveToken: async () => "smoke-push-token",
  }),
  // Chat channels are route-only and read their webhook URL / bot token from the
  // tenant's secrets at send time, so the smoke app needs no credentials here.
  createChannelSlackFeature(),
  createChannelDiscordFeature(),
  createChannelTeamsFeature(),
  createChannelTelegramFeature(),

  ...composeMailStack({ transports: ["inmemory", "smtp"] }),

  // inbound mail (foundation before providers)
  createInboundMailFoundationFeature(),
  createInboundProviderInMemoryFeature(),
  createInboundProviderImapFeature(),

  ...composeFileStack({ providers: ["inmemory", "s3", "s3-env"] }),
  // resolveApexTenant is what registers the `public-variant` query and the
  // anonymous /media route — the option-less export leaves both out and hides
  // them from `kumiko agent lint` (#2643). No entityType in this sample
  // registers a derivativePublicPredicate, so the route answers 404 for
  // every request; it exists here for handler coverage, not for serving.
  // Do NOT copy this resolver: ignoring the host is what makes it harmless in
  // a single-tenant smoke sample and a cross-tenant leak in a real app, where
  // the host is the ONLY thing that may decide which tenant's bytes go out.
  createFileDerivativesFeature({ resolveApexTenant: () => DEV_TENANT_ID as TenantId }),
  createDerivativesSharpFeature(),

  // billing + providers
  createBillingFoundationFeature(),
  createSubscriptionStripeFeature({
    apiKey: "sk_test_smoke",
    webhookSecret: "whsec_smoke",
    priceToTier: { price_smoke: "free" },
  }),
  createSubscriptionDodoFeature({
    apiKey: "dodo_smoke",
    webhookSecret: "whsec_smoke",
    priceToTier: { pdt_smoke: "free" },
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
  createTierEngineFeature(),
  createCapCounterFeature(),
  // cap-overview: read-only tier/usage visibility. Caps are example
  // entities this sample already mounts (notes-history, tags,
  // tenant-membership) — see cap-overview-caps.ts. Requires tenant
  // (auto-mounted) + tier-engine + billing-foundation, all mounted above.
  // `tiers` mirrors the keys cap-overview-caps.ts's per-tier limit maps use
  // — without it the tenant-cap-list tier facet doesn't render at all (see
  // screens.ts). `listCaps` is explicit here rather than relying on
  // feature.ts's default (first 3 caps) — the default is a slice, not
  // "all", so it would silently drop caps again the moment a fourth one
  // gets added to CAP_OVERVIEW_CAPS.
  createCapOverviewFeature({
    caps: CAP_OVERVIEW_CAPS,
    tiers: ["free", "pro"],
    listCaps: CAP_OVERVIEW_CAPS.map((cap) => cap.id),
  }),
  capOverviewLabelsFeature,

  // metrics: dashboard queries for the default metrics; tenant scope reads
  // the caller's tenant, metrics-system aggregates platform-wide.
  createMetricsFeature({ metrics: DEFAULT_METRICS }),
  createSystemMetricsFeature({ metrics: DEFAULT_METRICS }),

  // feature-toggles (smoke-only runtime stub)
  // No `getRuntime`: smoke-app never dispatches set; production wires the
  // accessor after buildServer returns.
  createFeatureTogglesFeature(),

  // jobs
  createJobsFeature(),
  createStepDispatcherFeature(),
  // workflow-runner: no entities/MSPs/handlers of its own — reserves the
  // manifest slot and provides startAndRunWorkflow/registerEventTrigger for
  // consumer features to wire up defineWorkflow-based workflows.
  createWorkflowRunnerFeature(),

  // compliance / DSGVO
  createComplianceProfilesFeature(),
  createComplianceProfilesOpsFeature(),
  createTenantLifecycleFeature(),
  // tenant-handover: try-before-signup ownership handover (kumiko-
  // framework#3035). No entities/mount-options of its own — it reads
  // OTHER entities' `transferable`/`parentRef` declarations off the
  // registry at claim time. This sample mounts no transferable entity, so
  // the `claim` handler always rejects with entity_not_transferable — the
  // same boot-only, never-actually-used-for-real-data posture as the
  // managed-pages/seo smoke resolvers above. grantSecret reuses the same
  // dev-only HMAC key the auth magic-links below use.
  createTenantHandoverFeature({ grantSecret: SMOKE_HMAC_SECRET }),
  // Path mode keeps the dev host (localhost) free of a host-based resolver:
  // anonymous calls still default to SYSTEM_TENANT, a client-named tenant
  // must be enabled and active.
  createHostRoutingFeature({
    tenantBy: "path",
    tenantPathPrefix: "/t",
    baseDomain: "localhost",
    apex: { file: "index.html" },
    tenant: { file: "index.html" },
  }),
  createDataRetentionFeature(),
  createUserDataRightsFeature(),
  createUserDataRightsDefaultsFeature(),
  createUserProfileFeature(),

  // CMS / content
  createLegalPagesFeature(),
  createWaitlistFeature(),
  createTemplateResolverFeature({
    // One collection per ownership mode so the smoke app exercises both paths:
    // a shared set an admin curates, and a per-user set every agent keeps.
    collections: [
      {
        id: "reply-snippets",
        kind: "snippet",
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
        kind: "snippet",
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
  createTemplateResolverUserDataFeature(),
  // collection-labels: the app-side nav labels for the two collections above.
  collectionLabelsFeature,
  createRendererFoundationFeature(),
  createRendererPdfFeature(),
  // PDF printing for document templates; the print service is reached through
  // PUPPETEER_SERVICE_URL + PUPPETEER_AUTH_TOKEN and only asked when a PDF is generated.
  createRendererPuppeteerClientFeature(),

  // managed-pages: requires config (auto-bundled). Smoke resolver never serves
  // (boot-only). allowCustomCss:true boot-validates the CSS code path + emits
  // the branding-custom-css key into the manifest. The managed-pages-css
  // companion toggle is handler-less, has no subpath export, and is recipe-
  // covered — not standalone-mounted here (smoke = one mount per subpath-export).
  createManagedPagesFeature({ resolveApexTenant: () => null, allowCustomCss: true }),

  // Template overview, layout editor and PDF template editor; needs template-resolver and managed-pages above.
  createDocumentDesignerFeature(),

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
  // admin-shell: requires tenant (auto-mounted) + audit + jobs + tier-engine,
  // all mounted above. includeCapOverview:true exercises the my-caps /
  // tenant-caps nav entries end-to-end — cap-overview is mounted below.
  createAdminShellFeature({ includeCapOverview: true, includeDocumentDesigner: true }),

  // app-author-grade
  createCustomFieldsFeature(),
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
  createNotesHistoryUserDataFeature(),
  createFormDraftFeature(),
  // form-draft-user-data: GDPR export/erase coverage for the form-draft
  // entity. Depends (optionally) on form-draft + (hard) on
  // user-data-rights — both mounted here.
  createFormDraftUserDataFeature(),
  createFoldersFeature(),
  // folders-user-data: GDPR hooks for folder entities. Depends (optionally)
  // on folders + (hard) on user-data-rights — both mounted above.
  createFoldersUserDataFeature(),
  // auth-mfa-user-data: GDPR hooks for the user-mfa entity. Depends
  // (optionally) on auth-mfa + (hard) on user-data-rights — both mounted
  // above.
  createAuthMfaUserDataFeature(),
  // files-tenant-data: tenant-destroy row purge + storage-prefix binary wipe
  // for fileRef, plus the orphaned-derivative backfill/GC job (#2474).
  // Depends (optionally) on files + (hard) on tenant-lifecycle — both
  // mounted above.
  createFilesTenantDataFeature(),
  // ledger: double-entry bookkeeping primitive (account + immutable transaction).
  createLedgerFeature(),
  // document-ingest-foundation: Phase-1 skeleton — documentExtract entity +
  // ocrLanguage/maxPagesPerFile config, no handlers yet (kumiko-framework#1497).
  createDocumentIngestFoundationFeature(),
  createAgentToolsFeature(),
] as const;

// runProdApp / runDevApp mount feature-toggles themselves with `featureToggles: true`
// and reject a second copy in `features`; APP_FEATURES keeps it for schema and coverage tooling.
export const BOOT_FEATURES = APP_FEATURES.filter(
  (feature) => feature.name !== FEATURE_TOGGLES_FEATURE,
);

// locale-de is mounted, so every translation key must exist in German and English.
export const VALIDATE_BOOT_OPTIONS = { requiredLocales: ["de", "en"] } as const;

// Smoke signup — enables createAuthSelfRegistrationToggleFeature via
// composeFeatures when passed as authOptions (#1521 Option A). Same shape
// as run{Dev,Prod}App's auth.signup; appUrl is a stub (no real mail in boot).
export const AUTH_COMPOSE_OPTIONS = {
  signup: {
    appUrl: "http://localhost:4186/signup",
    tokenTtlMinutes: 60,
  },
  // Registers the invite-create write handler (dev-server RunDevAppAuthOptions
  // .invite) so the seed can dispatch real invitations — appUrl is a stub, same
  // as signup's above (no real mail in boot).
  invite: {
    appUrl: "http://localhost:4186/invite/accept",
    tokenTtlMinutes: 60,
  },
  // reset/verify/unlock register their handlers only when their option object
  // is present, so leaving them out hid six handlers from `kumiko agent lint`
  // (#2643). appUrl is a stub like signup's; no real mail leaves boot.
  passwordReset: {
    hmacSecret: SMOKE_HMAC_SECRET,
    appUrl: "http://localhost:4186/reset-password",
    tokenTtlMinutes: 60,
  },
  emailVerification: {
    hmacSecret: SMOKE_HMAC_SECRET,
    appUrl: "http://localhost:4186/verify-email",
    tokenTtlMinutes: 60,
    // "off", not the "strict" default: strict makes login fail with
    // email_not_verified for every account whose flag is false — which is the
    // seeded admin, so boot, e2e and the screenshot run would all lose login.
    mode: "off",
  },
  accountUnlock: {
    hmacSecret: SMOKE_HMAC_SECRET,
    appUrl: "http://localhost:4186/unlock-account",
    tokenTtlMinutes: 60,
  },
} as const;
