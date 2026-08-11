// Playwright-Config für wizard-form/e2e. Bootet den minimalen build-server
// (siehe e2e/build-server.ts) — echter Browser + echtes React-Bundle gegen
// einen MockDispatcher, kein voller Kumiko-Stack. Pattern kopiert von
// packages/renderer-web/playwright.config.ts.
//
// Port 4188: siehe build-server.ts-Kommentar für die Belegungs-Übersicht
// der anderen samples/apps-Ports.
//
// Anders als beim renderer-web-Vorbild (config sitzt am Package-Root, e2e/
// ist nur testDir) liegt diese config IN e2e/ selbst — Playwright's
// webServer.command läuft default-mäßig mit cwd = Verzeichnis der config,
// also relativ zu e2e/ selbst (nicht zum Package-Root). testDir bleibt
// deshalb "." statt "./e2e", und das webServer.command ruft build-server.ts
// ohne "e2e/"-Präfix.

import { defineConfig, devices } from "@playwright/test";

const PORT = 4188;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: ".",
  // build-server.ts + fixtures/* sind kein Test — Playwright muss den Build-Pfad ignorieren.
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
      use: { ...devices["Desktop Chrome"] },
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
