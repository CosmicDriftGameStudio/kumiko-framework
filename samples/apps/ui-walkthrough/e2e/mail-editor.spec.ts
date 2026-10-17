// @runtime test
// Mail editor as the Nordlicht tenant admin: one walk-through on the seeded
// draft "Korrigierte Rechnung". Serial because every step builds on the saved
// state of the previous one and the server and database are shared.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import type { Locator, Page } from "@playwright/test";
import { TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD } from "../src/app/auth-constants";
import { loginAs } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1280, height: 820 } });
test.describe.configure({ mode: "serial" });

// CI starts Playwright from the repo root, so fixture paths cannot be cwd-relative.
const here = dirname(fileURLToPath(import.meta.url));
const PDF = resolve(here, "fixtures/hausordnung.pdf");

// The title lives in the shell header: the editor has no header row of its own.
function editorTitle(page: Page): Locator {
  return page.locator('[data-kumiko-layout="shell-header"] h1');
}

// The subject editor loads lazily behind a plain input with the raw {{name}}
// text; a click on that fallback can put the caret inside a placeholder token.
// It also remounts once when the validation result delivers the placeholder
// labels, which would drop the keystrokes typed meanwhile: the placeholder
// rail lists the variables only after that result arrived.
async function appendToSubject(page: Page, text: string): Promise<void> {
  await expect(page.locator('[data-testid^="mail-placeholder-"]').first()).toBeVisible();
  const subject = page.locator("#mail-subject[contenteditable='true']");
  await expect(subject).toBeVisible();
  await subject.click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}

test("tenant admin edits the invoice mail, attaches files, previews, sends a test mail and publishes", async ({
  page,
}) => {
  await loginAs(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  await page.goto("/templates");
  const row = page.getByRole("row").filter({ hasText: "Korrigierte Rechnung" });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Bearbeiten" }).click();

  await expect(editorTitle(page)).toContainText("Korrigierte Rechnung");
  await expect(page.getByTestId("document-designer-editor-status")).toContainText("Entwurf");

  // The draft has no due date: the placeholder is flagged and publishing is blocked.
  const dueDate = page.getByTestId("mail-placeholder-dueDate");
  await expect(dueDate).toHaveAttribute("data-bad", "true");
  await expect(dueDate).toContainText("fehlt");
  await expect(page.getByTestId("document-designer-publish")).toBeDisabled();

  // Save is only enabled for a changed draft: edit the subject, then save a new version.
  await expect(page.getByTestId("document-designer-editor-status")).toContainText("v1");
  await appendToSubject(page, " (Oktober)");
  await page.getByTestId("document-designer-save").click();
  await expect(page.getByTestId("document-designer-editor-status")).toContainText("v2");
  await expect(page.getByTestId("document-designer-editor-status")).toContainText("Entwurf");

  // The draft has no resources yet; the logo comes from the layout header.
  await expect(page.getByTestId("mail-resource-row")).toHaveCount(0);
  await page.getByTestId("mail-resource-upload-open").click();
  await page.setInputFiles("#mail-upload-attachment", PDF);
  await expect(page.getByTestId("mail-resource-row")).toHaveCount(1);
  await expect(
    page.getByTestId("mail-resource-row").filter({ hasText: "hausordnung.pdf" }),
  ).toHaveCount(1);
  await expect(page.getByTestId("mail-editor-attachments")).toContainText("hausordnung.pdf");

  // Preview: sandboxed iframe, attachment line, check list, test mail.
  await page.getByTestId("mail-mode-switch").getByText("Vorschau", { exact: true }).click();
  const frame = page.getByTestId("mail-preview-iframe");
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("sandbox", "");
  await expect(
    page.frameLocator('[data-testid="mail-preview-iframe"]').getByText("Rechnung online ansehen"),
  ).toBeVisible();
  // The logo appears once, from the tenant layout header.
  await expect(page.frameLocator('[data-testid="mail-preview-iframe"]').locator("img")).toHaveCount(
    1,
  );
  await expect(page.getByTestId("mail-preview-attachments")).toContainText("hausordnung.pdf");
  await expect(page.getByTestId("mail-preview-checks")).toBeVisible();
  // A long sample value must not squeeze its label out of the rail.
  await expect(
    page.getByTestId("mail-sample-invoiceUrl").getByText("Link zur Rechnung"),
  ).toBeVisible();
  await page.getByTestId("mail-test-send").click();
  await expect(page.getByTestId("mail-test-sent")).toBeVisible();

  // Insert the missing due date by clicking its placeholder row, then publish.
  await page.getByTestId("mail-mode-switch").getByText("Bearbeiten", { exact: true }).click();
  await page.getByTestId("mail-placeholder-dueDate-insert").click();
  await expect(page.getByTestId("mail-placeholder-dueDate")).not.toHaveAttribute(
    "data-bad",
    "true",
  );
  await expect(page.getByTestId("mail-placeholder-dueDate")).toContainText("✓");
  await expect(page.getByTestId("document-designer-publish")).toBeEnabled();
  await page.getByTestId("document-designer-publish").click();
  await expect(page.getByTestId("document-designer-editor-status")).toContainText("Aktiv");
});

test("switching the language with unsaved changes asks first and keeps the input on cancel", async ({
  page,
}) => {
  await loginAs(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  await page.goto("/templates");
  const row = page.getByRole("row").filter({ hasText: "Korrigierte Rechnung" });
  await row.getByRole("button", { name: "Bearbeiten" }).click();
  await expect(editorTitle(page)).toBeVisible();

  await appendToSubject(page, " (geprüft)");
  const subject = page.locator("#mail-subject");

  await page.getByTestId("mail-locale-switch").getByText("en", { exact: true }).click();
  const dialog = page.getByTestId("mail-leave-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(subject).toContainText("(geprüft)");
});
