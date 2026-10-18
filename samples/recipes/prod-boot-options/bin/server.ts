import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { runProdApp } from "@cosmicdrift/kumiko-server-runtime";
import { appFeatures, bootOptions } from "../src/app";

const features = appFeatures();

await runProdApp({
  features,
  envSchema: composeEnvSchema({ features }),
  ...bootOptions(process.env),
});
