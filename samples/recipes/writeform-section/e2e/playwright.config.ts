// Playwright config for writeform-section/e2e. Boots the minimal
// build-server (see e2e/build-server.ts) — a real browser + real React
// bundle against a MockDispatcher, no full Kumiko stack. Pattern copied
// from samples/recipes/wizard-form/e2e/playwright.config.ts.
//
// Port 4189: see the build-server.ts comment for the port allocation
// overview of the other samples/apps ports.
//
// Config lives IN e2e/ itself — Playwright's webServer.command runs by
// default with cwd = the config's directory, i.e. relative to e2e/ itself
// (not to the package root). testDir therefore stays "." instead of
// "./e2e", and webServer.command calls build-server.ts without an "e2e/"
// prefix.

import { defineConfig, devices } from "@playwright/test";

const PORT = 4189;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: ".",
  // build-server.ts + fixtures/* are not a test — Playwright must ignore the build path.
  testIgnore: ["**/fixtures/**", "build-server.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 15_000,
  expect: { timeout: 3_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
  ],

  webServer: {
    command: "bun build-server.ts",
    url: BASE_URL,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
