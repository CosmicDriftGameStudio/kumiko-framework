import { describe, expect, test } from "bun:test";
import mjml2html from "mjml";
import { DEFAULT_MAIL_LAYOUT_MJML } from "../default-layout";
import { bodySitsInsideTableCell } from "./body-sits-inside-table-cell";

const BODY = "<h2>Ihre Rechnung ist da</h2><p>Guten Tag Familie Yilmaz,</p><hr>";

describe("default mail layout", () => {
  test("the mail body lands inside a table cell, not loose in a tbody", async () => {
    const source = DEFAULT_MAIL_LAYOUT_MJML.replace("{{{content}}}", BODY).replace(
      /\{\{[^{}]*\}\}/g,
      "",
    );
    const { html } = await mjml2html(source, { validationLevel: "strict" });
    expect(html).toContain(BODY);
    expect(bodySitsInsideTableCell(html, BODY)).toBe(true);
  });
});
