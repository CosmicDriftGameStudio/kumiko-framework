// @runtime test
import { EMPTY_VALUE_PLACEHOLDER } from "@cosmicdrift/kumiko-renderer/headless";
import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import { loginAsAdmin } from "./_helpers/login";

const PREDECESSOR_LEASE_ID = "00000000-0000-4000-8000-000000003101";
const SUCCESSOR_LEASE_ID = "00000000-0000-4000-8000-000000003112";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 900 } });

test("reference column links to the referenced lease and shows the placeholder when empty", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/lease-succession-list");
  const successorRow = page.getByTestId(`row-${SUCCESSOR_LEASE_ID}`);
  const link = successorRow.getByTestId(`cell-${SUCCESSOR_LEASE_ID}-vorgaenger`).locator("a");
  await expect(link).toHaveText("WE-42");
  await expect(link).toHaveAttribute("href", `/lease-detail-gaps/${PREDECESSOR_LEASE_ID}`);

  const emptyRow = page.getByTestId(`row-${PREDECESSOR_LEASE_ID}`);
  await expect(emptyRow.getByTestId(`cell-${PREDECESSOR_LEASE_ID}-vorgaenger`)).toHaveText(
    EMPTY_VALUE_PLACEHOLDER,
  );
  await expect(emptyRow.getByTestId(`cell-${PREDECESSOR_LEASE_ID}-ende`)).toHaveText(
    EMPTY_VALUE_PLACEHOLDER,
  );
  await link.hover();
  await captureScreenshot(page, "after-4-ref-list");
  await captureScreenshot(page, "after-5-empty");

  await link.click();
  await expect(page).toHaveURL(
    (url) => url.pathname === `/lease-detail-gaps/${PREDECESSOR_LEASE_ID}`,
  );
  await expect(page.getByText("Otto Freihand").first()).toBeVisible();
});

test("detail reference field links to the referenced lease", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`/lease-detail-gaps/${SUCCESSOR_LEASE_ID}`);
  await page.getByRole("tab", { name: "Vertragsdaten" }).click();
  const link = page.getByTestId("field-value-vorgaenger").locator("a");
  await expect(link).toHaveText("WE-42");
  await expect(link).toHaveAttribute("href", `/lease-detail-gaps/${PREDECESSOR_LEASE_ID}`);
  await link.hover();
  await captureScreenshot(page, "after-4-ref-detail");
  await link.click();
  await expect(page).toHaveURL(
    (url) => url.pathname === `/lease-detail-gaps/${PREDECESSOR_LEASE_ID}`,
  );
});
