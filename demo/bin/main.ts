// Production-bootstrap. KUMIKO_DRY_RUN_ENV=boot exits after
// composeFeatures + validateBoot + createRegistry without DB/Redis-connect
// (siehe @cosmicdrift/kumiko-dev-server runProdApp). Echter Dev-Boot
// passiert via `bunx kumiko dev` (in-repo dev-tool) mit Docker-stack — DX-1.0 deckt nur
// den boot-mode-Pfad ab; `kumiko dev` kommt in einer späteren DX-Phase.

import {
  composeFeatures,
  frameworkCoreEnvSchema,
  runProdApp,
} from "@cosmicdrift/kumiko-dev-server";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { APP_FEATURES, HAS_AUTH } from "../src/run-config";

const DEFAULT_TENANT_ID = "aefd3536-85bf-485b-b325-00006f8a57a1" as TenantId;
const bootFeatures = composeFeatures(APP_FEATURES, { includeBundled: HAS_AUTH });
const envSchema = composeEnvSchema({ core: frameworkCoreEnvSchema, features: bootFeatures });
await runProdApp({
  features: APP_FEATURES,
  envSchema,
  staticDir: "./dist",
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
