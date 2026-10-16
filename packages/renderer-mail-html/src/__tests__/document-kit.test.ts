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

describe("renderer-mail-html :: richText helper", () => {
  const hbs = createDocumentHandlebars({ locale: "de", currency: "EUR" });
  const render = (source: string, data: Record<string, unknown>) =>
    compileDocumentSource(hbs, source)(data);

  test("keeps bold, italic, lists and links", () => {
    const out = render("{{richText body}}", {
      body: '<p><strong>fett</strong> <em>kursiv</em></p><ul><li>eins</li></ul><p><a href="https://example.com/x">Link</a></p>',
    });
    expect(out).toContain("<strong>fett</strong>");
    expect(out).toContain("<em>kursiv</em>");
    expect(out).toContain("<ul><li>");
    expect(out).toContain('href="https://example.com/x"');
  });

  test.each([
    ["script element", "<p>hi</p><script>alert(1)</script>"],
    ["event handler", '<p onclick="alert(1)">hi</p>'],
    ["javascript link", '<p><a href="javascript:alert(1)">x</a></p>'],
  ])("hostile markup (%s) is never emitted as live HTML", (_label, body) => {
    const out = render("{{richText body}}", { body });
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<p onclick");
    expect(out).not.toContain('href="javascript:');
    expect(out).toContain("&lt;");
  });

  test("tiptap output from the reply composer renders as HTML, not escaped text", () => {
    const out = render("{{richText body}}", {
      body: '<p>Hallo <strong>Frau Meier</strong>,</p><ul><li><p>eins</p></li><li><p>zwei</p></li></ul><p>Siehe <a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com">Link</a>, <em>danke</em>.</p>',
    });
    expect(out).toContain("<strong>Frau Meier</strong>");
    expect(out).toContain("<li><p>zwei</p></li>");
    expect(out).toContain('href="https://example.com"');
    expect(out).not.toContain("&lt;");
  });

  test("tiptap paragraphs with a class attribute render as HTML", () => {
    const out = render("{{richText body}}", {
      body: '<p class="text-sm">Hallo <strong>Frau Meier</strong></p>',
    });
    expect(out).toContain("<strong>Frau Meier</strong>");
    expect(out).not.toContain("&lt;");
  });

  test("a plain variable carrying markup stays escaped", () => {
    expect(render("{{body}}", { body: "<b>x</b>" })).toBe("&lt;b&gt;x&lt;/b&gt;");
  });

  test("a missing or non-string value renders nothing", () => {
    expect(render("{{richText body}}", {})).toBe("");
    expect(render("{{richText body}}", { body: 5 })).toBe("");
  });
});
