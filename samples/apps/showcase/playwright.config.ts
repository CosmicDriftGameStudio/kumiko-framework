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
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The full app, not a demos-only variant: the screenshots cover the item
    // screens too, and those need the entity plus its seeds.
    command: `bun ${ENV_ARG} run src/app/server.ts`.replace(/\s+/g, " ").trim(),
    url: BASE_URL,
    // KUMIKO_DEV_DB_NAME="" → ephemeral DB per Playwright run.
    env: { PORT: String(PORT), KUMIKO_DEV_DB_NAME: "" },
    reuseExistingServer: !process.env["CI"],
    // 200 sequential showcase:write:item:create seeds go through the full
    // pipeline (validation, read-side, search-index, audit) on an ephemeral
    // DB — 120s was tuned for the pre-seed screenshot-server variant.
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
