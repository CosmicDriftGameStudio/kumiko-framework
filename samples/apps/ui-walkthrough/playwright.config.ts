// @runtime test
// Playwright config for the ui-walkthrough run-through. Starts the
// real dev server as a webServer fixture, exactly like `bun dev` — only
// on the port from samples/e2e/e2e-ports.ts so no dev session collides.
//
// The dev server does the HTTP binding based on the PORT env. The
// setupTestStack default is ephemeral (fresh kumiko_test_<random> DB),
// so no DB reset logic is needed here.

import {
  defineAppE2eConfig,
  E2E_TIMEOUT_MS,
  PLAYWRIGHT_DEMO_ENV,
} from "@cosmicdrift/kumiko-testing/e2e";
import { chromium } from "@playwright/test";
import { E2E_PORTS } from "../../e2e/e2e-ports";

const PORT = E2E_PORTS["framework/ui-walkthrough"];
const PRINT_SERVICE_PORT = E2E_PORTS["framework/ui-walkthrough-puppeteer-service"];
// Both sides of the print service handshake; any value of 16+ characters will do for a local run.
const PRINT_SERVICE_TOKEN = "ui-walkthrough-e2e-print-service";

const appConfig = defineAppE2eConfig({
  port: PORT,
  serverEntry: "src/app/server.ts",
  locale: "en-US",
  env: {
    ...PLAYWRIGHT_DEMO_ENV,
    PUPPETEER_SERVICE_URL: `http://127.0.0.1:${PRINT_SERVICE_PORT}`,
    PUPPETEER_AUTH_TOKEN: PRINT_SERVICE_TOKEN,
  },
});

// The PDF preview of the template editor prints through the real puppeteer-service,
// on the Chromium that `playwright install chromium` provides.
export default {
  ...appConfig,
  webServer: [
    {
      command: "bun run src/index.ts",
      cwd: "../../../apps/puppeteer-service",
      url: `http://127.0.0.1:${PRINT_SERVICE_PORT}/healthz`,
      env: {
        PORT: String(PRINT_SERVICE_PORT),
        PUPPETEER_AUTH_TOKEN: PRINT_SERVICE_TOKEN,
        PUPPETEER_EXECUTABLE_PATH: chromium.executablePath(),
      },
      reuseExistingServer: false,
      timeout: E2E_TIMEOUT_MS.webServer,
      stdout: "pipe",
      stderr: "pipe",
    },
    ...[appConfig.webServer ?? []].flat(),
  ],
  // globalSetup spawnt vor allen Tests einen bun-Subprozess der die
  // Registry auswertet und `e2e/.e2e-data.json` schreibt. Der eigent-
  // liche generated.spec.ts-Runner liest nur die JSON — framework-
  // runtime bleibt aus dem Playwright-Worker raus (sonst kollidiert
  // sie mit Playwrights expect). Nicht Teil von AppE2eConfigInput,
  // daher als Zusatzfeld auf dem template-erzeugten Config-Objekt.
  globalSetup: "./e2e/global-setup.ts",
};
