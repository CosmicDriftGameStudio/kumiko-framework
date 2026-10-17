import { describe, expect, test } from "bun:test";
import { compileDocumentBodyToHandlebars } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { templateVariable } from "@cosmicdrift/kumiko-framework/engine";
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

describe("renderer-mail-html :: date helper", () => {
  const hbs = createDocumentHandlebars({ locale: "de", currency: "EUR" });
  const renderDate = (value: unknown) => compileDocumentSource(hbs, "{{date value}}")({ value });

  test("a datetime with an offset keeps the calendar date of its wall clock", () => {
    expect(renderDate("2026-10-18T00:30:00+02:00")).toBe("18. Oktober 2026");
    expect(renderDate("2026-10-17T23:30:00-05:00")).toBe("17. Oktober 2026");
  });

  test("a UTC datetime and epoch milliseconds use the UTC date", () => {
    expect(renderDate("2026-10-18T00:30:00Z")).toBe("18. Oktober 2026");
    expect(renderDate(Date.UTC(2026, 9, 18, 0, 30))).toBe("18. Oktober 2026");
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

  const variables = { body: templateVariable.richText() };
  const renderBody = (documentHtml: string, body: string) =>
    render(compileDocumentBodyToHandlebars(documentHtml, variables), { body });

  test("a paragraph holding only the value renders the value's paragraphs, never nested", () => {
    expect(renderBody('<p><span data-variable="body"></span></p>', "Wir prüfen das.")).toBe(
      "<div><p>Wir prüfen das.</p></div>",
    );
    expect(
      renderBody('<p><span data-variable="body"></span></p>', "<p>Erstens.</p><p>Zweitens.</p>"),
    ).toBe("<div><p>Erstens.</p><p>Zweitens.</p></div>");
  });

  test("inside a line of text the value's paragraphs become line breaks", () => {
    const out = renderBody(
      '<p>Hinweis: <span data-variable="body"></span></p>',
      "<p>Erstens.</p><p><strong>Zweitens.</strong></p>",
    );
    expect(out).toBe("<p>Hinweis: Erstens.<br><strong>Zweitens.</strong></p>");
  });

  test("a missing value leaves no empty block behind", () => {
    expect(renderBody('<p><span data-variable="body"></span></p><p>Danke</p>', "")).toBe(
      "<p>Danke</p>",
    );
  });

  test("a missing or non-string value renders nothing", () => {
    expect(render("{{richText body}}", {})).toBe("");
    expect(render("{{richText body}}", { body: 5 })).toBe("");
  });
});

describe("renderer-mail-html :: steps block", () => {
  const body =
    '<div data-steps="stage"><span data-step="reported">Gemeldet</span><span data-step="investigating">Untersucht</span><span data-step="resolved">Behoben</span></div>';

  function renderSteps(stage: unknown): string {
    const hbs = createDocumentHandlebars({ locale: "de", currency: "EUR" });
    const source = compileDocumentBodyToHandlebars(body, {}, { stepsColor: "#F2B53A" });
    return compileDocumentSource(hbs, source)({ stage });
  }

  function barColors(html: string): readonly string[] {
    return [...html.matchAll(/border-radius:2px;background-color:(#[0-9A-Fa-f]{6})/g)].map(
      (match) => match[1] ?? "",
    );
  }

  test("stages up to the current one are filled, the current label is bold", () => {
    const html = renderSteps("investigating");
    expect(barColors(html)).toEqual(["#F2B53A", "#F2B53A", "#ECEDEA"]);
    expect(html).toMatch(/color:#0B0D12;font-weight:600">Untersucht/);
    expect(html).toMatch(/color:#5A6170;font-weight:400">Behoben/);
  });

  test("an unknown or missing stage leaves every stage open", () => {
    expect(barColors(renderSteps("closed"))).toEqual(["#ECEDEA", "#ECEDEA", "#ECEDEA"]);
    expect(barColors(renderSteps(undefined))).toEqual(["#ECEDEA", "#ECEDEA", "#ECEDEA"]);
    expect(barColors(renderSteps({ toString: () => "resolved" }))).toEqual([
      "#ECEDEA",
      "#ECEDEA",
      "#ECEDEA",
    ]);
  });
});

describe("renderer-mail-html :: author conditions and percent", () => {
  const variables = {
    discount: templateVariable.percent(),
    note: templateVariable.text(),
    lines: templateVariable.list({
      label: templateVariable.text(),
      extra: templateVariable.text(),
    }),
  };
  const body =
    '<p>Total</p><p data-if="discount">Discount <span data-variable="discount"></span> applies.</p><p data-if="note">Note</p><table><tbody><tr data-each="lines"><td><p><span data-variable="label"></span></p><p data-if="extra">+</p></td></tr></tbody></table>';

  function render(locale: string, values: Record<string, unknown>): string {
    const source = compileDocumentBodyToHandlebars(body, variables);
    return compileDocumentSource(
      createDocumentHandlebars({ locale, currency: "EUR" }),
      source,
    )(values);
  }

  test("a conditional block shows only with a value, a percent of 0 still counts", () => {
    expect(render("en", { discount: 12, lines: [] })).toContain("Discount 12% applies.");
    expect(render("en", { discount: 0, lines: [] })).toContain("Discount 0% applies.");
    const withoutValues = render("en", { lines: [] });
    expect(withoutValues).not.toContain("Discount");
    expect(withoutValues).not.toContain("Note");
    expect(withoutValues).toContain("Total");
  });

  test("percent follows the mail locale", () => {
    expect(render("de", { discount: 12, lines: [] })).toContain("Discount 12 % applies.");
    expect(render("de", { discount: 7.5, lines: [] })).toContain("7,5 %");
  });

  test("a condition inside a list row checks the row field", () => {
    const html = render("en", { lines: [{ label: "A", extra: "y" }, { label: "B" }] });
    expect(html.match(/<p>\+<\/p>/g)?.length).toBe(1);
  });
});
