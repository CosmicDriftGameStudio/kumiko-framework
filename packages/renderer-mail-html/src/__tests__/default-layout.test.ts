import { describe, test } from "bun:test";
import mjml2html from "mjml";
import { DEFAULT_MAIL_LAYOUT_MJML } from "../default-layout";
import { expectBodyInsideTableCell } from "./expect-body-in-table-cell";

const BODY = "<h2>Ihre Rechnung ist da</h2><p>Guten Tag Familie Yilmaz,</p><hr>";

describe("default mail layout", () => {
  test("the mail body lands inside a table cell, not loose in a tbody", async () => {
    const source = DEFAULT_MAIL_LAYOUT_MJML.replace("{{{content}}}", BODY).replace(
      /\{\{[^{}]*\}\}/g,
      "",
    );
    const { html } = await mjml2html(source, { validationLevel: "strict" });
    expectBodyInsideTableCell(html, BODY);
  });
});
