import { describe, expect, test } from "bun:test";
import { degrees, PDFDocument } from "pdf-lib";
import { checkPostalPdf, mergePdfs } from "../pdf-postal.ts";

const A4_PORTRAIT: [number, number] = [595.276, 841.89];
const MAX_BYTES = 1_000_000;

async function pdfWith(
  pages: readonly { size: [number, number]; rotation?: number }[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const { size, rotation } of pages) {
    const page = doc.addPage(size);
    if (rotation !== undefined) page.setRotation(degrees(rotation));
  }
  return doc.save({ useObjectStreams: false });
}

const upright = (count: number) =>
  pdfWith(Array.from({ length: count }, () => ({ size: A4_PORTRAIT })));

describe("mergePdfs", () => {
  test("keeps all pages in the order of the input", async () => {
    const first = await pdfWith([{ size: [300, 400] }]);
    const second = await pdfWith([
      { size: [100, 200] },
      { size: [110, 210] },
      { size: [120, 220] },
    ]);

    const merged = await PDFDocument.load(await mergePdfs([first, second]));

    expect(merged.getPages().map((page) => page.getSize())).toEqual([
      { width: 300, height: 400 },
      { width: 100, height: 200 },
      { width: 110, height: 210 },
      { width: 120, height: 220 },
    ]);
  });

  test("writes a plain object table, so a regex page counter can still read it", async () => {
    const merged = await mergePdfs([await upright(1), await upright(3)]);

    expect(new TextDecoder("latin1").decode(merged)).not.toContain("/ObjStm");
  });
});

describe("checkPostalPdf", () => {
  test("accepts upright A4 and counts the pages of a merged file", async () => {
    const merged = await mergePdfs([await upright(1), await upright(3)]);

    expect(await checkPostalPdf(merged, { maxBytes: MAX_BYTES })).toEqual({
      ok: true,
      pageCount: 4,
    });
  });

  test("accepts A4 within 1 pt tolerance", async () => {
    const pdf = await pdfWith([{ size: [595.276 + 0.9, 841.89 - 0.9] }]);

    expect((await checkPostalPdf(pdf, { maxBytes: MAX_BYTES })).ok).toBe(true);
  });

  test("rejects landscape with its page number", async () => {
    const pdf = await pdfWith([{ size: A4_PORTRAIT }, { size: [841.89, 595.276] }]);

    expect(await checkPostalPdf(pdf, { maxBytes: MAX_BYTES })).toMatchObject({
      ok: false,
      reason: "landscape-page",
      page: 2,
    });
  });

  test("rejects Letter", async () => {
    const pdf = await pdfWith([{ size: [612, 792] }]);

    expect(await checkPostalPdf(pdf, { maxBytes: MAX_BYTES })).toMatchObject({
      ok: false,
      reason: "not-a4-page",
      page: 1,
    });
  });

  test("rejects a rotated page", async () => {
    const pdf = await pdfWith([{ size: A4_PORTRAIT, rotation: 90 }]);

    expect(await checkPostalPdf(pdf, { maxBytes: MAX_BYTES })).toMatchObject({
      ok: false,
      reason: "rotated-page",
      page: 1,
    });
  });

  test("rejects a file above the size limit before reading it", async () => {
    const pdf = await upright(1);

    expect(await checkPostalPdf(pdf, { maxBytes: pdf.byteLength - 1 })).toMatchObject({
      ok: false,
      reason: "file-too-large",
      page: null,
    });
  });

  test("rejects bytes that are not a PDF", async () => {
    expect(
      await checkPostalPdf(new TextEncoder().encode("nope"), { maxBytes: MAX_BYTES }),
    ).toMatchObject({ ok: false, reason: "unreadable" });
  });
});
