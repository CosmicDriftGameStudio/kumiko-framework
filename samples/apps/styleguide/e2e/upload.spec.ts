// End-to-end proof for the avatar image upload field: put a file into the
// (hidden) file input → multipart POST to /api/files (in-memory provider)
// → the returned FileRef UUID becomes the field value → the avatar preview
// (img[src=/api/files/:id]) appears and the button switches to "Change".

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";

// 1×1 transparentes PNG.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

test("Avatar-Upload: Datei → /api/files → Preview + Change-Button", async ({ page }) => {
  await page.goto("/profile-edit");
  await expect(page.getByText("Full name")).toBeVisible();

  // Vor dem Upload: kein Preview-Bild, Button sagt "Upload".
  await expect(page.locator('img[src^="/api/files/"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload" })).toBeVisible();

  // Datei ins (versteckte) file-Input des avatar-Felds legen.
  await page.setInputFiles("#kumiko-edit-avatar", {
    name: "avatar.png",
    mimeType: "image/png",
    buffer: PNG_1X1,
  });

  // After the upload: preview image with FileRef URL + avatar button = "Change".
  // (Scope the selector to the avatar field — "Save changes" otherwise also contains
  //  "Change" and triggers strict mode.)
  const avatar = page.getByTestId("field-avatar");
  await expect(avatar.locator('img[src^="/api/files/"]')).toBeVisible({ timeout: 5000 });
  await expect(avatar.getByRole("button", { name: "Change" })).toBeVisible();
});
