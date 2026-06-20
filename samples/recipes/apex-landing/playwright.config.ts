import { defineConfig, devices } from "@playwright/test";

// No webServer: the Apex renderer is a pure function, so the runner feeds its
// HTML straight into the page via setContent — nothing to boot.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
