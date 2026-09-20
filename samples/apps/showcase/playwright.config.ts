// @runtime test
import { defineConfig, devices } from "@playwright/test";
import "@cosmicdrift/kumiko-testing/preload/env";
import { PLAYWRIGHT_DEMO_ENV, screenshotSpecsIgnore } from "@cosmicdrift/kumiko-testing/e2e";
import { E2E_PORTS } from "../../e2e/e2e-ports";

const PORT = E2E_PORTS["framework/showcase"];
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: screenshotSpecsIgnore(),
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
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
    // The full app, not a demos-only variant: the screenshots cover the item
    // screens too, and those need the entity plus its seeds.
    command: "bun run src/app/server.ts",
    url: BASE_URL,
    // KUMIKO_DEV_DB_NAME="" → ephemeral DB per Playwright run.
    env: { ...PLAYWRIGHT_DEMO_ENV, PORT: String(PORT) },
    reuseExistingServer: false,
    // 200 sequential showcase:write:item:create seeds go through the full
    // pipeline (validation, read-side, search-index, audit) on an ephemeral
    // DB — 120s was tuned for the pre-seed screenshot-server variant.
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
