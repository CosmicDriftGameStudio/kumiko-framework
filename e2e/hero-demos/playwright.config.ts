// Hero-demo E2E config. Per-spec webServer that scaffolds and boots a
// fresh kumiko app via boot-demo.ts. The spec maps a DemoDef object onto
// playwright assertions via run-demo.ts — single source of truth shared
// with scripts/record-demo.ts so a green E2E guarantees a hang-free
// recording session.
//
// Each spec picks its own port + scaffold-name via env so multiple hero
// demos can run sequentially in the same job without colliding state.

import { defineConfig, devices } from "@playwright/test";

const PORT = process.env["HERO_PORT"] ?? "4290";
// Test workers are child processes of this config process and inherit
// process.env - run-demo.ts reads HERO_PORT for rewritePort(), otherwise it never arrives.
process.env["HERO_PORT"] = PORT;
// Must match demo.yaml vars.appName ("hero-app") - that's what
// steps/06-fill-credentials.yaml templates the expected admin@{{appName}}.local from.
const DEMO = process.env["HERO_DEMO"] ?? "hero-app";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bun e2e/hero-demos/boot-demo.ts ${DEMO}`,
    url: BASE_URL,
    cwd: "../..",
    env: { PORT, HERO_DEMO: DEMO },
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
