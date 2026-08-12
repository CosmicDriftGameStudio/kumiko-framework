// Playwright config for wizard-form/e2e. Boots the minimal build-server
// (see e2e/build-server.ts) — a real browser + real React bundle against
// a MockDispatcher, no full Kumiko stack. Pattern copied from
// packages/renderer-web/playwright.config.ts.
//
// Port 4188: see the build-server.ts comment for the port allocation
// overview of the other samples/apps ports.
//
// Unlike the renderer-web blueprint (config sits at the package root, e2e/
// is only testDir), this config lives IN e2e/ itself — Playwright's
// webServer.command runs by default with cwd = the config's directory,
// i.e. relative to e2e/ itself (not to the package root). testDir
// therefore stays "." instead of "./e2e", and webServer.command calls
// build-server.ts without an "e2e/" prefix.

import { defineConfig, devices } from "@playwright/test";

const PORT = 4188;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: ".",
  // build-server.ts + fixtures/* are not a test — Playwright must ignore the build path.
  testIgnore: ["**/fixtures/**", "build-server.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 15_000,
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
      testIgnore: ["**/fixtures/**", "build-server.ts", "wizard-mobile.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    // iPhone SE/Mini class (375px) — acceptance criterion from #1917:
    // Chrome (progress/back/next/step title) renders correctly at the
    // narrowest common phone width, and the Next button stays reachable
    // when the virtual keyboard shrinks the viewport. Desktop Chrome base
    // instead of a mobile device descriptor — avoids isMobile/hasTouch
    // side effects (touch events instead of click) that pure layout
    // assertions don't need.
    {
      name: "mobile-375",
      testMatch: ["wizard-mobile.spec.ts"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 667 } },
    },
  ],

  webServer: {
    command: "bun build-server.ts",
    url: BASE_URL,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
