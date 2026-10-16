import { describe, expect, test } from "bun:test";
import { compileDocumentSource, createDocumentHandlebars } from "../document-kit";

function renderInvoiceLine(locale: string): string {
  const hbs = createDocumentHandlebars({ locale, currency: "EUR" });
  return compileDocumentSource(
    hbs,
    "{{date invoiceDate}} | {{money total}}",
  )({
    invoiceDate: "2026-10-01",
    total: 78000,
  });
}

describe("renderer-mail-html :: document format", () => {
  test("a German template prints the long German date and German money", () => {
    expect(renderInvoiceLine("de")).toBe("1. Oktober 2026 | 780,00 €");
  });

  test("an English template prints the long English date and English money", () => {
    expect(renderInvoiceLine("en")).toBe("October 1, 2026 | €780.00");
  });
});
