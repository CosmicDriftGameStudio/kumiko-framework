import { describe, expect, spyOn, test } from "bun:test";
import { degrees, PDFDocument } from "pdf-lib";
import { PdfDecodeLimitError } from "../pdf-load.ts";
import { appendPdfPages, checkPostalPdf, mergePdfs, PdfPageLimitError } from "../pdf-postal.ts";
import { BOMB_DECODED_BYTES, objectStreamPdf } from "./pdf-bomb-fixture.ts";

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

  test("refuses the sources once their pages pass the cap, and allows the cap itself", async () => {
    const sources = [await upright(2), await upright(2)];

    await expect(mergePdfs(sources, { maxPages: 3 })).rejects.toThrow(PdfPageLimitError);
    const merged = await PDFDocument.load(await mergePdfs(sources, { maxPages: 4 }));
    expect(merged.getPageCount()).toBe(4);
  });

  test("stops at the source that passes the cap before its pages are copied", async () => {
    const copyPages = spyOn(PDFDocument.prototype, "copyPages");
    try {
      await expect(mergePdfs([await upright(5)], { maxPages: 2 })).rejects.toThrow(
        PdfPageLimitError,
      );
      expect(copyPages).not.toHaveBeenCalled();
    } finally {
      copyPages.mockRestore();
    }
  });

  test("starts each file on a new sheet by adding a blank page after an odd file", async () => {
    const first = await pdfWith([{ size: [300, 400] }]);
    const second = await pdfWith([{ size: [100, 200] }, { size: [110, 210] }]);

    const merged = await PDFDocument.load(
      await mergePdfs([first, second], { startEachFileOnNewSheet: true }),
    );

    expect(merged.getPages().map((page) => page.getSize())).toEqual([
      { width: 300, height: 400 },
      { width: 300, height: 400 },
      { width: 100, height: 200 },
      { width: 110, height: 210 },
    ]);
    expect(merged.getPage(1).node.Contents()).toBeUndefined();
  });

  test("joins the files directly without the option", async () => {
    const merged = await PDFDocument.load(await mergePdfs([await upright(1), await upright(2)]));

    expect(merged.getPageCount()).toBe(3);
  });

  test("adds no blank page after the last file, even when it is odd", async () => {
    const merged = await PDFDocument.load(
      await mergePdfs([await upright(2), await upright(1)], { startEachFileOnNewSheet: true }),
    );

    expect(merged.getPageCount()).toBe(3);
  });

  test("counts blank pages towards the page cap", async () => {
    const sources = [await upright(1), await upright(2)];

    await expect(
      mergePdfs(sources, { maxPages: 3, startEachFileOnNewSheet: true }),
    ).rejects.toThrow(PdfPageLimitError);
  });

  test("refuses a source whose object streams decode past the budget", async () => {
    const bomb = objectStreamPdf({ decodedBytesPerStream: BOMB_DECODED_BYTES, streamCount: 1 });
    await expect(mergePdfs([await upright(1), bomb])).rejects.toBeInstanceOf(PdfDecodeLimitError);
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

  test("accepts a blank filler page between files", async () => {
    const merged = await mergePdfs([await upright(1), await upright(2)], {
      startEachFileOnNewSheet: true,
    });

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

  test("rejects an object stream bomb as unreadable", async () => {
    const bomb = objectStreamPdf({ decodedBytesPerStream: BOMB_DECODED_BYTES, streamCount: 1 });
    expect(await checkPostalPdf(bomb, { maxBytes: 10 * 1024 * 1024 })).toMatchObject({
      ok: false,
      reason: "unreadable",
      page: null,
    });
  });
});

describe("appendPdfPages", () => {
  test("refuses an original whose object streams decode past the budget", async () => {
    const bomb = objectStreamPdf({ decodedBytesPerStream: BOMB_DECODED_BYTES, streamCount: 1 });
    await expect(appendPdfPages(bomb, await upright(1))).rejects.toBeInstanceOf(
      PdfDecodeLimitError,
    );
  });
});
