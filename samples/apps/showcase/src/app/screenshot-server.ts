// Minimal dev server for Playwright screenshots — demos only (no item seeds).

import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import { demosFeature } from "../features/demos";
import { mountPublicScreenshots } from "./mount-public-screenshots";

await runDevApp({
  features: [demosFeature],
  port: Number.parseInt(process.env["PORT"] ?? "4175", 10),
  clientEntry: "./src/app/client.tsx",
  htmlPath: "./public/index.html",
  extraRoutes: (app) => mountPublicScreenshots(app),
  watchDirs: ["./src", "../../../packages/*/src"],
});
