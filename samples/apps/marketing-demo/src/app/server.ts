// @runtime dev
//
// Dev server for the marketing demo. NO auth — like showcase, auto-mint
// JWT (TestUsers.admin) so marketing screenshots can be made
// without login friction. Cream/light theme via styles.css.
//
// Two features (assets + ticketing) on one instance — proves the
// marketing story "several small apps, one platform".

import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { assetsFeature } from "../features/assets/feature";
import { ticketingFeature } from "../features/ticketing/feature";
import { seedMarketingDemo } from "./seed";

await runDevApp({
  features: [localeDe(), assetsFeature, ticketingFeature],
  // PORT env overridable — Playwright e2e uses its own port (4179)
  // so dev mode (4178) can run in parallel.
  port: Number.parseInt(process.env["PORT"] ?? "4178", 10),
  clientEntry: "./src/app/client.tsx",
  htmlPath: "./public/index.html",
  watchDirs: ["./src", "../../../packages/*/src"],
  seeds: [seedMarketingDemo],
});
