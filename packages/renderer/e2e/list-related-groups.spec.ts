// Server-side grouping inside an expanded row and on a bulk list with totals
// and a pinned column, against the MockDispatcher's aggregate answer.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
import { expenseSum } from "./fixtures/expense-fixture";
import {
  REPORT_EXPENSE_ROWS,
  REPORT_ROWS,
  reportExpenseCount,
} from "./fixtures/expense-report-fixture";
import type { MockQueryLogEntry } from "./fixtures/mock-list-query";

function euro(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function boot(page: Page): Promise<void> {
  await page.addInitScript(
    ({ seed }) => {
      const target: Window & { __E2E_SEED__?: unknown; __E2E_IDENTITY__?: unknown } = window;
      target.__E2E_SEED__ = seed;
      target.__E2E_IDENTITY__ = { id: "anna", tenantId: "tenant-1" };
    },
    { seed: { expense: REPORT_EXPENSE_ROWS, report: REPORT_ROWS } },
  );
}

async function aggregateGroupings(page: Page): Promise<readonly MockQueryLogEntry[]> {
  const entries = await page.evaluate(() => {
    const log: unknown = Reflect.get(globalThis, "__E2E_QUERIES__");
    return Array.isArray(log) ? log : [];
  });
  return entries.filter(
    (entry: MockQueryLogEntry) => entry.aggregate && entry.groupBy === "status",
  );
}

test.describe("expandableRow grouped through table.grouping", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test("each expanded report shows server counts for its own expenses", async ({ page }) => {
    await page.goto("/report-list");
    for (const report of REPORT_ROWS) {
      await page.getByTestId(`row-${report.id}-toggle`).click();
    }
    for (const report of REPORT_ROWS) {
      const expansion = page.getByTestId(`row-${report.id}-expansion`);
      for (const status of ["open", "approved", "paid"]) {
        await expect(expansion.getByTestId(`row-group-${status}-count`)).toHaveText(
          String(reportExpenseCount(report.id, status)),
        );
      }
      await expect(expansion.getByTestId("row-group-paid-toggle")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    }
    // Report A has more open expenses than one page; only the server count knows the rest.
    const openA = reportExpenseCount("rep-a", "open");
    await expect(page.getByTestId("row-rep-a-expansion").getByText(`5 of ${openA}`)).toBeVisible();
    expect((await aggregateGroupings(page)).length).toBeGreaterThanOrEqual(REPORT_ROWS.length);
  });

  test("opening a group in one report leaves the other report's group closed", async ({ page }) => {
    await page.goto("/report-list");
    for (const report of REPORT_ROWS) {
      await page.getByTestId(`row-${report.id}-toggle`).click();
    }
    const paidA = page.getByTestId("row-rep-a-expansion").getByTestId("row-group-paid-toggle");
    const paidB = page.getByTestId("row-rep-b-expansion").getByTestId("row-group-paid-toggle");
    await paidA.click();
    await expect(paidA).toHaveAttribute("aria-expanded", "true");
    await expect(paidB).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("grouped bulk list with totals and a pinned column", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test("groups, totals and checkboxes line up; the totals cell under the checkbox sticks", async ({
    page,
  }) => {
    await page.goto("/expense-bulk");
    await expect(page.getByTestId("row-group-open-count")).toHaveText("12");
    await expect(page.getByTestId("list-totals-amount")).toContainText(
      euro(expenseSum(() => true)),
    );
    const totalsSelectCell = page.getByTestId("list-totals-__select");
    await expect(totalsSelectCell).toHaveCSS("position", "sticky");
    await expect(totalsSelectCell).toHaveCSS("left", "0px");

    const firstCheckbox = page.locator('tbody [data-testid$="-select"]').first();
    await firstCheckbox.click();
    await expect(page.getByTestId("bulk-selected-count")).toHaveText("1 selected");
    await page.getByTestId("bulk-action-archive").click();
    await expect(page.getByTestId("bulk-result-succeeded")).toHaveText("Succeeded: 1");
    await expect(page.getByTestId("row-group-open-count")).toHaveText("12");
  });
});
