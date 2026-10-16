import { describe, expect, test } from "bun:test";
import { sanitizePdfFileName } from "../document-pdf";

describe("sanitizePdfFileName", () => {
  test("appends .pdf when the pattern has no extension", () => {
    expect(sanitizePdfFileName("Rechnung-R-1", "invoice")).toBe("Rechnung-R-1.pdf");
  });

  test("keeps an existing extension in any case", () => {
    expect(sanitizePdfFileName("Rechnung.PDF", "invoice")).toBe("Rechnung.PDF");
  });

  test("replaces path separators, quotes, semicolons and dot-dot", () => {
    expect(sanitizePdfFileName('a/b\\c"d;e..f', "invoice")).toBe("a-b-c-d-e-f.pdf");
  });

  test("drops control characters", () => {
    expect(sanitizePdfFileName("Re\u0000ch\nnung\u007f", "invoice")).toBe("Rechnung.pdf");
  });

  test("falls back to the slug when nothing is left", () => {
    expect(sanitizePdfFileName("", "invoice")).toBe("invoice.pdf");
    expect(sanitizePdfFileName("  \n ", "invoice")).toBe("invoice.pdf");
  });

  test("cuts the name to 200 characters before the extension", () => {
    const name = sanitizePdfFileName("x".repeat(500), "invoice");
    expect(name).toBe(`${"x".repeat(200)}.pdf`);
  });
});
