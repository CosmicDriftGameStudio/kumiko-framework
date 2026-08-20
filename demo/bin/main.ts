// Production bootstrap. KUMIKO_DRY_RUN_ENV=boot exits after
// composeFeatures + validateBoot + createRegistry without a DB/Redis
// connect (see @cosmicdrift/kumiko-server-runtime runProdApp). Real dev
// boot goes through `bunx kumiko dev` (in-repo dev tool) with the Docker
// stack — DX-1.0 only covers the boot-mode path; `kumiko dev` lands in a
// later DX phase.

import { composeFeatures, frameworkCoreEnvSchema } from "@cosmicdrift/kumiko-dev-server";
import { resolveKmsWiring } from "@cosmicdrift/kumiko-framework/crypto";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { runProdApp } from "@cosmicdrift/kumiko-server-runtime";
import { APP_FEATURES, HAS_AUTH } from "../src/run-config";

const DEFAULT_TENANT_ID = "aefd3536-85bf-485b-b325-00006f8a57a1" as TenantId;
const bootFeatures = composeFeatures(APP_FEATURES, { includeBundled: HAS_AUTH });
const envSchema = composeEnvSchema({ core: frameworkCoreEnvSchema, features: bootFeatures });

// Subject-key KMS for the pii-annotated fields (user, tenant-invitation,
// fileRef). Without the PLATFORM_KEK / SUBJECT_KEYS_DATABASE_URL /
// KUMIKO_BLIND_INDEX_KEY trio this falls back to plaintext PII with a loud
// boot warning — fine for a local demo, never for a real deploy
// (kumiko-framework#2309).
const kmsWiring = resolveKmsWiring(process.env, {
  logPrefix: "[demo]",
  plaintextReason: "local demo without subject-keys KMS",
});
if ("allowPlaintextPii" in kmsWiring) {
  console.warn(`[demo] PII IS STORED IN PLAINTEXT — ${kmsWiring.allowPlaintextPii}`);
}

await runProdApp({
  features: APP_FEATURES,
  envSchema,
  staticDir: "./dist",
  ...kmsWiring,
  auth: {
    admin: {
      email: "admin@demo.local",
      password: "change-me-on-first-deploy",
      displayName: "Admin",
      memberships: [
        {
          tenantId: DEFAULT_TENANT_ID,
          tenantKey: "demo",
          tenantName: "demo",
          roles: ["TenantAdmin"],
        },
      ],
    },
  },
});
