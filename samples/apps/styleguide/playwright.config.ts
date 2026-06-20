import { defineConfig, devices } from "@playwright/test";

const PORT = 4181;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun --env-file=../../../.env run src/app/server.ts",
    url: BASE_URL,
    env: { PORT: String(PORT), KUMIKO_DEV_DB_NAME: "" },
    reuseExistingServer: !process.env["CI"],
    timeout: 90_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
