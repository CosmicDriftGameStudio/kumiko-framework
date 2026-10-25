// @runtime test
// Playwright config for the workspaces sample. Starts the real dev
// server as a webServer fixture (port from samples/e2e/e2e-ports.ts).
// The pattern is 1:1 as in the ui-
// walkthrough sample — if the pattern is needed again, an extraction
// is worthwhile.

import { defineAppE2eConfig, PLAYWRIGHT_DEMO_ENV } from "@cosmicdrift/kumiko-testing/e2e";
import { E2E_PORTS } from "../../e2e/e2e-ports";

const PORT = E2E_PORTS["framework/workspaces"];

export default defineAppE2eConfig({
  port: PORT,
  serverEntry: "src/app/server.ts",
  locale: "en-US",
  env: PLAYWRIGHT_DEMO_ENV,
});
