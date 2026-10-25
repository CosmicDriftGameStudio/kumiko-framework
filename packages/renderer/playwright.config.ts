// Playwright config for renderer/e2e. Boots the minimal build-server
// (see e2e/build-server.ts) instead of a full Kumiko stack, so the
// renderer package runs alone against a MockDispatcher.
//
// Port comes from samples/e2e/e2e-ports.ts.
// No Docker and no DB needed, only browser plus bundle.

import { defineConfig, devices } from "@playwright/test";
import { E2E_PORTS } from "../../samples/e2e/e2e-ports";

const PORT = E2E_PORTS["framework/renderer"];
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
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
