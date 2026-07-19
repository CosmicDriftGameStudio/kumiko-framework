// Smoke-entrypoint for use-all-bundled. CI runs this with
// KUMIKO_DRY_RUN_ENV=boot to exercise validators across every bundled
// feature without an actual postgres/redis. See package.json `boot`
// script + ../README.md.

import { frameworkCoreEnvSchema } from "@cosmicdrift/kumiko-dev-server";
import { InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { runProdApp } from "@cosmicdrift/kumiko-server-runtime";
import { APP_FEATURES } from "../src/run-config";

const SMOKE_TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;

const envSchema = composeEnvSchema({
  core: frameworkCoreEnvSchema,
  features: APP_FEATURES,
});

await runProdApp({
  features: APP_FEATURES,
  envSchema,
  // Smoke-only: exercises the hard PII boot gate + blind-index gate with
  // every bundled feature mounted. Real apps wire createPgKmsAdapter(...).
  kms: new InMemoryKmsAdapter(),
  blindIndexKey: Buffer.alloc(32, 7).toString("base64"),
  // migrations default ("./kumiko/migrations") — Boot-mode springt vor dem
  // Schema-Drift-Gate raus, der Pfad ist hier nur der runProdApp-Default.
  // auth.admin triggert composeFeatures(includeBundled:true) — auto-mounts
  // config + user + tenant + auth-email-password. Boot-mode exitiert
  // bevor admin-Seeding läuft, der Wert ist nur ein Stub für die Typen.
  auth: {
    admin: {
      email: "smoke@use-all-bundled.local",
      password: "smoke-only-never-deployed",
      displayName: "Smoke Admin",
      memberships: [
        {
          tenantId: SMOKE_TENANT_ID,
          tenantKey: "smoke",
          tenantName: "Use-All-Bundled Smoke",
          roles: ["TenantAdmin"],
        },
      ],
    },
  },
});
