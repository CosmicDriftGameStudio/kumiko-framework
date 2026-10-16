import { describe, expect, test } from "bun:test";
import { prepareDocumentForPrint } from "../print-document";

describe("prepareDocumentForPrint", () => {
  test("moves leading repeat-header rows into a thead and drops the attribute", () => {
    const html = prepareDocumentForPrint(
      '<table><tbody><tr data-repeat-header=""><th>A</th></tr><tr><td>1</td></tr></tbody></table>',
    );
    expect(html).toContain("<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr>");
    expect(html).not.toContain("data-repeat-header");
  });

  test("handles several tables independently and leaves tables without a header alone", () => {
    const html = prepareDocumentForPrint(
      '<table><tr data-repeat-header=""><th>A</th></tr><tr><td>1</td></tr></table>' +
        "<table><tr><td>2</td></tr></table>" +
        '<table><tr data-repeat-header=""><th>B</th></tr><tr><td>3</td></tr></table>',
    );
    expect(html.match(/<thead>/g)).toHaveLength(2);
    expect(html).toContain("<thead><tr><th>B</th></tr></thead>");
  });

  test("only rows before the first non-header row move", () => {
    const html = prepareDocumentForPrint(
      '<table><tr><td>1</td></tr><tr data-repeat-header=""><th>late</th></tr></table>',
    );
    expect(html).not.toContain("<thead>");
  });

  test("removes external images but keeps embedded ones", () => {
    const html = prepareDocumentForPrint(
      '<img src="https://evil.example/x.png"><img src="data:image/png;base64,AAAA">',
    );
    expect(html).not.toContain("https://");
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });

  test("removes style attributes with url() or @import and fetching elements", () => {
    const html = prepareDocumentForPrint(
      '<p style="background:url(https://evil.example/a.png)">x</p>' +
        '<p style="color:red">y</p><link rel="stylesheet" href="https://evil.example/a.css">' +
        '<iframe src="https://evil.example"></iframe><style>@import "x";</style>',
    );
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("<style");
    expect(html).toContain('style="color:red"');
  });

  test("keeps link hrefs", () => {
    expect(prepareDocumentForPrint('<a href="https://example.com/a">go</a>')).toContain(
      'href="https://example.com/a"',
    );
  });

  test("strips href and xlink:href from non-anchor elements and keeps anchors", () => {
    const html = prepareDocumentForPrint(
      '<p><a href="https://example.com/a">link</a></p><svg><image href="https://evil.example/x.png"></image><use xlink:href="https://evil.example/s.svg#a"></use></svg>',
    );
    expect(html).toContain('href="https://example.com/a"');
    expect(html).not.toContain("evil.example");
  });
});
