// @runtime test
// Playwright-Config für den workspaces-Sample. Startet den echten dev-
// server als webServer-Fixture (Port aus samples/e2e/e2e-ports.ts).
// Pattern ist 1:1 wie der ui-
// walkthrough-Sample — wenn das Pattern nochmal gebraucht wird, lohnt
// sich eine Extraktion.

import { defineAppE2eConfig, PLAYWRIGHT_DEMO_ENV } from "@cosmicdrift/kumiko-testing/e2e";
import { E2E_PORTS } from "../../e2e/e2e-ports";

const PORT = E2E_PORTS["framework/workspaces"];

export default defineAppE2eConfig({
  port: PORT,
  serverEntry: "src/app/server.ts",
  locale: "en-US",
  env: PLAYWRIGHT_DEMO_ENV,
});
