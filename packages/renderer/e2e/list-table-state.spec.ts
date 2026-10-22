// Remembered list state, reset, view menu and density of a list with a
// `table` block, against the MockDispatcher (which ignores the search, so
// the specs assert the list's controls and URL, not searched rows).

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";

type Identity = { readonly id: string; readonly tenantId: string };

const ANNA: Identity = { id: "anna", tenantId: "tenant-1" };
const LIST_PATH = "/task-list";

const SEED = {
  task: [
    { id: "task-1", title: "Write report", owner: "Anna", priority: "high", estimate: 5 },
    { id: "task-2", title: "File taxes", owner: "Ben", priority: "low", estimate: 3 },
    { id: "task-3", title: "Plan offsite", owner: "Cleo", priority: "medium", estimate: 8 },
  ],
};

async function bootAs(page: Page, identity: Identity | undefined): Promise<void> {
  await page.addInitScript(
    ({ seed, who }) => {
      const target: Window & { __E2E_SEED__?: unknown; __E2E_IDENTITY__?: unknown } = window;
      // Only the first document of the test seeds; later navigations keep the in-memory rows.
      target.__E2E_SEED__ = seed;
      if (who !== undefined) target.__E2E_IDENTITY__ = who;
    },
    { seed: SEED, who: identity },
  );
}

async function openList(page: Page, path: string = LIST_PATH): Promise<void> {
  await page.goto(path);
  await expect(page.getByText("Write report")).toBeVisible();
}

async function chooseHighPriority(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Priority" }).click();
  await page.getByRole("menuitemcheckbox", { name: "high" }).click();
  await page.keyboard.press("Escape");
}

async function searchFor(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder("Search…").fill(text);
}

async function openViewMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "View", exact: true }).click();
}

test.describe("remembered list state", () => {
  test.beforeEach(async ({ page }) => {
    await bootAs(page, ANNA);
  });

  test("filter and search survive a detour through a record, via nav link and via reload", async ({
    page,
  }) => {
    await openList(page);
    await chooseHighPriority(page);
    await searchFor(page, "report");
    await expect(page).toHaveURL(/task-list\.q=report/);

    await page.getByText("Write report").click();
    await expect(page.getByRole("textbox", { name: "Title" })).toBeVisible();

    await page.getByRole("link", { name: "Tasks" }).click();
    await expect(page.getByPlaceholder("Search…")).toHaveValue("report");
    await expect(page.getByRole("button", { name: "Priority" })).toContainText("1");

    await page.goto(LIST_PATH);
    await expect(page.getByPlaceholder("Search…")).toHaveValue("report");
    await expect(page.getByRole("button", { name: "Priority" })).toContainText("1");
  });

  test("a link with parameters wins over the remembered state", async ({ page }) => {
    await openList(page);
    await searchFor(page, "report");
    await expect(page).toHaveURL(/task-list\.q=report/);

    await page.goto(`${LIST_PATH}?task-list.q=taxes`);
    await expect(page.getByPlaceholder("Search…")).toHaveValue("taxes");
  });

  test("the reset button appears only on deviation and resets search and sort", async ({
    page,
  }) => {
    await openList(page);
    const reset = page.getByRole("button", { name: "Reset", exact: true });
    await expect(reset).toHaveCount(0);

    await searchFor(page, "report");
    await expect(page).toHaveURL(/task-list\.q=report/);
    await page.getByRole("button", { name: "Owner" }).click();
    await expect(page.getByRole("columnheader", { name: "Owner" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await expect(reset).toBeVisible();

    await reset.click();
    await expect(page.getByPlaceholder("Search…")).toHaveValue("");
    await expect(page.getByRole("columnheader", { name: "Owner" })).toHaveAttribute(
      "aria-sort",
      "none",
    );
    await expect(page.getByRole("columnheader", { name: "Title" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await expect(reset).toHaveCount(0);
  });
});

test.describe("view menu", () => {
  test.beforeEach(async ({ page }) => {
    await bootAs(page, ANNA);
  });

  function headerNames(page: Page): Promise<string[]> {
    return page
      .getByRole("columnheader")
      .allInnerTexts()
      .then((texts) => texts.filter((text) => text !== ""));
  }

  test("hidden and reordered columns survive navigation and reload, reset restores them", async ({
    page,
  }) => {
    await openList(page);
    expect(await headerNames(page)).toEqual(["Title", "Owner", "Priority", "Estimate"]);

    await openViewMenu(page);
    await page.getByRole("checkbox", { name: "Owner" }).uncheck();
    await page.getByRole("button", { name: "Move Estimate up" }).click();
    await page.keyboard.press("Escape");
    expect(await headerNames(page)).toEqual(["Title", "Estimate", "Priority"]);

    await page.getByRole("link", { name: "Tasks" }).click();
    await expect.poll(() => headerNames(page)).toEqual(["Title", "Estimate", "Priority"]);

    await page.reload();
    await expect(page.getByText("Write report")).toBeVisible();
    expect(await headerNames(page)).toEqual(["Title", "Estimate", "Priority"]);

    await openViewMenu(page);
    await page.getByRole("button", { name: "Reset view" }).click();
    await page.keyboard.press("Escape");
    expect(await headerNames(page)).toEqual(["Title", "Owner", "Priority", "Estimate"]);
  });

  test("compact density sets the row height to 32px", async ({ page }) => {
    await openList(page);
    const row = page.getByRole("row", { name: /Write report/ });
    const comfortableHeight = (await row.boundingBox())?.height ?? 0;
    expect(comfortableHeight).toBeGreaterThan(32);

    await openViewMenu(page);
    await page.getByRole("radio", { name: "Compact" }).click();
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await row.boundingBox())?.height).toBe(32);
  });
});

test.describe("identity scoping", () => {
  test("losing the identity empties the remembered state", async ({ page }) => {
    await bootAs(page, ANNA);
    await openList(page);
    await searchFor(page, "report");
    await expect(page).toHaveURL(/task-list\.q=report/);

    await page.evaluate(() => {
      const setter: Window & { __e2eSetIdentity?: (identity: undefined) => void } = window;
      setter.__e2eSetIdentity?.(undefined);
    });

    await page.goto(LIST_PATH);
    await expect(page.getByPlaceholder("Search…")).toHaveValue("");
  });

  test("another tenant starts with an empty store", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await bootAs(page, ANNA);
    await openList(page);
    await searchFor(page, "report");
    await expect(page).toHaveURL(/task-list\.q=report/);

    // Same tab and sessionStorage, but the next document boots under another tenant.
    await page.addInitScript(
      (who) => {
        const target: Window & { __E2E_IDENTITY__?: unknown } = window;
        target.__E2E_IDENTITY__ = who;
      },
      { ...ANNA, tenantId: "tenant-2" },
    );
    await page.goto(LIST_PATH);
    await expect(page.getByText("Write report")).toBeVisible();
    await expect(page.getByPlaceholder("Search…")).toHaveValue("");
    await context.close();
  });
});
