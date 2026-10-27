// @runtime test
// Screens for the editor guides: a tenant-wide snippet collection, a per-user signature
// collection and managed pages from list to public page. Every shot follows an assertion on
// what it shows; all writes go through the screens themselves.
//
// SCREENSHOT_DIR=<dir> bun run docs-content-editors writes <dir>/content-collections/* and
// <dir>/managed-pages/*.

import {
  captureScreenshot,
  expect,
  pinEnglishLocale,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import { loginAsAdmin } from "./_helpers/login";

const DOCS_VIEWPORT = { width: 1440, height: 900 } as const;

const SHIPPING_PAGE_BODY = [
  "# Shipping and returns",
  "",
  "We ship every order within two working days from our warehouse in Leipzig.",
  "",
  "## Delivery times",
  "",
  "- Germany: 1 to 2 working days",
  "- EU: 3 to 5 working days",
  "",
  "## Returns",
  "",
  "You can send any item back within 30 days. Write to support@example-shop.com and we send you a return label.",
].join("\n");

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await pinEnglishLocale(page);
  await page.setViewportSize(DOCS_VIEWPORT);
  await loginAsAdmin(page);
});

test("snippet collection: edit an entry, insert a variable, preview with sample data", async ({
  page,
}) => {
  await page.goto("/platform");
  await page.getByRole("button", { name: "Refund approved" }).click();
  const editor = page.getByTestId("text-block-editor");
  await expect(editor.getByRole("textbox", { name: "Title" })).toHaveValue("Refund approved");

  const lastParagraph = editor.locator('[contenteditable="true"] p').last();
  await lastParagraph.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Questions? Just reply and quote ");
  await editor.getByRole("button", { name: "Insert orderId" }).click();
  await expect(editor.locator('[contenteditable="true"]')).toContainText(
    "Questions? Just reply and quote {{orderId}}",
  );
  await captureScreenshot(page, "content-collections/snippet-editor", { fit: "content" });

  await editor.getByRole("button", { name: "Preview" }).click();
  await expect(editor).toContainText("Hi Max Mustermann,");
  await expect(editor).toContainText("quote A-1042");
  await captureScreenshot(page, "content-collections/snippet-preview", { fit: "content" });

  await editor.getByRole("button", { name: "Edit" }).click();
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toContainText("Saved");
});

test("signature collection: each user creates their own signature from the + in the sidebar", async ({
  page,
}) => {
  await page.goto("/platform");
  await page.getByRole("button", { name: "New signature" }).click();
  const editor = page.getByTestId("text-block-editor");
  await expect(editor.getByRole("textbox", { name: "Title" })).toHaveValue("");

  await editor.getByRole("textbox", { name: "Title" }).fill("My signature");
  await editor.locator('[contenteditable="true"]').click();
  await page.keyboard.type("Kind regards,");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Alex Morgan");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Customer support, Example Shop");
  await editor.getByText("Alex Morgan", { exact: true }).click({ clickCount: 3 });
  await editor.getByRole("button", { name: "Bold" }).click();
  await expect(editor.locator('[contenteditable="true"] strong')).toHaveText("Alex Morgan");
  await captureScreenshot(page, "content-collections/signature-new", { fit: "content" });

  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toContainText("Created");
  // A user-owned collection gets no live signal for its tree yet, so the sidebar needs a reload.
  await page.reload();
  await expect(page.getByRole("button", { name: "My signature" })).toBeVisible();
  await page.getByRole("button", { name: "My signature" }).click();
  await expect(editor.locator('[contenteditable="true"] strong')).toHaveText("Alex Morgan");
  await captureScreenshot(page, "content-collections/signature-saved", { fit: "content" });
});

test("managed pages: create, publish and open the public page", async ({ page }) => {
  await page.goto("/tenant-admin/page-list");
  await expect(page.getByRole("row", { name: /about/ })).toContainText("Published");
  await expect(page.getByRole("row", { name: /pricing/ })).toContainText("Draft");
  await captureScreenshot(page, "managed-pages/page-list", { fit: "content" });

  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("textbox", { name: "Slug" }).fill("shipping");
  await page.getByRole("textbox", { name: "Language" }).fill("en");
  await page.getByRole("textbox", { name: "Title" }).fill("Shipping and returns");
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("Delivery times and how to return an order.");
  await page.getByRole("switch", { name: "Published" }).click();
  await page.getByRole("textbox", { name: "Content" }).fill(SHIPPING_PAGE_BODY);
  await expect(page.getByRole("switch", { name: "Published" })).toBeChecked();
  await captureScreenshot(page, "managed-pages/new-page", { fit: "content" });

  await page.getByRole("button", { name: "Save" }).click();
  await page.goto("/tenant-admin/page-list");
  await expect(page.getByRole("row", { name: /shipping/ })).toContainText("Published");

  await page.goto("/p/shipping");
  await expect(page.getByRole("heading", { name: "Shipping and returns", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Returns", exact: true })).toBeVisible();
  await captureScreenshot(page, "managed-pages/public-page", { fit: "content" });

  const draft = await page.request.get("/p/pricing");
  expect(draft.status()).toBe(404);
});
