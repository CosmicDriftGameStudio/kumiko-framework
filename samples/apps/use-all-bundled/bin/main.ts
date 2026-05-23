// Smoke-entrypoint for use-all-bundled. CI runs this with
// KUMIKO_DRY_RUN_ENV=boot to exercise validators across every bundled
// feature without an actual postgres/redis. See package.json `boot`
// script + ../README.md.

import { frameworkCoreEnvSchema, runProdApp } from "@cosmicdrift/kumiko-dev-server";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { APP_FEATURES } from "../src/run-config";

const envSchema = composeEnvSchema({
  core: frameworkCoreEnvSchema,
  features: APP_FEATURES,
});

await runProdApp({
  features: APP_FEATURES,
  envSchema,
  migrations: false,
});
