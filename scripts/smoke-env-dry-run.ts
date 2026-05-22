// Smoke-test for Sprint-9.1 env-schemas in the REAL production code path.
//
// Integration-tests inject `envSource` to dodge `process.exit(0)`, so they
// don't actually verify that the dry-run mode reaches `console.log` against
// real stdout or that `process.exit(0)` ever fires. Memory
// `feedback_no_ci_only_smoke_tests` is explicit: mock-tests miss the actual
// entry-point. This script plugs that gap.
//
// Usage:
//   $ KUMIKO_DRY_RUN_ENV=1 bun run scripts/smoke-env-dry-run.ts
//     → prints human-mode inventory, exits 0
//
//   $ bun run scripts/smoke-env-dry-run.ts
//     → prints aggregated KumikoBootError to stderr, exits 1

import { createAuthEmailPasswordFeature } from "../packages/bundled-features/src/auth-email-password";
import { createSecretsFeature } from "../packages/bundled-features/src/secrets";
import { createSubscriptionMollieFeature } from "../packages/bundled-features/src/subscription-mollie";
import { createSubscriptionStripeFeature } from "../packages/bundled-features/src/subscription-stripe";
import { composeEnvSchema } from "../packages/framework/src/env";
import { frameworkCoreEnvSchema } from "../packages/dev-server/src/env-schema";
import { runProdApp } from "../packages/dev-server/src/run-prod-app";
import { z } from "zod";

// Real Phase-2 features — exercise the actual r.envSchema() attachment
// on the real factories (Sprint 9.3 contract). Smoke proves the schemas
// reach composeEnvSchema through the published bundled-features barrel,
// not just through inline-dummies.
const composed = composeEnvSchema({
  core: frameworkCoreEnvSchema,
  features: [
    createSecretsFeature(),
    createAuthEmailPasswordFeature(),
    createSubscriptionStripeFeature({
      webhookSecret: "whsec_smoke",
      apiKey: "sk_test_smoke",
      priceToTier: {},
    }),
    createSubscriptionMollieFeature({
      apiKey: "test_smoke",
      webhookUrl: "https://smoke.example/webhook",
      priceToTier: {},
      priceToConfig: {},
    }),
  ],
  extend: z.object({
    SMOKE_ADMIN_EMAIL: z.email().describe("Bootstrap admin"),
  }),
});

// Features intentionally empty: the envSchema check runs BEFORE
// composeFeatures, so this script needs no real feature wiring to
// exercise the dry-run / boot-error paths. Keeping the array empty also
// sidesteps the dual-path TS-resolution drift (worktree-source vs the
// symlinked original kumiko-framework in node_modules) that would
// otherwise complain about FeatureDefinition type-mismatches.
await runProdApp({
  features: [],
  envSchema: composed,
  pulumiPrefix: "smoke",
  // Intentionally NO envSource — exercise the real process.env path so
  // dry-run hits process.exit(0) and default boot-error-reporter calls
  // process.exit(1).
});
