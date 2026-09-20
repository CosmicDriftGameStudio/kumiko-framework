// @runtime test
// Playwright-Config für den workspaces-Sample. Startet den echten dev-
// server als webServer-Fixture (Port aus samples/e2e/e2e-ports.ts).
// Pattern ist 1:1 wie der ui-
// walkthrough-Sample — wenn das Pattern nochmal gebraucht wird, lohnt
// sich eine Extraktion.

import { defineConfig, devices } from "@playwright/test";
import "@cosmicdrift/kumiko-testing/preload/env";
import { PLAYWRIGHT_DEMO_ENV, screenshotSpecsIgnore } from "@cosmicdrift/kumiko-testing/e2e";
import { E2E_PORTS } from "../../e2e/e2e-ports";

const PORT = E2E_PORTS["framework/workspaces"];
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: screenshotSpecsIgnore(),
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 10_000,
  expect: {
    timeout: 3_000,
  },

  use: {
    baseURL: BASE_URL,
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    viewport: { width: 1920, height: 1080 },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
  ],

  webServer: {
    command: "bun run src/app/server.ts",
    url: BASE_URL,
    // KUMIKO_DEV_DB_NAME="" → ephemeral DB pro Playwright-Run.
    env: { ...PLAYWRIGHT_DEMO_ENV, PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
