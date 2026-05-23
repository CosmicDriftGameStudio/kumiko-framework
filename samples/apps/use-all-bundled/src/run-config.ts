// Canonical smoke-sample: mounts every bundled-feature so framework-CI
// catches feature-coverage gaps. Real apps mount only what they use; the
// 12 bugs of Sprint 9.8 surfaced because 27 of 30 bundled-features had
// zero integration-coverage from any real app. This sample is the gate.
//
// Mount-order matters for some pairs (foundation before transport/
// provider, delivery before channels). composeFeatures (auth-mode in
// runProdApp/runDevApp) auto-mixes config + user + tenant + auth-email-
// password — we still list them explicitly here so the failure mode is
// "feature unimported" rather than "feature silently dropped".

import { createAuditFeature } from "@cosmicdrift/kumiko-bundled-features/audit";
import { billingFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { capCounterFeature } from "@cosmicdrift/kumiko-bundled-features/cap-counter";
import { createChannelInAppFeature } from "@cosmicdrift/kumiko-bundled-features/channel-in-app";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { customFieldsFeature } from "@cosmicdrift/kumiko-bundled-features/custom-fields";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { fileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { fileProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-inmemory";
import { createFilesFeature } from "@cosmicdrift/kumiko-bundled-features/files";
import { createJobsFeature } from "@cosmicdrift/kumiko-bundled-features/jobs";
import { createLegalPagesFeature } from "@cosmicdrift/kumiko-bundled-features/legal-pages";
import { mailFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import { mailTransportInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory";
import { createRateLimitingFeature } from "@cosmicdrift/kumiko-bundled-features/rate-limiting";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createRendererSimpleFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-simple";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createStepDispatcherFeature } from "@cosmicdrift/kumiko-bundled-features/step-dispatcher";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createTextContentFeature } from "@cosmicdrift/kumiko-bundled-features/text-content";
import { tierEngineFeature } from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import { createUserDataRightsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { createUserDataRightsDefaultsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";

export const APP_FEATURES = [
  // foundations + identities
  createSecretsFeature(),
  createConfigFeature(),
  createTenantFeature(),
  createUserFeature(),
  createSessionsFeature(),

  // auth is auto-mixed by composeFeatures(authOptions=…) in main.ts;
  // listed there, not here, because it requires app-level options.

  // delivery + channels (foundation before transports)
  createDeliveryFeature(),
  createChannelInAppFeature(),
  // channel-email + channel-push require provider-options; mount in M0.1.

  // mail (foundation before transport)
  mailFoundationFeature,
  mailTransportInMemoryFeature,
  // mail-transport-smtp requires SMTP_HOST/USER/PASS; mount in M0.1.

  // files (foundation before provider)
  fileFoundationFeature,
  fileProviderInMemoryFeature,
  createFilesFeature(),
  // file-provider-s3 + files-provider-s3 require S3 creds; mount in M0.1.

  // billing
  billingFoundationFeature,
  // subscription-stripe + subscription-mollie need provider keys; M0.1.

  // tiering + caps
  tierEngineFeature,
  capCounterFeature,

  // jobs
  createJobsFeature(),
  createStepDispatcherFeature(),

  // compliance / DSGVO
  createComplianceProfilesFeature(),
  createDataRetentionFeature(),
  createUserDataRightsFeature(),
  createUserDataRightsDefaultsFeature(),

  // CMS / content
  createTextContentFeature(),
  createLegalPagesFeature(),
  createTemplateResolverFeature(),
  createRendererFoundationFeature(),
  createRendererSimpleFeature(),

  // operational
  createRateLimitingFeature(),
  createAuditFeature(),

  // app-author-grade
  customFieldsFeature,
] as const;
