// @runtime test
// Playwright config for the marketing demo. Generates screenshots from the
// actually rendered pages (asset tracker + helpdesk) into the configured
// screenshot directory.

import { defineAppE2eConfig, PLAYWRIGHT_DEMO_ENV } from "@cosmicdrift/kumiko-testing/e2e";
import { E2E_PORTS } from "../../e2e/e2e-ports";

const PORT = E2E_PORTS["framework/marketing-demo"];

export default defineAppE2eConfig({
  port: PORT,
  serverEntry: "src/app/server.ts",
  locale: "en-US",
  env: PLAYWRIGHT_DEMO_ENV,
});
