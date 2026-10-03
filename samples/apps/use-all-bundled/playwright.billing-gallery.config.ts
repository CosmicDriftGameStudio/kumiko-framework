// @runtime test
// Review gallery for the consent/termination flows. Not part of the CI e2e
// list (.github/workflows/ci.yml) and gated by SCREENSHOT_DIR like every other
// screenshot spec: run it by hand, see the `billing-gallery` script.
import { defineAppE2eConfig, PLAYWRIGHT_DEMO_ENV } from "@cosmicdrift/kumiko-testing/e2e";
import { E2E_PORTS } from "../../e2e/e2e-ports";

export default defineAppE2eConfig({
  port: E2E_PORTS["framework/use-all-bundled-billing-gallery"],
  env: PLAYWRIGHT_DEMO_ENV,
  locale: "de",
  testDir: "./e2e-billing-gallery",
  serverEntry: "e2e-billing-gallery/server.ts",
});
