// Real-browser specs for kumiko-testing's own e2e helpers. Boots only the
// fixture server in settle-server.ts, no app stack and no database.

import { defineConfig, devices } from "@playwright/test";
import { E2E_PORTS } from "../../../samples/e2e/e2e-ports";

const PORT = E2E_PORTS["framework/testing"];
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: ".",
  testIgnore: ["**/settle-server.ts"],
  forbidOnly: !!process.env["CI"],
  reporter: [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: "bun settle-server.ts",
    url: BASE_URL,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
