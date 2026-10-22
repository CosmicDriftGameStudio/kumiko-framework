// The export button of a list with `table.export`: what it sends to
// POST /api/export/xlsx (answered by page.route; the MockDispatcher has no
// export endpoint) and how it reports a refused export.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import type { Page, Route } from "@playwright/test";

const ANNA = { id: "anna", tenantId: "tenant-1" };
const EXPORT_URL = "**/api/export/xlsx";

const SEED = {
  task: [
    { id: "task-1", title: "Write report", owner: "Anna", priority: "high", estimate: 5 },
    { id: "task-2", title: "File taxes", owner: "Ben", priority: "low", estimate: 3 },
  ],
};

async function openList(page: Page): Promise<void> {
  await page.addInitScript(
    ({ seed, who }) => {
      const target: Window & { __E2E_SEED__?: unknown; __E2E_IDENTITY__?: unknown } = window;
      target.__E2E_SEED__ = seed;
      target.__E2E_IDENTITY__ = who;
    },
    { seed: SEED, who: ANNA },
  );
  await page.goto("/task-list");
  await expect(page.getByText("Write report")).toBeVisible();
}

async function filterAndHideOwner(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Priority" }).click();
  await page.getByRole("menuitemcheckbox", { name: "high" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("checkbox", { name: "Owner" }).uncheck();
  await page.keyboard.press("Escape");
}

test("sends the screen, the filtered payload without paging and the visible columns", async ({
  page,
}) => {
  await openList(page);
  await filterAndHideOwner(page);

  let body: Record<string, unknown> | undefined;
  await page.route(EXPORT_URL, async (route: Route) => {
    body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      headers: { "Content-Disposition": 'attachment; filename="task-list.xlsx"' },
      body: "xlsx",
    });
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  expect((await download).suggestedFilename()).toMatch(/^task-list-\d{4}-\d{2}-\d{2}\.xlsx$/);

  expect(body?.["screen"]).toBe("test:screen:task-list");
  expect(body?.["columns"]).toEqual(["title", "priority", "estimate"]);
  expect(typeof body?.["timeZone"]).toBe("string");
  const payload = body?.["payload"] as Record<string, unknown>;
  expect(payload["sort"]).toBe("title");
  expect(JSON.stringify(payload["filters"])).toContain("high");
  for (const key of ["limit", "offset", "cursor", "totalCount", "filter"]) {
    expect(payload).not.toHaveProperty(key);
  }
});

test("a refused export tells the user to narrow the filter", async ({ page }) => {
  await openList(page);
  await page.route(EXPORT_URL, (route) =>
    route.fulfill({
      status: 413,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "export_too_many_rows",
          httpStatus: 413,
          message: "too many",
          i18nKey: "kumiko.list.export-too-many",
          details: { maxRows: 5 },
        },
      }),
    }),
  );
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("status")).toContainText("More than 5 rows");
});
