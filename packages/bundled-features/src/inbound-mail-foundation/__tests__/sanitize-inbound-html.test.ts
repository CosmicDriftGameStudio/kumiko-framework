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

  test.each([
    "/api/files/x",
    "//evil.test/x.png",
    "\\\\evil.test\\x.png",
    "/\\evil.test/x.png",
    "x.png",
    "https:x.png",
  ])("drops images with the non-absolute src %s", (src) => {
    expect(sanitizeInboundHtml(`<p>a</p><img src="${src}">`)).toBe("<p>a</p>");
  });

  test.each(["/admin", "//evil.test/", "\\\\evil.test", "/\\evil.test", "page.html", "https:evil"])(
    "drops the non-absolute href %s but keeps the link text",
    (href) => {
      const out = sanitizeInboundHtml(`<a href="${href}">text</a>`) ?? "";
      expect(out).not.toContain("href=");
      expect(out).toContain("text");
    },
  );

  test("absolute, mailto and tel links keep their href", () => {
    for (const href of ["https://a.test/x", "http://a.test", "mailto:a@b.test", "tel:+4930123"]) {
      expect(sanitizeInboundHtml(`<a href="${href}">t</a>`)).toContain(`href="${href}"`);
    }
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

  describe("quote markers", () => {
    test("keeps the quote markers of Gmail, Apple Mail, Thunderbird, Yahoo and Outlook", () => {
      const html =
        '<div class="gmail_quote"><blockquote class="gmail_quote" type="cite">q</blockquote></div>' +
        '<div class="moz-cite-prefix yahoo_quoted">a</div>' +
        '<div id="appendonsend"></div><div id="divRplyFwdMsg">f</div>';
      const out = sanitizeInboundHtml(html) ?? "";
      expect(out).toContain('<div class="gmail_quote">');
      expect(out).toContain('<blockquote class="gmail_quote" type="cite">');
      expect(out).toContain('class="moz-cite-prefix yahoo_quoted"');
      expect(out).toContain('id="appendonsend"');
      expect(out).toContain('id="divRplyFwdMsg"');
    });

    test("other classes, ids and types stay stripped", () => {
      const out =
        sanitizeInboundHtml(
          '<div class="evil gmail_quote" id="login"><blockquote class="x" type="other">q</blockquote></div>' +
            '<p class="gmail_quote" id="appendonsend" type="cite">p</p><span class="gmail_quote">s</span>',
        ) ?? "";
      expect(out).toBe(
        '<div class="gmail_quote"><blockquote>q</blockquote></div><p>p</p><span>s</span>',
      );
    });

    test("script, style and on* handlers are still removed next to quote markers", () => {
      const out =
        sanitizeInboundHtml(
          '<div class="gmail_quote" onclick="x()"><script>alert(1)</script><style>p{}</style>q</div>',
        ) ?? "";
      expect(out).toBe('<div class="gmail_quote">q</div>');
    });
  });

  test("empty result is null", () => {
    expect(sanitizeInboundHtml("")).toBeNull();
    expect(sanitizeInboundHtml("<script>x</script>")).toBeNull();
  });

  test("result above the length cap is null instead of cut", () => {
    expect(sanitizeInboundHtml(`<p>${"a".repeat(500_001)}</p>`)).toBeNull();
  });
});
