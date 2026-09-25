// @runtime test
import { defineAppE2eConfig, PLAYWRIGHT_DEMO_ENV } from "@cosmicdrift/kumiko-testing/e2e";
import { E2E_PORTS } from "../../e2e/e2e-ports";

// E2E port from samples/e2e/e2e-ports.ts; 4177 stays free for manual `bun dev`.
const PORT = E2E_PORTS["framework/admin-console"];

export default defineAppE2eConfig({
  port: PORT,
  serverEntry: "src/app/server.ts",
  locale: "en-US",
  env: PLAYWRIGHT_DEMO_ENV,
});
