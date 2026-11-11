import { describe, expect, test } from "bun:test";
import { documentHtmlToText, textToDocumentHtml } from "../document-text.ts";

describe("documentHtmlToText", () => {
  test("keeps paragraphs and line breaks as newlines and drops tags", () => {
    expect(
      documentHtmlToText("<p>Hi <strong>Anna</strong>,</p><p>line 1<br>line 2 &amp; more</p>"),
    ).toBe("Hi Anna,\n\nline 1\nline 2 & more");
  });
});

describe("textToDocumentHtml", () => {
  test("blank line makes a paragraph, single break a <br>, markup is escaped", () => {
    expect(textToDocumentHtml("Hi <b>Anna</b>,\n\nline 1\nline 2")).toBe(
      "<p>Hi &lt;b&gt;Anna&lt;/b&gt;,</p><p>line 1<br>line 2</p>",
    );
  });

  test("round trips through the text form", () => {
    const text = "One\n\nTwo\nthree";
    expect(documentHtmlToText(textToDocumentHtml(text))).toBe(text);
  });
});
