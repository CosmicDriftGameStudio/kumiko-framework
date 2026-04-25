// Playwright-Config für renderer-web/e2e. Bootet den minimalen
// build-server (siehe e2e/build-server.ts) statt eines vollen
// Kumiko-Stacks — Renderer-Package alleine gegen MockDispatcher.
//
// Port 4176: 4173=dev, 4174=ui-walkthrough, 4175=workspaces.
// Kein Docker erforderlich, keine DB — purely Browser + Bundle.

import { defineConfig, devices } from "@playwright/test";

const PORT = 4176;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // build-server.ts ist kein Test — Playwright muss den Build-Pfad ignorieren.
  testIgnore: ["**/fixtures/**", "**/build-server.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 10_000,
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
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "bun e2e/build-server.ts",
    url: BASE_URL,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
