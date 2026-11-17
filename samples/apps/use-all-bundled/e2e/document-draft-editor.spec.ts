// @runtime test
// Assert-E2E for the document draft editor: a draft of the seeded invoice template is created
// through the real handler, opened in the editor, an edit is saved and shows up as a deviation
// from the template. Finalizing prints the draft and stores the PDF through the in-memory file
// provider, which the test selects with the tenant's file-foundation config.

import {
  CSRF_COOKIE_NAME,
  expect,
  pinEnglishLocale,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
import * as z from "zod";
import { INVOICE_TEMPLATE_SLUG } from "../src/app/auth-constants";
import { loginAsAdmin } from "./_helpers/login";

const TYPED_TEXT = "Pets are allowed.";

const CreatedDraftSchema = z.object({ data: z.object({ id: z.string() }) });

async function postWrite(page: Page, type: string, payload: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === CSRF_COOKIE_NAME)?.value;
  if (!csrf) throw new Error(`no ${CSRF_COOKIE_NAME} cookie after login`);
  const res = await page.request.post("/api/write", {
    headers: { "X-CSRF-Token": csrf },
    data: { type, payload },
  });
  if (!res.ok()) throw new Error(`${type} → ${res.status()} ${await res.text()}`);
  return res;
}

async function createDraft(page: Page): Promise<string> {
  await postWrite(page, "config:write:set", {
    key: "file-foundation:config:provider",
    value: "inmemory",
  });
  const folder = await postWrite(page, "folders:write:folder:create", { name: "Draft host" });
  const folderId = CreatedDraftSchema.parse(await folder.json()).data.id;
  const res = await postWrite(page, "document-draft:write:create", {
    subjectType: "folder",
    subjectId: folderId,
    templateSlug: INVOICE_TEMPLATE_SLUG,
    locale: "de",
    variables: { number: "2026-0200", recipientName: "Mareike Jansen" },
  });
  return CreatedDraftSchema.parse(await res.json()).data.id;
}

test("TenantAdmin edits a draft and sees the deviation from the template", async ({ page }) => {
  await pinEnglishLocale(page);
  await loginAsAdmin(page);
  const draftId = await createDraft(page);

  await page.goto(`/tenant-admin/document-draft-editor/${draftId}`);
  const workbench = page.getByTestId("document-draft-workbench");
  await expect(workbench).toBeVisible();
  await expect(page.getByTestId("document-draft-workbench-status")).toHaveText("Open");
  await expect(workbench.getByText("The draft matches the template.")).toBeVisible();

  const editor = workbench.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(` ${TYPED_TEXT}`);

  await expect(page.getByTestId("document-draft-workbench-finalize")).toBeDisabled();
  const saved = page.waitForResponse(
    (response) => response.url().includes("/api/write") && response.request().method() === "POST",
  );
  await page.getByTestId("editor-save").last().click();
  expect((await saved).ok()).toBe(true);

  // Saving also re-serializes blocks the editor normalizes (the invoice table), so the list holds more rows than the edit.
  await expect(
    page.getByTestId("document-draft-workbench-rail-deviation").filter({ hasText: TYPED_TEXT }),
  ).toHaveCount(1);
  await expect(workbench.getByText("The draft matches the template.")).toHaveCount(0);
  await expect(page.getByTestId("document-draft-workbench-finalize")).toBeEnabled();

  await page.getByTestId("document-draft-workbench-finalize").click();
  await expect(page.getByTestId("document-draft-workbench-status")).toHaveText("Finalized");
  await expect(page.getByTestId("document-draft-workbench-rail-file")).toContainText(".pdf");
  await expect(page.getByTestId("document-draft-workbench-revise")).toHaveText("Edit again");
});
