// End-to-End-Beweis für das Avatar-Image-Upload-Feld: eine Datei in das
// (hidden) file-Input legen → multipart-POST an /api/files (in-memory-Provider)
// → die zurückgegebene FileRef-UUID wird zum Feld-Wert → die Avatar-Preview
// (img[src=/api/files/:id]) erscheint und der Button wechselt auf "Change".

import { expect, test } from "@playwright/test";

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

  // Nach dem Upload: Preview-Bild mit FileRef-URL + Avatar-Button = "Change".
  // (Selektor auf das avatar-Feld scopen — "Save changes" enthält sonst auch
  //  "Change" und triggert strict-mode.)
  const avatar = page.getByTestId("field-avatar");
  await expect(avatar.locator('img[src^="/api/files/"]')).toBeVisible({ timeout: 5000 });
  await expect(avatar.getByRole("button", { name: "Change" })).toBeVisible();
});
