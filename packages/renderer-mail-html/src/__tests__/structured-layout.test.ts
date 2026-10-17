import { describe, expect, test } from "bun:test";
import { mailLayoutAppearance } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import mjml2html from "mjml";
import { compileDocumentSource, createDocumentHandlebars } from "../document-kit";
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
