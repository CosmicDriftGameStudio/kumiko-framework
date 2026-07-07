// Single source of truth für die Feature-Komposition der Demo-App.
//
// **Mount-Order matters:** mail-foundation MUSS vor mail-transport-
// inmemory stehen (`r.requires("mail-foundation")` im Plugin); das
// newsletter-feature kommt danach (es nutzt mail-foundation +
// cap-counter). composeFeatures (auth-mode) ergänzt config + secrets +
// auth-email-password automatisch.
//
// **Was hier gemountet wird:**
//   - cap-counter            — Counter-Storage + Helpers
//   - mail-foundation        — Plugin-Host für Transports
//   - mail-transport-inmemory — Demo-Transport (kein SMTP nötig)
//   - billing-foundation — Plugin-Host für Subscription-Provider
//                               (Stripe/Mollie). Demo mountet Provider
//                               nicht selbst — App-Owner ergänzt
//                               createSubscriptionStripeFeature(...) /
//                               createSubscriptionMollieFeature(...) in
//                               der eigenen run-config.
//   - newsletter             — die Demo-Domain mit cap-aware send

import { billingFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { capCounterFeature } from "@cosmicdrift/kumiko-bundled-features/cap-counter";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { mailFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import { mailTransportInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory";
import { createTenantLifecycleFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-lifecycle";
import { newsletterFeature } from "./feature";

/**
 * Demo-App-Features.
 *
 * **createSecretsFeature() Single-Instance:** wird EINMAL beim
 * Module-Load aufgerufen. Konsumenten die `run-config.ts` mehrfach
 * importieren (bin/server.ts + Tests) kriegen via ESM-Module-Cache
 * dasselbe Feature-Objekt zurück.
 */
export const APP_FEATURES = [
  createSecretsFeature(),
  capCounterFeature,
  mailFoundationFeature,
  mailTransportInMemoryFeature,
  createComplianceProfilesFeature(),
  createTenantLifecycleFeature(),
  billingFoundationFeature,
  newsletterFeature,
] as const;

export const HAS_AUTH = true;
