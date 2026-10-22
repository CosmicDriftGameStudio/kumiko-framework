// @runtime test
// Assert-E2E for the table.export XLSX download on the seeded note-list: a search narrows the
// list first, then the exported workbook must hold exactly the narrowed rows and only the
// visible columns (the hidden customFields column must not leak into the file).

import { readFile } from "node:fs/promises";
import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import { strFromU8, unzipSync } from "fflate";
import { loginAsAdmin } from "./_helpers/login";

test("note-list: the XLSX export holds only the searched rows and visible columns", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/tenant-admin/note-list");
  await expect(page.getByRole("row", { name: /Q3 budget review/ })).toBeVisible();

  await page.locator("#render-list-search").fill("budget");
  await expect(page.getByRole("row", { name: /Landing page copy/ })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Q3 budget review/ })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("list-export").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);

  const path = await download.path();
  const files = unzipSync(new Uint8Array(await readFile(path)));
  const sharedStrings = strFromU8(files["xl/sharedStrings.xml"] ?? new Uint8Array());

  expect(sharedStrings).toContain("Q3 budget review");
  expect(sharedStrings).not.toContain("Landing page copy");
  expect(sharedStrings).not.toContain("Refactor auth flow");
  expect(sharedStrings).not.toMatch(/custom/i);
});
