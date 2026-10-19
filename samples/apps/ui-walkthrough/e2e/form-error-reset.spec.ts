// @runtime test
import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import { loginAsAdmin } from "./_helpers/login";

const LEASE_DETAIL_URL = "/lease-detail/00000000-0000-4000-8000-000000003103";
const FIELD_ERROR = "Gültig bis darf nicht vor Gültig von liegen.";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 900 } });

test("a server field error and the form banner disappear once the field is corrected, then the save succeeds", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto(LEASE_DETAIL_URL);
  await page.getByRole("tab", { name: "Positionen" }).click();
  await page.getByText("Position hinzufügen").click();

  await page.getByTestId("field-art").locator("input").fill("Stellplatz");
  await page.getByTestId("field-betrag").locator("input").fill("45");
  await page.getByTestId("field-gueltigVon").locator("input").fill("01.10.2026");
  await page.getByTestId("field-gueltigBis").locator("input").fill("01.09.2026");
  await page.getByTestId("render-edit-submit").click();

  await expect(page.getByText(FIELD_ERROR)).toBeVisible();
  await expect(page.getByTestId("render-edit-form-error")).toBeVisible();
  await captureScreenshot(page, "after-6-before-edit");

  await page.getByTestId("field-gueltigBis").locator("input").fill("30.09.2027");
  await expect(page.getByText(FIELD_ERROR)).toHaveCount(0);
  await expect(page.getByTestId("render-edit-form-error")).toHaveCount(0);
  await captureScreenshot(page, "after-6-banner");

  await page.getByTestId("render-edit-submit").click();
  await page.getByRole("tab", { name: "Positionen" }).click();
  await expect(page.getByText("Stellplatz")).toBeVisible();
});
