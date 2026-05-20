// @runtime dev
//
// Sample-Server für config-demo. Importiert runDevApp aus dev-server
// → muss explizit als [dev]-File markiert sein, weil das Default
// (samples/apps/<x>/src/app/server.ts) ohne directive als [runtime]
// klassifiziert wird und [runtime]→[dev] vom Isolation-Guard blockt.

import {
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
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
