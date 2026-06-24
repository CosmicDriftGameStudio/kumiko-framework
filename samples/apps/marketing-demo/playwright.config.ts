// Playwright-Config für Marketing-Demo. Generiert Screenshots aus den
// echten gerenderten Pages (Asset-Tracker + Helpdesk) → cross-repo nach
// kumiko-platform/apps/marketing/public/screenshots/.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { samplesEnvFileArg } from "../../e2e/resolve-env-file";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_ARG = samplesEnvFileArg(HERE);

const PORT = 4179;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
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
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: `bun ${ENV_ARG} run src/app/server.ts`.replace(/\s+/g, " ").trim(),
    url: BASE_URL,
    env: {
      PORT: String(PORT),
      KUMIKO_DEV_DB_NAME: "",
    },
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
