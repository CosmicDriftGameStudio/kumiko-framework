import { describe, expect, test } from "bun:test";
import { detectLossyMarkdown, type LossyMarkdownFeature } from "../web/lossy-markdown.ts";
import { markdownToDocumentHtml } from "../web/markdown-to-document.ts";

describe("detectLossyMarkdown", () => {
  test("plain structure converts without loss", () => {
    const markdown = [
      "# Title",
      "",
      "## Section",
      "",
      "### Subsection",
      "",
      "Text with **bold**, *italic* and [a link](https://example.com).",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "[mail](mailto:team@example.com)",
    ].join("\n");
    expect(detectLossyMarkdown(markdown)).toEqual([]);
  });

  const cases: ReadonlyArray<readonly [string, string, LossyMarkdownFeature]> = [
    ["an image", "![alt](https://example.com/a.png)", "image"],
    ["a block quote", "> quoted", "blockquote"],
    ["a fenced code block", "```\ncode\n```", "code"],
    ["an indented code block", "    indented", "code"],
    ["inline code", "use `npm`", "code"],
    ["a level 4 heading", "#### Deep", "deepHeading"],
    ["a relative link", "[privacy](/legal/privacy)", "relativeLink"],
    ["a javascript link", "[x](javascript:alert(1))", "relativeLink"],
  ];

  test.each(cases)("%s is reported", (_name, markdown, expected) => {
    expect(detectLossyMarkdown(markdown)).toContain(expected);
  });

  test("level 3 headings are not reported", () => {
    expect(detectLossyMarkdown("### Fine")).toEqual([]);
  });

  test("features inside lists and quotes are found", () => {
    const found = detectLossyMarkdown("- item with [rel](/x) and `code`\n\n> - nested ![i](a.png)");
    expect(found).toEqual(expect.arrayContaining(["image", "blockquote", "code", "relativeLink"]));
  });

  test("each feature is reported once, in a stable order", () => {
    expect(detectLossyMarkdown("`a` `b`\n\n> q\n\n> q2\n\n![i](a)\n\n![j](b)")).toEqual([
      "image",
      "blockquote",
      "code",
    ]);
  });
});

describe("markdownToDocumentHtml", () => {
  test("converts markdown to HTML", () => {
    expect(markdownToDocumentHtml("## Hi\n\n**bold**")).toContain("<strong>bold</strong>");
  });

  test("raw HTML in the markdown is escaped, never passed to the editor", () => {
    const html = markdownToDocumentHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
