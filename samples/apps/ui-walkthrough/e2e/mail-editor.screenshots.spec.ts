// @runtime test
// Screenshots of the mail editor for the design review. Runs only with
// SCREENSHOT_DIR set. Shows the seeded draft "Rechnung versendet" (Board 2/3);
// mail-editor.spec.ts walks its own draft "Korrigierte Rechnung", so nothing
// here depends on spec order. No test mail is sent from this spec.

import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
import { TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD } from "../src/app/auth-constants";
import { loginAs } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1280, height: 820 } });
test.describe.configure({ mode: "serial" });

const EDITOR_URL = `/mail-editor?kind=mail&slug=${encodeURIComponent("billing:notify:invoice-issued")}`;

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await captureScreenshot(page, name);
}

// The shell header gets the title only what the actions leave over: a clipped h1 is a layout bug.
async function expectTitleFits(page: Page): Promise<void> {
  const title = page.locator('[data-kumiko-layout="shell-header"] h1');
  await expect(title).toBeVisible();
  const fits = await title.evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(fits).toBe(true);
}

async function openEditor(page: Page): Promise<void> {
  await loginAs(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  await page.goto(EDITOR_URL);
  await expect(page.locator('[data-kumiko-layout="shell-header"] h1')).toContainText(
    "Rechnung versendet",
  );
  await expect(page.getByTestId("mail-placeholder-dueDate")).toHaveAttribute("data-bad", "true");
}

test("mail-editor-edit", async ({ page }) => {
  await openEditor(page);
  // The seeded draft carries the invoice PDF as resource.
  await expect(page.getByTestId("mail-resource-row")).toHaveCount(1);
  await expectTitleFits(page);
  // The upload scrolled the left rail down; the shot shows it from its top, with one block selected.
  await page.evaluate(() => {
    for (const rail of document.querySelectorAll("aside")) rail.scrollTo(0, 0);
  });
  await page.locator("a[data-button]").first().click();
  await expect(page.getByTestId("document-block-options")).toBeVisible();
  await shot(page, "mail-editor-edit");
});

test("mail-editor-preview", async ({ page }) => {
  await openEditor(page);
  await page.getByTestId("mail-mode-switch").getByText("Vorschau", { exact: true }).click();
  await expect(page.getByTestId("mail-preview-iframe")).toBeVisible();
  await expect(page.getByTestId("mail-preview-checks")).toBeVisible();
  await shot(page, "mail-editor-preview");
});

// Nothing is saved: the preview renders the unsaved draft, so the seeded template stays as it is.
test("mail-editor-chrome-rail", async ({ page }) => {
  await openEditor(page);
  const chrome = page.getByTestId("mail-editor-chrome");
  await chrome.scrollIntoViewIfNeeded();
  // The seeded draft takes header label and tone from placeholders; the rail names them by label only.
  await expect(page.getByTestId("mail-header-chip")).toContainText("Kennzeichen der Rechnung");
  await expect(page.getByTestId("combobox-mail-tone")).toContainText(
    "Aus Platzhalter: Farbe der Meldung (success, warning oder danger)",
  );
  const note = page.locator("#mail-footer-note[contenteditable='true']");
  await note.click();
  await page.keyboard.type("Sie erhalten diese Mail, weil Sie Kunde bei uns sind. ");
  await page.getByTestId("mail-placeholder-noticeLabel-insert").click();
  await expect(page.getByTestId("mail-footer-note")).toContainText("Kennzeichen der Rechnung");
  await expect(chrome).not.toContainText("noticeLabel");
  await expect(chrome).not.toContainText("noticeTone");
  await expect(chrome).not.toContainText("{{");
  await chrome.scrollIntoViewIfNeeded();
  await shot(page, "mail-editor-chrome-rail");

  await page.getByTestId("mail-mode-switch").getByText("Vorschau", { exact: true }).click();
  const preview = page.frameLocator('[data-testid="mail-preview-iframe"]');
  // The example of noticeLabel is an i18n key: the German template previews its German text.
  await expect(preview.getByText("Neue Rechnung").first()).toBeVisible();
  await expect(preview.getByText("weil Sie Kunde bei uns sind")).toBeVisible();
  await expect(preview.locator("body")).not.toContainText("New invoice");
  // The dev server's live-reload stream (/_reload) stays open, so networkidle does not come back once the
  // preview frame attaches here; the asserted preview text is the ready signal.
  await page.evaluate(() => document.fonts.ready);
  await captureScreenshot(page, "mail-editor-chrome-preview");
});

test("mail-editor-edit-en-missing", async ({ page }) => {
  await openEditor(page);
  await page.getByTestId("mail-locale-switch").getByText("en", { exact: true }).click();
  await expect(page.getByTestId("mail-origin-bar")).toHaveAttribute("data-variant", "warn");
  await expectTitleFits(page);
  await shot(page, "mail-editor-edit-en-missing");
});

// Saving an edit of the served "Zahlungserinnerung" leaves it active and opens a newer draft beside it.
test("mail-editor-draft-beside-active", async ({ page }) => {
  await loginAs(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  await page.goto("/templates");
  const row = page.getByRole("row").filter({ hasText: "Zahlungserinnerung" });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Bearbeiten" }).click();
  await expect(page.getByTestId("document-designer-editor-status")).toContainText("Aktiv");

  const subject = page.locator("#mail-subject[contenteditable='true']");
  await expect(subject).toBeVisible();
  await subject.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" (freundlicher)");
  await page.getByTestId("document-designer-save").click();
  await expect(page.getByTestId("document-designer-editor-status")).toContainText("Entwurf");
  await expect(page.getByTestId("document-designer-editor-active-status")).toHaveCount(0);
  await expect(page.getByTestId("mail-origin-bar")).toContainText(
    "Verschickt wird Version 1, dein Entwurf (Version 2) ist noch nicht veröffentlicht.",
  );
  await expectTitleFits(page);
  await shot(page, "mail-editor-draft-beside-active");

  await page.goto("/templates");
  await expect(
    page.getByRole("row").filter({ hasText: "Zahlungserinnerung" }).getByText("Entwurf"),
  ).toBeVisible();
  await shot(page, "document-designer-overview-draft-beside-active");
});
