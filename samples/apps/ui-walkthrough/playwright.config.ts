// Playwright-Config für den ui-walkthrough-Durchstich. Startet den
// echten dev-server als webServer-Fixture, genau wie `yarn dev` — nur
// auf Port 4174 damit die laufende Dev-Session (4173) nicht kollidiert.
//
// Der dev-server macht auf PORT-Env basierend das HTTP-Binding. Die
// setupTestStack-Default ist ephemeral (fresh kumiko_test_<random> DB),
// deshalb braucht's keine DB-Reset-Logik hier.

import { defineConfig, devices } from "@playwright/test";

const PORT = 4174;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // globalSetup spawnt vor allen Tests einen bun-Subprozess der die
  // Registry auswertet und `e2e/.e2e-data.json` schreibt. Der eigent-
  // liche generated.spec.ts-Runner liest nur die JSON — framework-
  // runtime bleibt aus dem Playwright-Worker raus (sonst kollidiert
  // sie mit Playwrights expect).
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1,
  reporter: [["list"]],
  // Per-Test-Timeout: 10s statt Playwright-Default 30s. Unsere E2E-
  // Actions (Render, fill, click, warten auf testId) sollen in <1s
  // antworten — wenn ein Test 10s überschreitet, stimmt strukturell
  // was nicht und 30s würde nur die Warte-Zeit beim Debuggen strecken.
  timeout: 10_000,
  expect: {
    // expect-toBeVisible etc. wartet nur 3s statt Default 5s. Echte
    // UI-Updates sind in <200ms da; länger deutet auf einen race/flake.
    timeout: 3_000,
  },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Action-Timeout (click, fill etc.) — 5s ist großzügig für UI,
    // erspart aber die 30s-Trace-Dumps bei kaputten Locators.
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
    command: "bun --env-file=../../../.env run src/server.ts",
    url: BASE_URL,
    // KUMIKO_DEV_DB_NAME="" zwingt setupTestStack in den ephemeral-
    // Mode (fresh kumiko_test_<random> DB pro Playwright-Run, im
    // stop()-Handler gedroppt). Ohne das würde E2E gegen die persistent
    // Dev-DB laufen und die Tests sähen bereits gespeicherte Einträge.
    env: { PORT: String(PORT), KUMIKO_DEV_DB_NAME: "" },
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
