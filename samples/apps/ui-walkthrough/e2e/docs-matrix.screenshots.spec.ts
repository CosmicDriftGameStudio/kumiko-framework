// @runtime test
// Docs preview matrix for the quickstart and walkthrough pages
// (samples/apps/ui-walkthrough/<scenario>/<locale>/<theme>/<viewport>.png).
// Kept apart from screenshots.spec.ts, the German design review, so neither
// run overwrites the other's output. The generated screens render their own
// testid markers; wait on those instead of `networkidle`, which never fires
// against the dev-server's hot-reload long-poll.

import {
  applyDefaultTheme,
  DEFAULT_THEMES,
  runMatrix,
  type Scenario,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
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
  },
  {
    name: "task-edit",
    description: "Generated edit screen",
    flow: open("/task-edit"),
    waitFor: RENDER_MARKERS,
  },
];

runMatrix(SCENARIOS, {
  themes: DEFAULT_THEMES,
  applyTheme: applyDefaultTheme,
  locales: ["en"],
});
