import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { E2E_PORTS } from "../../e2e/e2e-ports";
import { samplesEnvFileArg } from "../../e2e/resolve-env-file";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_ARG = samplesEnvFileArg(HERE);

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
    command: `bun ${ENV_ARG} run src/app/server.ts`.replace(/\s+/g, " ").trim(),
    url: BASE_URL,
    env: { PORT: String(PORT), KUMIKO_DEV_DB_NAME: "" },
    reuseExistingServer: false,
    timeout: 90_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
