import type { Page } from "@playwright/test";
import {
  applyDefaultTheme,
  DEFAULT_THEMES,
  docsSampleDir,
  runMatrix,
  type Scenario,
} from "../../../e2e/screenshots";
import { loginAsAdmin } from "./_helpers/login";

const openAdmin = async (page: Page): Promise<void> => {
  await loginAsAdmin(page);
  await page.goto("/");
};

const openDispatch = async (page: Page): Promise<void> => {
  await openAdmin(page);
  await page.getByTestId("workspace-switcher-trigger").click();
  await page.getByTestId("workspace-tab-dispatch").click();
  await page.waitForURL(/\/dispatch/);
};

const SCENARIOS: readonly Scenario[] = [
  {
    name: "workspace-admin",
    description: "Admin workspace — switcher dropdown plus the workspace's own nav",
    flow: openAdmin,
    waitFor: '[data-testid="workspace-switcher-trigger"]',
    settleMs: 400,
  },
  {
    name: "workspace-dispatch",
    description: "Dispatch workspace after switching tabs",
    flow: openDispatch,
    settleMs: 400,
  },
];

runMatrix(SCENARIOS, {
  baseDir: docsSampleDir(import.meta.dirname, "apps/workspaces"),
  themes: DEFAULT_THEMES,
  applyTheme: applyDefaultTheme,
  locales: ["en"],
});
