// Bulk actions on an entityList: row checkboxes, the selection bar, one write per row,
// the result banner, cancel and Space selection. The mock answers each write on its own.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";

const SEED = {
  task: [
    { id: "task-1", title: "Write the quarterly report", owner: "Anna" },
    { id: "task-2", title: "File taxes", owner: "Ben" },
    { id: "task-3", title: "Plan the offsite", owner: "Cleo" },
    { id: "task-4", title: "Renew the lease", owner: "Dana" },
    { id: "task-5", title: "Order new laptops", owner: "Emil" },
    { id: "task-6", title: "Close the old account", owner: "Fay", archived: true },
  ],
};

type WriteControls = {
  readonly rejectWriteIds?: readonly string[];
  readonly holdWrites?: boolean;
};

async function openBulkList(page: Page, controls: WriteControls = {}): Promise<void> {
  await page.addInitScript(
    ({ seed, rejectWriteIds, holdWrites }) => {
      const target: Window & {
        __E2E_SEED__?: unknown;
        __E2E_IDENTITY__?: unknown;
        __E2E_REJECT_WRITE_IDS__?: readonly string[];
        __E2E_HOLD_WRITES__?: boolean;
      } = window;
      target.__E2E_SEED__ = seed;
      target.__E2E_IDENTITY__ = { id: "anna", tenantId: "tenant-1" };
      if (rejectWriteIds !== undefined) target.__E2E_REJECT_WRITE_IDS__ = rejectWriteIds;
      target.__E2E_HOLD_WRITES__ = holdWrites === true;
    },
    { seed: SEED, ...controls },
  );
  await page.goto("/task-bulk");
  await expect(page.getByText("Write the quarterly report")).toBeVisible();
}

function writeLog(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const source: Window & { __E2E_WRITE_LOG__?: readonly string[] } = window;
    return [...(source.__E2E_WRITE_LOG__ ?? [])];
  });
}

async function select(page: Page, ...taskIds: readonly string[]): Promise<void> {
  for (const id of taskIds) await page.getByTestId(`row-${id}-select`).click();
}

function selectBox(page: Page, taskId: string) {
  return page.getByTestId(`row-${taskId}-select`);
}

test.describe("list bulk actions", () => {
  test.use({ viewport: { width: 1100, height: 800 } });

  test("archiving three selected rows writes each once, reports 3 and reloads the list", async ({
    page,
  }, testInfo) => {
    await openBulkList(page);
    await select(page, "task-1", "task-2", "task-3");
    await expect(page.getByTestId("bulk-selected-count")).toHaveText("3 selected");
    await expect(page).toHaveURL(/task-bulk/);
    await page.screenshot({ path: testInfo.outputPath("bulk-selection-bar.png") });

    await page.getByTestId("bulk-action-archive").click();
    await expect(page.getByTestId("bulk-result-succeeded")).toHaveText("Succeeded: 3");
    expect(await writeLog(page)).toEqual(["archive:task-1", "archive:task-2", "archive:task-3"]);
    await expect(selectBox(page, "task-1")).toHaveAttribute("data-state", "unchecked");

    // The reloaded rows carry archived: true, so the row action's `visible` now skips them.
    await select(page, "task-1");
    await page.getByTestId("bulk-action-archive").click();
    await expect(page.getByTestId("bulk-result-skipped")).toHaveText("Skipped: 1");
    expect(await writeLog(page)).toHaveLength(3);
  });

  test("a rejected row is counted as failed and stays selected", async ({ page }, testInfo) => {
    await openBulkList(page, { rejectWriteIds: ["task-2"] });
    await select(page, "task-1", "task-2", "task-3", "task-6");
    await page.getByTestId("bulk-action-archive").click();

    await expect(page.getByTestId("bulk-result")).toHaveAttribute("data-variant", "warning");
    await expect(page.getByTestId("bulk-result-succeeded")).toHaveText("Succeeded: 2");
    await expect(page.getByTestId("bulk-result-failed")).toHaveText("Failed: 1");
    await expect(page.getByTestId("bulk-result-skipped")).toHaveText("Skipped: 1");
    await expect(page.getByTestId("bulk-result-error")).toHaveText("No access to task-2.");
    await expect(selectBox(page, "task-2")).toHaveAttribute("data-state", "checked");
    for (const id of ["task-1", "task-3", "task-6"]) {
      await expect(selectBox(page, id)).toHaveAttribute("data-state", "unchecked");
    }
    await expect(page.getByTestId("bulk-selected-count")).toHaveText("1 selected");
    await page.screenshot({ path: testInfo.outputPath("bulk-result-partial.png") });
  });

  test("cancel lets running writes finish and starts no new ones", async ({ page }) => {
    await openBulkList(page, { holdWrites: true });
    await page.getByTestId("select-all").click();
    await expect(page.getByTestId("bulk-selected-count")).toHaveText("6 selected");
    await page.getByTestId("bulk-action-archive").click();

    await expect(page.getByTestId("bulk-progress")).toHaveText("0 of 5 done");
    await expect.poll(() => writeLog(page)).toHaveLength(4);
    await page.getByTestId("bulk-cancel").click();
    await expect(page.getByTestId("bulk-cancel")).toBeDisabled();
    await page.evaluate(() => {
      const source: Window & { __E2E_RELEASE_WRITES__?: () => void } = window;
      source.__E2E_RELEASE_WRITES__?.();
    });

    await expect(page.getByTestId("bulk-result-succeeded")).toHaveText("Succeeded: 4");
    await expect(page.getByTestId("bulk-result-not-started")).toHaveText("Not run: 1");
    await expect(page.getByTestId("bulk-result-skipped")).toHaveText("Skipped: 1");
    expect(await writeLog(page)).toHaveLength(4);
    await expect(selectBox(page, "task-5")).toHaveAttribute("data-state", "checked");
  });

  test("Space selects the focused row", async ({ page }) => {
    await openBulkList(page);
    await page.getByTestId("row-task-2").focus();
    await page.keyboard.press("Space");
    await expect(selectBox(page, "task-2")).toHaveAttribute("data-state", "checked");
    await expect(page.getByTestId("bulk-selected-count")).toHaveText("1 selected");
    await expect(page).toHaveURL(/task-bulk/);
  });
});

test.describe("list bulk actions on a phone", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("every card carries a checkbox that selects the row without opening it", async ({
    page,
  }, testInfo) => {
    await openBulkList(page);
    await expect(page.getByTestId("render-list-table-cards")).toBeVisible();
    await select(page, "task-1", "task-3");
    await expect(page.getByTestId("bulk-selected-count")).toHaveText("2 selected");
    await expect(page).toHaveURL(/task-bulk/);
    await page.screenshot({ path: testInfo.outputPath("bulk-card-layout.png") });
  });
});
