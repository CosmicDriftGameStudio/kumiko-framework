// The orders work queue: named filters in one select with hit counts, a filter-owned sort,
// a filter-owned empty state with a reset button, and the totals footer.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";

const FILTER_FACET = "facet-__namedFilter";

test("picking a named filter narrows the list and sorts it by the filter's own order", async ({
  page,
}) => {
  await page.goto("/orders");
  await expect(page.getByText("SO-10483")).toBeVisible();

  await page.getByTestId(FILTER_FACET).click();
  await expect(page.getByTestId(`${FILTER_FACET}-action-needed`)).toContainText("5");
  await page.getByTestId(`${FILTER_FACET}-action-needed`).click();

  await expect(page.getByText("SO-10483")).toHaveCount(0);
  const rowTexts = await page.locator("tbody tr").allInnerTexts();
  const orderNumbers = rowTexts.map((text) => /SO-\d+/.exec(text)?.[0]);
  expect(orderNumbers).toEqual(["SO-10482", "SO-10488", "SO-10484", "SO-10485", "SO-10486"]);
});

test("a filter without hits shows its own empty state, and its reset button brings the list back", async ({
  page,
}) => {
  await page.goto("/orders");
  await page.getByTestId(FILTER_FACET).click();
  await page.getByTestId(`${FILTER_FACET}-reminder-due`).click();

  await expect(page.getByTestId("render-list-empty-reset-filter")).toBeVisible();
  await expect(page.getByText("SO-10482")).toHaveCount(0);

  await page.getByTestId("render-list-empty-reset-filter").click();
  await expect(page.getByText("SO-10482")).toBeVisible();
  await expect(page.getByTestId("render-list-empty-reset-filter")).toHaveCount(0);
});

test("the footer totals the open amount over the whole list", async ({ page }) => {
  await page.goto("/orders");
  await expect(page.getByTestId("list-totals")).toBeVisible();
  await expect(page.getByTestId("list-totals")).toContainText("2497");
});

test("the sort select reorders the list by the chosen option", async ({ page }) => {
  await page.goto("/orders");
  const select = page.getByTestId("render-list-table-sort-options");
  await expect(page.getByTestId("render-list-table-sort-options-label")).toContainText("Sorted by");
  await select.selectOption({ label: "Customer A-Z" });
  await expect(page.getByTestId("render-list-table-sort-options-label")).toContainText(
    "Customer A-Z",
  );
  const rowTexts = await page.locator("tbody tr").allInnerTexts();
  const customers = rowTexts.map(
    (text) => /Aiko|Emma|Jonas|Kenji|Lars|Maria|Priya|Tom/.exec(text)?.[0],
  );
  expect(customers).toEqual([...customers].sort());
});

test("the summary row follows the filter", async ({ page }) => {
  await page.goto("/orders");
  await expect(page.getByTestId("list-summary")).toContainText("Orders 8");
  await page.getByTestId(FILTER_FACET).click();
  await page.getByTestId(`${FILTER_FACET}-action-needed`).click();
  await expect(page.getByTestId("list-summary")).toContainText("Orders 5");
});

test("a stat tile on the dashboard links into the filtered list", async ({ page }) => {
  await page.goto("/today");
  await page.getByText("Need action").click();
  await expect(page).toHaveURL(/orders/);
  await expect(page.getByText("SO-10483")).toHaveCount(0);
});
