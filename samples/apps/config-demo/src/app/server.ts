import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import {
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { configDemoFeature } from "../features/demo/feature";

const resolver = createConfigResolver();

await runDevApp({
  features: [createConfigFeature(), createSecretsFeature(), configDemoFeature],
  port: Number.parseInt(process.env["PORT"] ?? "4172", 10),
  clientEntry: "./src/app/client.tsx",
  htmlPath: "./public/index.html",
  watchDirs: ["./src", "../../../packages/*/src"],
  extraContext: ({ registry }) => ({
    configResolver: resolver,
    _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
  }),
});
