// @runtime test
// Before/after shots for image display: upload preview, list thumbnail column
// and read-only view of a record with a non-square image. Runs only with
// SCREENSHOT_DIR set.

import { deflateSync } from "node:zlib";
import { captureScreenshot, expect, test } from "@cosmicdrift/kumiko-testing/e2e";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// 3:1 gradient PNG so a round or cropped preview is obvious.
function widePng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      row[1 + x * 3] = Math.round((x / width) * 255);
      row[2 + x * 3] = Math.round((y / height) * 255);
      row[3 + x * 3] = 160;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test.use({ viewport: { width: 1440, height: 900 } });

test("profile image display", async ({ page }) => {
  await page.goto("/profile-edit");
  await expect(page.getByText("Full name")).toBeVisible();
  await page.setInputFiles("#kumiko-edit-avatar", {
    name: "wide.png",
    mimeType: "image/png",
    buffer: widePng(300, 100),
  });
  await expect(page.getByTestId("field-avatar").locator("img")).toBeVisible();
  await page.getByLabel("Full name").fill("Wide Picture");
  await page.getByLabel("Email").fill("wide@example.com");
  await captureScreenshot(page, "profile-edit-desktop");
  await page.getByRole("button", { name: "Save changes" }).click();

  await page.goto("/profile-list");
  await expect(page.getByText("Wide Picture")).toBeVisible();
  await captureScreenshot(page, "profile-list-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Wide Picture")).toBeVisible();
  await captureScreenshot(page, "profile-list-mobile");
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByText("Wide Picture").click();
  await page.waitForURL(/profile-view\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("field-avatar").locator("img")).toBeVisible();
  await captureScreenshot(page, "profile-view-desktop");
});
