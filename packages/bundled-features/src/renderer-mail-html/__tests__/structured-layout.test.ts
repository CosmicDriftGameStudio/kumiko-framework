import { describe, expect, test } from "bun:test";
import {
  mailLayoutAppearance,
  sanitizeLayoutHtml,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import mjml2html from "mjml";
import { compileDocumentSource, createDocumentHandlebars } from "../document-kit";
import { toneColors } from "../mail-chrome";
import { renderStructuredLayoutMjml } from "../structured-layout";
import { bodySitsInsideTableCell } from "./body-sits-inside-table-cell";

const BODY = "<h2>Ihre Rechnung ist da</h2><p>Guten Tag Familie Yilmaz,</p><hr>";

describe("structured mail layout", () => {
  test("the mail body lands inside a table cell, not loose in a tbody", async () => {
    const source = renderStructuredLayoutMjml({
      layoutHtml: "",
      contentHtml: BODY,
      context: {},
      compile: (frame) => () => frame.replace(/\{\{\{?(?!content)[^{}]*\}?\}\}/g, ""),
    }).replace("{{{content}}}", BODY);
    const { html } = await mjml2html(source, { validationLevel: "strict" });
    expect(html).toContain(BODY);
    expect(bodySitsInsideTableCell(html, BODY)).toBe(true);
  });

  test("with a header region and the renderer's Handlebars the body still sits inside a table cell", async () => {
    const hbs = createDocumentHandlebars({ locale: "de-DE", currency: "EUR" });
    const source = renderStructuredLayoutMjml({
      layoutHtml: "<div data-header><p>Kopfzeile</p></div><div data-content></div>",
      contentHtml: BODY,
      context: { subject: "Rechnung", previewText: "" },
      compile: (frame) => compileDocumentSource(hbs, frame),
    });
    const { html } = await mjml2html(source, { validationLevel: "strict" });
    expect(html).toContain("Kopfzeile");
    expect(html).toContain(BODY);
    expect(bodySitsInsideTableCell(html, BODY)).toBe(true);
  });

  test("the accent line uses a branding hex and never an unvalidated string", () => {
    const render = (accentColor: string) =>
      renderStructuredLayoutMjml({
        layoutHtml: "",
        contentHtml: BODY,
        context: {},
        compile: (frame) => () => frame,
        appearance: mailLayoutAppearance({ accentLine: "branding" }),
        accentColor,
      });
    expect(render("#ab12cd")).toContain('background-color="#ab12cd"');
    expect(render('red" onload="x')).not.toContain("onload");
  });
});

describe("structured mail layout :: card chrome", () => {
  const hbs = createDocumentHandlebars({ locale: "de", currency: "EUR" });
  const render = (overrides: Partial<Parameters<typeof renderStructuredLayoutMjml>[0]> = {}) =>
    renderStructuredLayoutMjml({
      layoutHtml: "<div data-content></div><div data-footer><p>Region footer</p></div>",
      contentHtml: BODY,
      context: { lang: "de", subject: "S", previewText: "" },
      compile: (source) => compileDocumentSource(hbs, source),
      appearance: mailLayoutAppearance({ accentLine: "branding" }),
      accentColor: "#2b3fe0",
      ...overrides,
    });

  test("a tone colors the top line and the chip; the brand row replaces the header region", async () => {
    const source = render({
      tone: toneColors("warning", "#2b3fe0"),
      brandHeaderHtml: "<span>ACME BRAND</span>",
      headerChip: "Neuer Incident",
    });
    expect(source).toContain('background-color="#F2B53A" border-radius="14px 14px 0 0"');
    expect(source).not.toContain('background-color="#2b3fe0"');
    expect(source).toContain("<span>ACME BRAND</span>");
    expect(source).toContain("Neuer Incident");
    const { html, errors } = await mjml2html(source, { validationLevel: "soft" });
    expect(errors).toEqual([]);
    expect(html).toContain("border-radius:14px");
  });

  test("the band carries the footer note, the links and the region footer; the platform line sits below", () => {
    const source = render({
      footerNote: "Du erhältst diese Mail <weil> du abonniert hast.",
      bandLinksHtml: '<a href="https://acme.example">acme.example</a>',
      footerHtml: "Versendet über publicstatus",
    });
    const band = source.slice(source.indexOf("#FBFBFA"), source.indexOf("</mj-wrapper>"));
    expect(band).toContain("Du erhältst diese Mail &lt;weil&gt; du abonniert hast.");
    expect(band).toContain('<a href="https://acme.example">acme.example</a>');
    expect(band).toContain("Region footer");
    expect(source.slice(source.indexOf("</mj-wrapper>"))).toContain("Versendet über publicstatus");
  });

  test("without a tone the accent line follows the layout and there is no chip", () => {
    const source = render({ headerChip: "Ignored without tone" });
    expect(source).toContain('background-color="#2b3fe0" border-radius="14px 14px 0 0"');
    expect(source).not.toContain("Ignored without tone");
  });
});

describe("structured mail layout :: hostile tenant input", () => {
  const hbs = createDocumentHandlebars({ locale: "de", currency: "EUR" });
  const HOSTILE_PREVIEW = "<img src=x onerror=alert(1)>";
  const HOSTILE_TEXT =
    '{{{previewText}}} &lt;script&gt;alert(1)&lt;/script&gt; "&gt;&lt;img src=x onerror=alert(1)&gt;';

  test("the sanitizer rejects a raw script element in a region", () => {
    const result = sanitizeLayoutHtml(
      "<div data-header><p>x</p><script>alert(1)</script></div><div data-content></div>",
    );
    expect(result.ok).toBe(false);
  });

  test("handlebars syntax and markup typed as text stay inert text in the rendered mail", async () => {
    const sanitized = sanitizeLayoutHtml(
      `<div data-header><p>${HOSTILE_TEXT}</p></div><div data-content></div><div data-footer><p>${HOSTILE_TEXT}</p></div>`,
    );
    if (!sanitized.ok) throw new Error("layout with escaped text must pass the sanitizer");
    const source = renderStructuredLayoutMjml({
      layoutHtml: sanitized.html,
      contentHtml: BODY,
      context: { lang: "de", subject: HOSTILE_PREVIEW, previewText: HOSTILE_PREVIEW },
      compile: (frame) => compileDocumentSource(hbs, frame),
    });
    const { html } = await mjml2html(source, { validationLevel: "soft" });
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/<img[^>]*onerror=/i);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
