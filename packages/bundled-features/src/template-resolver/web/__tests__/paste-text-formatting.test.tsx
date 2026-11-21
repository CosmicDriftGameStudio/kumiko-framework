import { describe, expect, test } from "bun:test";
import { textFormattingPasteHtml } from "../paste-text-formatting.ts";

describe("textFormattingPasteHtml", () => {
  test("drops a pasted image and keeps the text", () => {
    const html = textFormattingPasteHtml("<p>Hallo</p><img src=x>");
    expect(html).toContain("Hallo");
    expect(html).not.toContain("<img");
  });

  test("drops dividers, buttons, page breaks and step blocks", () => {
    const html = textFormattingPasteHtml(
      '<p>Text</p><hr><a data-button="" href="https://example.com">Go</a><div data-page-break=""></div><div data-steps="s"></div>',
    );
    expect(html).toBe("<p>Text</p>");
  });

  test("turns a table into paragraphs of its cell text", () => {
    const html = textFormattingPasteHtml(
      "<table><tbody><tr><td><p>a</p></td><td>b</td></tr><tr><td></td><td>c</td></tr></tbody></table>",
    );
    expect(html).toBe("<p>a</p><p>b</p><p>c</p>");
  });

  test("keeps two paragraphs of one cell apart", () => {
    const html = textFormattingPasteHtml(
      "<table><tbody><tr><td><p>a</p><p>b</p></td><td>c</td></tr></tbody></table>",
    );
    expect(html).toBe("<p>a</p><p>b</p><p>c</p>");
  });

  test("emits the text of a nested table once", () => {
    const html = textFormattingPasteHtml(
      "<table><tbody><tr><td>outer<table><tbody><tr><td>inner</td></tr></tbody></table></td><td>next</td></tr></tbody></table>",
    );
    expect(html).toBe("<p>outer</p><p>inner</p><p>next</p>");
  });

  test("keeps formatting that the text toolbar offers", () => {
    const html = textFormattingPasteHtml(
      '<p><strong>fett</strong> <a href="https://x.de">Link</a></p>',
    );
    expect(html).toBe('<p><strong>fett</strong> <a href="https://x.de">Link</a></p>');
  });
});
