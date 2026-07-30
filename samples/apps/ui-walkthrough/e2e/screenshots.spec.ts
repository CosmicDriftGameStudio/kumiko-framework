// The generated screens render their own testid markers; wait on those instead
// of `networkidle`, which never fires against the dev-server's hot-reload
// long-poll (#1176).
import type { Page } from "@playwright/test";
import {
  applyDefaultTheme,
  DEFAULT_THEMES,
  docsSampleDir,
  runMatrix,
  type Scenario,
} from "../../../e2e/screenshots";
import { loginAsAdmin } from "./_helpers/login";

const RENDER_MARKERS =
  '[data-testid="render-edit-form"], [data-testid="render-list-table"], [data-testid="render-list-empty"]';

const open = (path: string) => async (page: Page) => {
  await loginAsAdmin(page);
  await page.goto(path);
};

const SCENARIOS: readonly Scenario[] = [
  {
    name: "task-list",
    description: "Generated list screen",
    flow: open("/task-list"),
    waitFor: RENDER_MARKERS,
    settleMs: 150,
  },
  {
    name: "task-edit",
    description: "Generated edit screen",
    flow: open("/task-edit"),
    waitFor: RENDER_MARKERS,
    settleMs: 150,
  },
];

runMatrix(SCENARIOS, {
  baseDir: docsSampleDir(import.meta.dirname, "apps/ui-walkthrough"),
  themes: DEFAULT_THEMES,
  applyTheme: applyDefaultTheme,
  locales: ["en"],
});
