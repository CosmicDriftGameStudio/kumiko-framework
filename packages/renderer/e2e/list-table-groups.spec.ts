// Server-side groups, totals row and number range facet against the
// MockDispatcher, whose `aggregate` answer covers every fixture row: each
// header count and sum below is more than one page could have summed.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
import { EXPENSE_ROWS, expenseSum } from "./fixtures/expense-fixture";
import type { MockQueryLogEntry } from "./fixtures/mock-list-query";

const ANNA = { id: "anna", tenantId: "tenant-1" };

function euro(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function boot(page: Page): Promise<void> {
  await page.addInitScript(
    ({ seed, who }) => {
      const target: Window & { __E2E_SEED__?: unknown; __E2E_IDENTITY__?: unknown } = window;
      target.__E2E_SEED__ = seed;
      target.__E2E_IDENTITY__ = who;
    },
    { seed: { expense: EXPENSE_ROWS }, who: ANNA },
  );
}

async function queriesFor(page: Page, groupValue: string): Promise<number> {
  const log: readonly MockQueryLogEntry[] = await page.evaluate(() => {
    const entries: unknown = Reflect.get(globalThis, "__E2E_QUERIES__");
    return Array.isArray(entries) ? entries : [];
  });
  const needle = `"value":"${groupValue}"`;
  return log.filter((entry) => !entry.aggregate && entry.filters.includes(needle)).length;
}

const MODES = [
  { name: "pages", grouped: "/expense-list", ledger: "/expense-ledger" },
  { name: "infinite", grouped: "/expense-feed", ledger: "/expense-ledger-feed" },
] as const;

for (const mode of MODES) {
  test.describe(`server groups (${mode.name})`, () => {
    test.beforeEach(async ({ page }) => {
      await boot(page);
    });

    test("headers carry the server count and sum across all pages; no global pager", async ({
      page,
    }) => {
      await page.goto(mode.grouped);
      for (const [status, count] of [
        ["open", 12],
        ["approved", 7],
        ["paid", 9],
      ] as const) {
        await expect(page.getByTestId(`row-group-${status}-count`)).toHaveText(String(count));
        await expect(page.getByTestId(`row-group-${status}-sum-amount`)).toContainText(
          euro(expenseSum((row) => row.status === status)),
        );
      }
      await expect(page.locator('[data-testid$="-pager"]')).toHaveCount(0);
      await expect(page.getByTestId("list-totals-amount")).toContainText(
        euro(expenseSum(() => true)),
      );
    });

    test("a collapsed group sends no query until it opens; collapsing sends none", async ({
      page,
    }) => {
      await page.goto(mode.grouped);
      await expect(page.getByTestId("row-group-paid-toggle")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(page.getByText("5 of 12")).toBeVisible();
      expect(await queriesFor(page, "paid")).toBe(0);

      await page.getByTestId("row-group-paid-toggle").click();
      await expect.poll(() => queriesFor(page, "paid")).toBe(1);

      const approvedBefore = await queriesFor(page, "approved");
      await page.getByTestId("row-group-approved-toggle").click();
      await expect(page.getByTestId("row-group-approved-toggle")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(await queriesFor(page, "approved")).toBe(approvedBefore);
    });

    test("loading more inside a group keeps its sum", async ({ page }) => {
      await page.goto(mode.grouped);
      const sum = page.getByTestId("row-group-open-sum-amount");
      const openSum = euro(expenseSum((row) => row.status === "open"));
      await expect(sum).toContainText(openSum);
      await expect(page.getByText("5 of 12")).toBeVisible();
      await page.getByTestId("row-group-open-load-more").click();
      await expect(page.getByText("10 of 12")).toBeVisible();
      await expect(sum).toContainText(openSum);
    });
  });

  test.describe(`totals and range facet (${mode.name})`, () => {
    test.beforeEach(async ({ page }) => {
      await boot(page);
    });

    test("the totals row stays the same while the list pages", async ({ page }) => {
      await page.goto(mode.ledger);
      const totals = page.getByTestId("list-totals-amount");
      const all = euro(expenseSum(() => true));
      await expect(totals).toContainText(all);
      const rows = page.locator("tbody tr");
      if (mode.name === "pages") {
        await expect(rows).toHaveCount(5);
        const firstBefore = await rows.first().textContent();
        await page.locator('[data-testid$="-pager-next"]').click();
        await expect(rows.first()).not.toHaveText(firstBefore ?? "");
      } else {
        // The sentinel keeps loading while it is in view, so scrolling reaches the last row.
        await expect
          .poll(async () => {
            await page.locator('[data-testid$="-sentinel"]').scrollIntoViewIfNeeded();
            return rows.count();
          })
          .toBe(EXPENSE_ROWS.length);
      }
      await expect(totals).toContainText(all);
    });

    test("an amount from/to narrows rows and sum and lands in the URL", async ({ page }) => {
      await page.goto(mode.ledger);
      const min = page.getByTestId("facet-range-amount-min");
      const max = page.getByTestId("facet-range-amount-max");
      await min.fill("100");
      await min.blur();
      await max.fill("150");
      await max.blur();
      const id = mode.ledger.slice(1);
      await expect(page).toHaveURL(new RegExp(`${id}\\.f\\.amount\\.min=100`));
      await expect(page).toHaveURL(new RegExp(`${id}\\.f\\.amount\\.max=150`));
      const kept = (row: (typeof EXPENSE_ROWS)[number]): boolean =>
        row.amount.amount >= 100 && row.amount.amount <= 150;
      await expect(page.getByTestId("list-totals-amount")).toContainText(euro(expenseSum(kept)));
      await expect(page.locator("tbody tr")).toHaveCount(EXPENSE_ROWS.filter(kept).length);
    });
  });
}
