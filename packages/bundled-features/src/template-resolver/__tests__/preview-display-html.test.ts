import { describe, expect, test } from "bun:test";
import {
  buildDisplayHtml,
  PREVIEW_IMAGE_BUDGET_BYTES,
  type PreviewAttachmentReader,
} from "../preview-display-html";

const LOGO = { kind: "inline", cid: "logo", fileRefId: "f1" } as const;
const PNG = new Uint8Array([1, 2, 3]);

const reader =
  (contentType: string, content: Uint8Array = PNG): PreviewAttachmentReader =>
  async () => ({ content, contentType });

describe("buildDisplayHtml", () => {
  test("replaces the exact cid source with a data URI and leaves the input alone", async () => {
    const html = '<img src="cid:logo"><img src="cid:logo2">';
    const result = await buildDisplayHtml(html, [LOGO], reader("image/png"));
    expect(result).toBe(
      `<img src="data:image/png;base64,${Buffer.from(PNG).toString("base64")}"><img src="cid:logo2">`,
    );
    expect(html).toContain("cid:logo");
  });

  test("keeps the cid for types a browser cannot show", async () => {
    const html = '<img src="cid:logo">';
    expect(await buildDisplayHtml(html, [LOGO], reader("application/pdf"))).toBe(html);
    expect(await buildDisplayHtml(html, [LOGO], reader("image/svg+xml"))).toBe(html);
  });

  test("keeps the cid when the file is gone or over the budget", async () => {
    const html = '<img src="cid:logo">';
    expect(await buildDisplayHtml(html, [LOGO], async () => null)).toBe(html);
    const huge = new Uint8Array(PREVIEW_IMAGE_BUDGET_BYTES + 1);
    expect(await buildDisplayHtml(html, [LOGO], reader("image/png", huge))).toBe(html);
  });

  test("does not read files the html never references", async () => {
    let reads = 0;
    await buildDisplayHtml("<p>x</p>", [LOGO], async () => {
      reads += 1;
      return null;
    });
    expect(reads).toBe(0);
  });
});
