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

  test("keeps formatting that the text toolbar offers", () => {
    const html = textFormattingPasteHtml(
      '<p><strong>fett</strong> <a href="https://x.de">Link</a></p>',
    );
    expect(html).toBe('<p><strong>fett</strong> <a href="https://x.de">Link</a></p>');
  });
});
