// @runtime test
// Assert-E2E for the tenant "Email sending" screen: provider choice, SMTP
// settings and the write-only SMTP password share one form and one save.
// provider-form-save.integration.test.ts proves the /api/batch atomicity;
// this spec proves the browser wiring on top of it, as a plain TenantAdmin.
//
// run-config.ts mounts the in-memory transport too, so the two-option choice also
// proves selectableInSettings:false keeps the test inbox out of it.

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

  const providerChoice = page.getByRole("radiogroup", { name: "Send via" });
  await expect(providerChoice.getByRole("radio")).toHaveCount(2);
  await expect(
    providerChoice.getByRole("radio", { name: "Platform sending (default)" }),
  ).toBeChecked();
  await expect(page.getByText("Test inbox (in memory)")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Server address", exact: true })).toHaveCount(0);

  await providerChoice.getByRole("radio", { name: "Own SMTP server" }).click();
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
  await expect(page.getByText("•••••••••• set")).toBeVisible();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  const passwordField = page.getByRole("textbox", { name: "SMTP password", exact: true });
  await expect(passwordField).toHaveValue("");
  await expect(passwordField).toHaveAttribute("placeholder", "Set — leave empty to keep it");

  await expect(providerChoice.getByRole("radio", { name: "Own SMTP server" })).toBeChecked();

  await captureScreenshot(page, "e2e-tenant-mail-provider-form/saved");
});

test("TenantAdmin can go back to the platform default, which hides the SMTP fields", async ({
  page,
  seedTenant,
}) => {
  await page.addInitScript(() => localStorage.setItem("kumiko:locale", "en"));
  const tenant = await seedTenant();
  await tenant.loginAs(page, tenant.admin);
  await page.goto(MAIL_SETTINGS_PATH);

  const providerChoice = page.getByRole("radiogroup", { name: "Send via" });
  const serverAddress = page.getByRole("textbox", { name: "Server address", exact: true });
  await providerChoice.getByRole("radio", { name: "Own SMTP server" }).click();
  await serverAddress.fill("smtp.postmarkapp.com");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("No unsaved changes")).toBeVisible();

  await providerChoice.getByRole("radio", { name: "Platform sending (default)" }).click();
  await expect(serverAddress).toHaveCount(0);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("No unsaved changes")).toBeVisible();

  await page.reload();
  await expect(
    page
      .getByRole("radiogroup", { name: "Send via" })
      .getByRole("radio", { name: "Platform sending (default)" }),
  ).toBeChecked();
  await expect(serverAddress).toHaveCount(0);
});

test("German tenant mail screen renders as a standard settings form", async ({
  page,
  seedTenant,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => localStorage.setItem("kumiko:locale", "de"));
  const tenant = await seedTenant();
  await tenant.loginAs(page, tenant.admin);
  await page.goto(MAIL_SETTINGS_PATH);
  const providerChoice = page.getByRole("radiogroup", { name: "Versand über" });
  await expect(
    providerChoice.getByRole("radio", { name: "Plattform-Versand (Standard)" }),
  ).toBeVisible();
  await captureScreenshot(page, "e2e-tenant-mail-provider-form/de-desktop");

  await providerChoice.getByRole("radio", { name: "Eigener SMTP-Server" }).click();
  await expect(page.getByRole("textbox", { name: "Serveradresse", exact: true })).toBeVisible();
  await captureScreenshot(page, "e2e-tenant-mail-provider-form/de-desktop-smtp");
});
