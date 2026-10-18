// Production entrypoint. The env schema covers the same feature list that
// runProdApp mounts, so `KUMIKO_DRY_RUN_ENV=boot bun bin/server.ts` lists
// every variable of this app without connecting anywhere.
import { runProdApp } from "@cosmicdrift/kumiko-server-runtime";
import { composeAppEnv, createEnvCompositionFeatures } from "../src/env";

const features = createEnvCompositionFeatures();

await runProdApp({
  features: [...features],
  envSchema: composeAppEnv(features),
  // The recipe declares no PII fields; crypto-shredding is mounted only for
  // its env block.
  allowPlaintextPii: "env-composition recipe has no PII fields",
});
