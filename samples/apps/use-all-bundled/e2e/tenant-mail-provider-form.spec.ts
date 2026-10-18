// @runtime test
// Assert-E2E for the tenant "Email sending" screen: provider choice, SMTP
// settings and the write-only SMTP password share one form and one save.
// provider-form-save.integration.test.ts proves the /api/batch atomicity;
// this spec proves the browser wiring on top of it, as a plain TenantAdmin.
//
// run-config.ts mounts the in-memory transport too, so the single radio also
// proves selectableInSettings:false keeps the test inbox out of the choice.

import { captureScreenshot, expect, test } from "@cosmicdrift/kumiko-testing/e2e";

const MAIL_SETTINGS_PATH = "/settings/mail-foundation-tenant";

test("TenantAdmin stores provider, SMTP settings and password with one save", async ({
  page,
  seedTenant,
}) => {
  await page.addInitScript(() => localStorage.setItem("kumiko:locale", "en"));
  const tenant = await seedTenant();
  await tenant.loginAs(page, tenant.admin);
  await page.goto(MAIL_SETTINGS_PATH);

  const providerChoice = page.getByRole("radiogroup", { name: "Own mail server" });
  await expect(providerChoice.getByRole("radio")).toHaveCount(1);
  await expect(providerChoice.getByRole("radio", { name: "SMTP server" })).toBeVisible();
  await expect(page.getByText("Test inbox (in memory)")).toHaveCount(0);

  await providerChoice.getByRole("radio", { name: "SMTP server" }).click();
  await page
    .getByRole("textbox", { name: "Server address", exact: true })
    .fill("smtp.postmarkapp.com");
  await page.getByRole("textbox", { name: "User name", exact: true }).fill("pm-server-token");
  await page
    .getByRole("textbox", { name: "Sender address", exact: true })
    .fill("status@northwind-cloud.com");
  await page
    .getByRole("textbox", { name: "SMTP password", exact: true })
    .fill("pm-demo-password-1234");

  const saveButton = page.getByRole("button", { name: "Save changes" });
  await expect(saveButton).toHaveCount(1);
  await saveButton.click();
  await expect(page.getByText("No unsaved changes")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Server address", exact: true })).toHaveValue(
    "smtp.postmarkapp.com",
  );
  await expect(page.getByRole("textbox", { name: "Sender address", exact: true })).toHaveValue(
    "status@northwind-cloud.com",
  );
  const passwordField = page.getByRole("textbox", { name: "SMTP password", exact: true });
  await expect(passwordField).toHaveValue("");
  await expect(passwordField).toHaveAttribute("placeholder", "Set — leave empty to keep it");

  await captureScreenshot(page, "e2e-tenant-mail-provider-form/saved");
});
