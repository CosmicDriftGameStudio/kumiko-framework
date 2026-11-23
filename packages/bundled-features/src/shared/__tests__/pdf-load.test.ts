import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { loadPdfWithinDecodeBudget, PdfDecodeLimitError } from "../pdf-load.ts";
import {
  BOMB_DECODED_BYTES,
  cyclicPageTreePdf,
  fanOutPageTreePdf,
  objectStreamPdf,
  pageListedTwicePdf,
  xrefStreamPdf,
} from "./pdf-bomb-fixture.ts";

const MIB = 1024 * 1024;

async function legitPdfWithObjectStreams(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let page = 0; page < 3; page++) doc.addPage([595.276, 841.89]);
  return doc.save({ useObjectStreams: true });
}

let warn: ReturnType<typeof spyOn>;

beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("loadPdfWithinDecodeBudget", () => {
  test("loads a PDF that pdf-lib saved with object streams", async () => {
    const doc = await loadPdfWithinDecodeBudget(await legitPdfWithObjectStreams());
    expect(doc.getPageCount()).toBe(3);
  });

  test("refuses a Flate object stream that decodes past the budget, which pdf-lib alone loads", async () => {
    const bomb = objectStreamPdf({ decodedBytesPerStream: BOMB_DECODED_BYTES, streamCount: 1 });
    const plain = await PDFDocument.load(bomb);
    expect(plain.getPageCount()).toBe(1);
    await expect(loadPdfWithinDecodeBudget(bomb)).rejects.toBeInstanceOf(PdfDecodeLimitError);
  });

  test("refuses a RunLength object stream past the budget", async () => {
    const bomb = objectStreamPdf({
      decodedBytesPerStream: BOMB_DECODED_BYTES,
      streamCount: 1,
      filter: "RunLengthDecode",
    });
    const plain = await PDFDocument.load(bomb);
    expect(plain.getPageCount()).toBe(1);
    await expect(loadPdfWithinDecodeBudget(bomb)).rejects.toBeInstanceOf(PdfDecodeLimitError);
  });

  test("loads a single object stream below the budget", async () => {
    const pdf = objectStreamPdf({ decodedBytesPerStream: 6 * MIB, streamCount: 1 });
    const doc = await loadPdfWithinDecodeBudget(pdf);
    expect(doc.getPageCount()).toBe(1);
  });

  test("sums the budget over all object streams of one load", async () => {
    const pdf = objectStreamPdf({ decodedBytesPerStream: 6 * MIB, streamCount: 3 });
    await expect(loadPdfWithinDecodeBudget(pdf)).rejects.toBeInstanceOf(PdfDecodeLimitError);
  });

  test("keeps counting after pdf-lib yields to the timer queue", async () => {
    const pdf = objectStreamPdf({
      decodedBytesPerStream: BOMB_DECODED_BYTES,
      streamCount: 1,
      fillerObjects: 150,
    });
    await expect(loadPdfWithinDecodeBudget(pdf)).rejects.toBeInstanceOf(PdfDecodeLimitError);
  });

  test("keeps the budget per load when loads run at the same time", async () => {
    const bomb = objectStreamPdf({
      decodedBytesPerStream: BOMB_DECODED_BYTES,
      streamCount: 1,
      fillerObjects: 150,
    });
    const legit = objectStreamPdf({
      decodedBytesPerStream: 6 * MIB,
      streamCount: 1,
      fillerObjects: 150,
    });
    // Both loads start in the same tick and interleave over pdf-lib's timer yields.
    const [bombResult, legitResult] = await Promise.allSettled([
      loadPdfWithinDecodeBudget(bomb),
      loadPdfWithinDecodeBudget(legit),
    ]);
    expect(bombResult.status).toBe("rejected");
    if (bombResult.status === "rejected") {
      expect(bombResult.reason).toBeInstanceOf(PdfDecodeLimitError);
    }
    expect(legitResult.status).toBe("fulfilled");
  });

  test.each([
    ["a huge /Size", xrefStreamPdf({ size: "1000000000" })],
    ["a huge /Index length", xrefStreamPdf({ size: "5", index: "[0 2000000000]" })],
  ])("refuses an xref stream that declares %s", async (_label, pdf) => {
    await expect(loadPdfWithinDecodeBudget(pdf)).rejects.toBeInstanceOf(PdfDecodeLimitError);
  });

  test("refuses a page tree that fans out over shared kids", async () => {
    await expect(loadPdfWithinDecodeBudget(fanOutPageTreePdf(10, 8))).rejects.toBeInstanceOf(
      PdfDecodeLimitError,
    );
  });

  test("refuses a page tree that lists itself as a kid", async () => {
    await expect(loadPdfWithinDecodeBudget(cyclicPageTreePdf())).rejects.toBeInstanceOf(
      PdfDecodeLimitError,
    );
  });

  test("loads a pdf-lib PDF with 2000 pages", async () => {
    const doc = await PDFDocument.create();
    for (let page = 0; page < 2000; page++) doc.addPage([595.276, 841.89]);
    const loaded = await loadPdfWithinDecodeBudget(await doc.save({ useObjectStreams: true }));
    expect(loaded.getPageCount()).toBe(2000);
  });

  test("loads a PDF that lists a page twice", async () => {
    const loaded = await loadPdfWithinDecodeBudget(pageListedTwicePdf());
    expect(loaded.getPageCount()).toBe(2);
  });
});
