// Playwright-Config für den workspaces-Sample. Startet den echten dev-
// server als webServer-Fixture auf Port 4175 (4173 = laufende Dev-
// Session, 4174 = ui-walkthrough-E2E). Pattern ist 1:1 wie der ui-
// walkthrough-Sample — wenn das Pattern nochmal gebraucht wird, lohnt
// sich eine Extraktion.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { samplesEnvFileArg } from "../../e2e/resolve-env-file";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_ARG = samplesEnvFileArg(HERE);

const PORT = 4175;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
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
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: `bun ${ENV_ARG} run src/app/server.ts`.replace(/\s+/g, " ").trim(),
    url: BASE_URL,
    // KUMIKO_DEV_DB_NAME="" → ephemeral DB pro Playwright-Run.
    env: { PORT: String(PORT), KUMIKO_DEV_DB_NAME: "" },
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
