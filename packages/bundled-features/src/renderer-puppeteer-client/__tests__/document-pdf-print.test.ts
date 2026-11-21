import { afterEach, describe, expect, mock, test } from "bun:test";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "pdf-lib";
import type { ClientConfig } from "../config";
import type { DocumentPdfRequest } from "../document-pdf";
import { printDocumentPdf } from "../document-pdf-print";
import { installFetchMock } from "./install-fetch-mock";

const CONFIG: ClientConfig = {
  serviceUrl: "http://puppeteer-service:3000",
  authToken: "t".repeat(32),
  requestTimeoutMs: 1000,
  maxRetries: 0,
};

const MM = 72 / 25.4;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function blankPdf(widthMm: number, heightMm: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([widthMm * MM, heightMm * MM]);
  return doc.save({ useObjectStreams: false });
}

function request(foldMarks: DocumentPdfRequest["foldMarks"]): DocumentPdfRequest {
  return {
    html: "<p>x</p>",
    options: {},
    fileName: "x.pdf",
    template: { templateId: "t", templateVersion: 1, scope: "system" },
    layout: null,
    firstPageOptions: null,
    foldMarks,
    cornerMarks: false,
    paperColor: null,
  };
}

// Marks are the only drawn lines on a blank page: one "l" operator each.
async function drawnLineCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  let count = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      const text = new TextDecoder("latin1").decode(decodePDFRawStream(object).decode());
      count += text.match(/ l\n/g)?.length ?? 0;
    }
  }
  return count;
}

async function printWith(widthMm: number, heightMm: number): Promise<Uint8Array> {
  const pdf = await blankPdf(widthMm, heightMm);
  installFetchMock(
    mock().mockResolvedValueOnce(
      new Response(pdf as unknown as BodyInit, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    ),
  );
  return printDocumentPdf(CONFIG, request("din-a"));
}

describe("printDocumentPdf fold marks", () => {
  test("upright A4 gets two fold marks and a punch mark", async () => {
    expect(await drawnLineCount(await printWith(210, 297))).toBe(3);
  });

  test("landscape A4 gets none", async () => {
    expect(await drawnLineCount(await printWith(297, 210))).toBe(0);
  });

  test("Letter gets none", async () => {
    expect(await drawnLineCount(await printWith(215.9, 279.4))).toBe(0);
  });
});
