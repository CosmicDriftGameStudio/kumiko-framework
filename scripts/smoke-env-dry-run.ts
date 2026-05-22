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

import { defineFeature } from "../packages/framework/src/engine";
import { composeEnvSchema } from "../packages/framework/src/env";
import { runProdApp } from "../packages/dev-server/src/run-prod-app";
import { z } from "zod";

const secretsFeature = defineFeature("secrets", (r) => {
  r.envSchema(
    z.object({
      KUMIKO_SECRETS_MASTER_KEY_V1: z
        .string()
        .describe("AES-256 master-key")
        .meta({ kumiko: { pulumi: { generator: "openssl rand -base64 32", secret: true } } }),
    }),
  );
});

const authFeature = defineFeature("auth-email-password", (r) => {
  r.envSchema(
    z.object({
      JWT_SECRET: z
        .string()
        .min(32)
        .describe("Session JWT signing key (≥32 chars)")
        .meta({ kumiko: { pulumi: { generator: "openssl rand -base64 48", secret: true } } }),
    }),
  );
});

const composed = composeEnvSchema({
  features: [secretsFeature, authFeature],
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
