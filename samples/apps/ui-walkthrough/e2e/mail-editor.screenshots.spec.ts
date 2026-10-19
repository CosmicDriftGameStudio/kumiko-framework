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

test("mail-editor-right-rail-fits", async ({ page }) => {
  await openEditor(page);
  const footerHint = page.locator("#mail-footer-note .is-editor-empty");
  await footerHint.scrollIntoViewIfNeeded();
  // The empty-field hint is a ::before box: it must end inside the field, cut with an ellipsis.
  const hintFits = await footerHint.evaluate((paragraph) => {
    const hint = getComputedStyle(paragraph, "::before");
    return parseFloat(hint.width) <= paragraph.clientWidth && hint.textOverflow === "ellipsis";
  });
  expect(hintFits).toBe(true);

  const addPdf = page.getByTestId("mail-attachment-pdf-open");
  await addPdf.scrollIntoViewIfNeeded();
  await shot(page, "mail-editor-right-rail-fits");
  // The rail has a fixed width and the German label just fits beside the heading; the French one
  // is longer and must wrap below it instead of being clipped.
  await addPdf.evaluate((button) => {
    button.textContent = "+ Pièce jointe issue d'un modèle PDF";
  });
  const addPdfFits = await addPdf.evaluate((button) => {
    const section = button.closest("section");
    if (section === null) return false;
    return (
      button.getBoundingClientRect().right <= section.getBoundingClientRect().right &&
      button.scrollWidth <= button.clientWidth
    );
  });
  expect(addPdfFits).toBe(true);
  await shot(page, "mail-editor-right-rail-long-action");
});

// This app has file storage and mail delivery; the answer of an app without them is stubbed.
test("mail-editor-without-files-and-mail", async ({ page }) => {
  await page.route("**/api/query", async (route) => {
    const body: unknown = route.request().postDataJSON();
    const type = typeof body === "object" && body !== null ? Reflect.get(body, "type") : undefined;
    if (type !== "template-resolver:query:editor-capabilities") return route.continue();
    return route.fulfill({ json: { data: { fileUploads: false, testMail: false } } });
  });
  await openEditor(page);
  await expect(page.getByTestId("mail-resource-uploads-unavailable")).toBeVisible();
  await expect(page.getByTestId("mail-resource-upload-open")).toHaveCount(0);
  await page.getByTestId("mail-resource-uploads-unavailable").scrollIntoViewIfNeeded();
  // The seeded file name has no spaces; it has to wrap inside its row, not run under "Entfernen".
  const resourceRow = page.getByTestId("mail-resource-row");
  const labelEndsBeforeAction = await resourceRow.evaluate((row) => {
    const action = row.querySelector("[data-testid^='mail-resource-remove-']");
    const label = row.querySelector("span.text-sm");
    if (action === null || label === null) return false;
    return label.getBoundingClientRect().right <= action.getBoundingClientRect().left;
  });
  expect(labelEndsBeforeAction).toBe(true);
  await shot(page, "mail-editor-without-files");
  await page.getByTestId("mail-mode-switch").getByText("Vorschau", { exact: true }).click();
  await expect(page.getByTestId("mail-test-unavailable")).toBeVisible();
  await expect(page.getByTestId("mail-test-send")).toHaveCount(0);
  const footerMessage = page.getByTestId("mail-editor-footer-message");
  await expect(footerMessage).toContainText("Veröffentlichen ist gesperrt");
  await expect(footerMessage).not.toContainText("Test-Mail");
  await expect(page.getByTestId("mail-preview-checks")).toBeVisible();
  await shot(page, "mail-editor-without-mail");
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
