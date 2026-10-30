import { describe, expect, test } from "bun:test";
import { sanitizeInboundHtml } from "../sanitize-inbound-html.ts";

describe("sanitizeInboundHtml", () => {
  test("drops script elements with their content and on* attributes", () => {
    const out = sanitizeInboundHtml('<p onclick="x()">Hi</p><script>alert(1)</script>');
    expect(out).toBe("<p>Hi</p>");
  });

  test("removes javascript: links but keeps the text", () => {
    const out = sanitizeInboundHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain("javascript");
    expect(out).toContain("click");
  });

  test("links open in a new window without opener", () => {
    const out = sanitizeInboundHtml('<a href="https://example.test/x">go</a>') ?? "";
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('href="https://example.test/x"');
  });

  test("drops cid: and data: images, keeps http(s) images", () => {
    expect(sanitizeInboundHtml('<p>a</p><img src="cid:logo@x">')).toBe("<p>a</p>");
    expect(sanitizeInboundHtml('<p>a</p><img src="data:image/png;base64,AAAA">')).toBe("<p>a</p>");
    expect(sanitizeInboundHtml('<img src="https://cdn.example.test/i.png" alt="i">')).toContain(
      'src="https://cdn.example.test/i.png"',
    );
  });

  test("style keeps allowed properties and drops url() values", () => {
    const out =
      sanitizeInboundHtml(
        '<p style="color: red; background-image: url(https://t.test/p.gif); background-color: url(x)">x</p>',
      ) ?? "";
    expect(out).toContain("color:red");
    expect(out).not.toContain("url(");
    expect(out).not.toContain("background-image");
  });

  test("allowed markup survives", () => {
    const html =
      '<table width="100%"><tbody><tr><td colspan="2" align="left"><b>Bold</b> <i>it</i></td></tr></tbody></table>';
    expect(sanitizeInboundHtml(html)).toBe(html);
  });

  test("forms, iframes and style blocks are gone", () => {
    const out =
      sanitizeInboundHtml(
        '<style>p{color:red}</style><iframe src="https://x.test"></iframe><form><input name="a"></form><p>ok</p>',
      ) ?? "";
    expect(out).toBe("<p>ok</p>");
  });

  test("empty result is null", () => {
    expect(sanitizeInboundHtml("")).toBeNull();
    expect(sanitizeInboundHtml("<script>x</script>")).toBeNull();
  });

  test("result above the length cap is null instead of cut", () => {
    expect(sanitizeInboundHtml(`<p>${"a".repeat(500_001)}</p>`)).toBeNull();
  });
});
