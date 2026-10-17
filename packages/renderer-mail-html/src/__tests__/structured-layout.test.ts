import { describe, expect, test } from "bun:test";
import { mailLayoutAppearance } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import mjml2html from "mjml";
import { renderStructuredLayoutMjml } from "../structured-layout";

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
    const beforeBody = html.slice(0, html.indexOf(BODY));
    expect(html).toContain(BODY);
    expect(beforeBody.lastIndexOf("<td")).toBeGreaterThan(beforeBody.lastIndexOf("<tbody>"));
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
