import { describe, expect, test } from "bun:test";
import { documentHtmlToText, isEmptyDocumentHtml, textToDocumentHtml } from "../document-text.ts";

describe("documentHtmlToText", () => {
  test("keeps paragraphs and line breaks as newlines and drops tags", () => {
    expect(
      documentHtmlToText("<p>Hi <strong>Anna</strong>,</p><p>line 1<br>line 2 &amp; more</p>"),
    ).toBe("Hi Anna,\n\nline 1\nline 2 & more");
  });

  test("leaves a long run of unclosed angle brackets unchanged", () => {
    const value = "<".repeat(200000);
    expect(documentHtmlToText(value)).toBe(value);
  });

  test("drops a tag whose attribute contains an angle bracket", () => {
    expect(documentHtmlToText('<p title="a<b">x</p>')).toBe("x");
  });

  test("keeps an angle bracket after the last tag", () => {
    expect(documentHtmlToText("<b>a</b> 1 < 2")).toBe("a 1 < 2");
  });
});

describe("textToDocumentHtml", () => {
  test("blank line makes a paragraph, single break a <br>, markup is escaped", () => {
    expect(textToDocumentHtml("Hi <b>Anna</b>,\n\nline 1\nline 2")).toBe(
      "<p>Hi &lt;b&gt;Anna&lt;/b&gt;,</p><p>line 1<br>line 2</p>",
    );
  });

  test("quotes are escaped and come back unchanged in the text form", () => {
    const text = 'Say "hi" & <go>';
    expect(textToDocumentHtml(text)).toBe("<p>Say &quot;hi&quot; &amp; &lt;go&gt;</p>");
    expect(documentHtmlToText(textToDocumentHtml(text))).toBe(text);
  });

  test("round trips through the text form", () => {
    const text = "One\n\nTwo\nthree";
    expect(documentHtmlToText(textToDocumentHtml(text))).toBe(text);
  });
});

describe("textToDocumentHtml with hostile model output", () => {
  test("markup from the model lands as escaped text inside a paragraph", () => {
    expect(textToDocumentHtml("<img src=x onerror=alert(1)>")).toBe(
      "<p>&lt;img src=x onerror=alert(1)&gt;</p>",
    );
  });
});

describe("isEmptyDocumentHtml", () => {
  test("an emptied editor document is empty", () => {
    expect(isEmptyDocumentHtml("")).toBe(true);
    expect(isEmptyDocumentHtml("<p></p>")).toBe(true);
    expect(isEmptyDocumentHtml("<p>&nbsp;</p>")).toBe(true);
  });

  test("a document with only an image, divider, table or block is not empty", () => {
    expect(isEmptyDocumentHtml("<p></p><img src=x>")).toBe(false);
    expect(isEmptyDocumentHtml("<hr>")).toBe(false);
    expect(isEmptyDocumentHtml("<table><tbody><tr><td><p></p></td></tr></tbody></table>")).toBe(
      false,
    );
    expect(isEmptyDocumentHtml('<div data-page-break=""></div>')).toBe(false);
  });

  test("text makes a document non-empty", () => {
    expect(isEmptyDocumentHtml("<p>Hi</p>")).toBe(false);
  });
});
