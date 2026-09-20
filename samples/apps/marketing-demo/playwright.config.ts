// @runtime test
// Playwright-Config für Marketing-Demo. Generiert Screenshots aus den
// echten gerenderten Pages (Asset-Tracker + Helpdesk) → cross-repo nach
// kumiko-platform/apps/marketing/public/screenshots/.

import { defineConfig, devices } from "@playwright/test";
import "@cosmicdrift/kumiko-testing/preload/env";
import { PLAYWRIGHT_DEMO_ENV, screenshotSpecsIgnore } from "@cosmicdrift/kumiko-testing/e2e";
import { E2E_PORTS } from "../../e2e/e2e-ports";

const PORT = E2E_PORTS["framework/marketing-demo"];
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: screenshotSpecsIgnore(),
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: BASE_URL,
    locale: "en-US",
    trace: "retain-on-failure",
    actionTimeout: 5_000,
    navigationTimeout: 15_000,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
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
    env: { ...PLAYWRIGHT_DEMO_ENV, PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
