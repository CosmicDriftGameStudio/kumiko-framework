// @runtime dev
//
// Dev-Server für Marketing-Demo. KEIN Auth — wie showcase, Auto-Mint-
// JWT (TestUsers.admin) damit Marketing-Screenshots ohne Login-Reibung
// gemacht werden können. Cream/Light Theme via styles.css.
//
// Zwei Features (Assets + Helpdesk) auf einer Instanz — beweist
// Marketing-Story „mehrere kleine Apps, eine Plattform".

import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import { assetsFeature } from "../features/assets/feature";
import { helpdeskFeature } from "../features/helpdesk/feature";
import { seedMarketingDemo } from "./seed";

await runDevApp({
  features: [assetsFeature, helpdeskFeature],
  // PORT-env überschreibbar — Playwright e2e nutzt eigenen Port (4179)
  // damit dev-mode (4178) parallel laufen kann.
  port: Number.parseInt(process.env["PORT"] ?? "4178", 10),
  clientEntry: "./src/app/client.tsx",
  htmlPath: "./public/index.html",
  watchDirs: ["./src", "../../../packages/*/src"],
  seeds: [seedMarketingDemo],
});
