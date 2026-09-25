// @runtime test
// Playwright-Config für Marketing-Demo. Generiert Screenshots aus den
// echten gerenderten Pages (Asset-Tracker + Helpdesk) in das konfigurierte
// Screenshot-Verzeichnis.

import { defineAppE2eConfig, PLAYWRIGHT_DEMO_ENV } from "@cosmicdrift/kumiko-testing/e2e";
import { E2E_PORTS } from "../../e2e/e2e-ports";

const PORT = E2E_PORTS["framework/marketing-demo"];

export default defineAppE2eConfig({
  port: PORT,
  serverEntry: "src/app/server.ts",
  locale: "en-US",
  env: PLAYWRIGHT_DEMO_ENV,
});
