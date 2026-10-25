// @runtime dev
//
// Sample server for config-demo. Imports runDevApp from dev-server
// → must be explicitly marked as a [dev] file, because the default
// (samples/apps/<x>/src/app/server.ts) without a directive is classified as [runtime]
// and [runtime]→[dev] is blocked by the isolation guard.

import {
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import { configDemoFeature } from "../features/demo/feature";

const resolver = createConfigResolver();

import { localeDe } from "@cosmicdrift/kumiko-locale-de";

await runDevApp({
  features: [localeDe(), createConfigFeature(), createSecretsFeature(), configDemoFeature],
  port: Number.parseInt(process.env["PORT"] ?? "4172", 10),
  clientEntry: "./src/app/client.tsx",
  htmlPath: "./public/index.html",
  watchDirs: ["./src", "../../../packages/*/src"],
  extraContext: ({ registry }) => ({
    configResolver: resolver,
    configAccessorFactory: createConfigAccessorFactory(registry, resolver),
  }),
});
