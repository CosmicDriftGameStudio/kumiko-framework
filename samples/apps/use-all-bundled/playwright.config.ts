// @runtime test
import { defineAppE2eConfig, PLAYWRIGHT_DEMO_ENV } from "@cosmicdrift/kumiko-testing/e2e";
import { E2E_PORTS } from "../../e2e/e2e-ports";

const PORT = E2E_PORTS["framework/use-all-bundled"];

export default defineAppE2eConfig({
  port: PORT,
  serverEntry: "src/app/server.ts",
  env: PLAYWRIGHT_DEMO_ENV,
});
