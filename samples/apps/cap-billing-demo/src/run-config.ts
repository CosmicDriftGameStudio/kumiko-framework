// Single source of truth for the feature composition of the demo app.
//
// **Mount order matters:** mail-foundation MUST come before mail-transport-
// inmemory (`r.requires({ features: ["mail-foundation"] })` in the plugin); the
// newsletter feature comes after (it uses mail-foundation +
// cap-counter). composeFeatures (auth mode) adds config + secrets +
// auth-email-password automatically.
//
// **What is mounted here:**
//   - cap-counter            — counter storage + helpers
//   - mail-foundation        — plugin host for transports
//   - mail-transport-inmemory — demo transport (no SMTP needed)
//   - billing-foundation — plugin host for subscription providers
//                               (Stripe/Mollie). The demo does not mount a provider
//                               itself — the app owner adds
//                               createSubscriptionStripeFeature(...) /
//                               createSubscriptionMollieFeature(...) in
//                               their own run-config.
//   - newsletter             — the demo domain with cap-aware send

import { createBillingFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { createCapCounterFeature } from "@cosmicdrift/kumiko-bundled-features/cap-counter";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createMailFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import { createMailTransportInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createTenantLifecycleFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-lifecycle";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { newsletterFeature } from "./feature";

/**
 * Demo app features.
 *
 * **createSecretsFeature() single instance:** is called ONCE at
 * module load. Consumers that import `run-config.ts` several times
 * (bin/server.ts + tests) get the same feature object back via the
 * ESM module cache.
 */
export const APP_FEATURES = [
  localeDe(),
  createSecretsFeature(),
  createCapCounterFeature(),
  createMailFoundationFeature(),
  createMailTransportInMemoryFeature(),
  createComplianceProfilesFeature(),
  createTenantLifecycleFeature(),
  createBillingFoundationFeature(),
  newsletterFeature,
] as const;

export const HAS_AUTH = true;
