// @runtime test
// English docs screenshots of the billing plans screen. Boots the gallery server with the docs
// variant switched on (net prices with a note, gross recurring price in the plan switch); the
// German review gallery has its own config. Gated by SCREENSHOT_DIR, see the `billing-docs` script.
import { defineAppE2eConfig, PLAYWRIGHT_DEMO_ENV } from "@cosmicdrift/kumiko-testing/e2e";
import { E2E_PORTS } from "../../e2e/e2e-ports";
import { GALLERY_DOCS_VARIANT_ENV } from "./e2e-billing-gallery/gallery-constants";

export default defineAppE2eConfig({
  port: E2E_PORTS["framework/use-all-bundled-billing-gallery"],
  env: { ...PLAYWRIGHT_DEMO_ENV, [GALLERY_DOCS_VARIANT_ENV]: "1" },
  locale: "en",
  testDir: "./e2e-billing-docs",
  serverEntry: "e2e-billing-gallery/server.ts",
});
