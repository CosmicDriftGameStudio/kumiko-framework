import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { runProdApp } from "@cosmicdrift/kumiko-server-runtime";
import { notesFeature, pwa } from "../src/app";

const features = [notesFeature];

await runProdApp({
  features,
  envSchema: composeEnvSchema({ features }),
  staticDir: "dist",
  pwa,
});
