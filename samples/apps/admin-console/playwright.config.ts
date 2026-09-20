// @runtime test
import { defineConfig, devices } from "@playwright/test";
import "@cosmicdrift/kumiko-testing/preload/env";
import { PLAYWRIGHT_DEMO_ENV } from "@cosmicdrift/kumiko-testing/e2e";
import { E2E_PORTS } from "../../e2e/e2e-ports";

// E2E port from samples/e2e/e2e-ports.ts; 4177 stays free for manual `bun dev`.
const PORT = E2E_PORTS["framework/admin-console"];
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 15_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: BASE_URL,
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 5_000,
    navigationTimeout: 15_000,
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
    timeout: 90_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
