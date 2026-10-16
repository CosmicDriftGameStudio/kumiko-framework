// @runtime test
import {
  defineAppE2eConfig,
  E2E_TIMEOUT_MS,
  PLAYWRIGHT_DEMO_ENV,
} from "@cosmicdrift/kumiko-testing/e2e";
import { chromium } from "@playwright/test";
import { E2E_PORTS } from "../../e2e/e2e-ports";

const PORT = E2E_PORTS["framework/use-all-bundled"];
const PRINT_SERVICE_PORT = E2E_PORTS["framework/use-all-bundled-puppeteer-service"];
// Both sides of the print service handshake; any value of 16+ characters will do for a local run.
const PRINT_SERVICE_TOKEN = "use-all-bundled-e2e-print-service";

const appConfig = defineAppE2eConfig({
  port: PORT,
  env: {
    ...PLAYWRIGHT_DEMO_ENV,
    PUPPETEER_SERVICE_URL: `http://127.0.0.1:${PRINT_SERVICE_PORT}`,
    PUPPETEER_AUTH_TOKEN: PRINT_SERVICE_TOKEN,
  },
});

// The PDF template editor prints through the real puppeteer-service, on the Chromium
// that `playwright install chromium` provides instead of a Chrome download of its own.
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
};
