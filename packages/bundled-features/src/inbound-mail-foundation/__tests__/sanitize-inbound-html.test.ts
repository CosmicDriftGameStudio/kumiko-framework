import { describe, expect, test } from "bun:test";
import {
  INBOUND_HTML_MAX_NESTING_DEPTH,
  INBOUND_HTML_MAX_TAG_OPENERS,
  inboundHtmlToText,
  sanitizeInboundHtml,
} from "../sanitize-inbound-html.ts";

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

  test("the cap counts UTF-8 bytes: a multi-byte mail under 500,000 characters can still be too large", () => {
    // "€" takes three bytes: 200,000 characters are 600,000 bytes.
    expect(sanitizeInboundHtml(`<p>${"€".repeat(200_000)}</p>`)).toBeNull();
    const nearCap = `<p>${"€".repeat(166_000)}</p>`;
    expect(sanitizeInboundHtml(nearCap)).toBe(nearCap);
  });
});

describe("parse limits", () => {
  test("depth exactly at the limit is kept", () => {
    const out = sanitizeInboundHtml(`${"<div>".repeat(INBOUND_HTML_MAX_NESTING_DEPTH)}x`);
    expect(out).not.toBeNull();
    expect(out).toContain("x");
  });

  test("one level deeper than the limit yields null", () => {
    expect(
      sanitizeInboundHtml(`${"<div>".repeat(INBOUND_HTML_MAX_NESTING_DEPTH + 1)}x`),
    ).toBeNull();
  });

  test("alternating p and li above the limit yields null", () => {
    expect(sanitizeInboundHtml(`${"<p><li>".repeat(INBOUND_HTML_MAX_NESTING_DEPTH)}x`)).toBeNull();
  });

  test("depth above the limit plus many unmatched end tags yields null", () => {
    const html = `${"<b>".repeat(INBOUND_HTML_MAX_NESTING_DEPTH + 1)}${"</x>".repeat(100_000)}`;
    expect(sanitizeInboundHtml(html)).toBeNull();
  });

  test("truncated tags inside dropped iframes do not lower the depth count", () => {
    const html = `${"<iframe><b </iframe>".repeat(2000)}${"<div>".repeat(1001)}x`;
    expect(sanitizeInboundHtml(html)).toBeNull();
  });

  test("a few iframes and 1000 levels are kept", () => {
    const html = `${"<iframe><b </iframe>".repeat(50)}${"<div>".repeat(1000)}x`;
    expect(sanitizeInboundHtml(html)).not.toBeNull();
  });

  test("999 levels with many unmatched end tags are kept", () => {
    const html = `${"<div>".repeat(999)}${"</p></br></x>".repeat(2000)}x`;
    expect(sanitizeInboundHtml(html)).not.toBeNull();
  });

  test("3000 unclosed table rows are kept", () => {
    expect(sanitizeInboundHtml(`<table>${"<tr><td>a".repeat(3000)}</table>`)).not.toBeNull();
  });

  test("a 60-level reply chain is kept", () => {
    const html = `${"<div><blockquote><div><table><tbody><tr><td><div>".repeat(60)}q`;
    expect(sanitizeInboundHtml(html)).toContain("q");
  });

  test("the tag budget is enforced on '<' count", () => {
    const over = `${"<x></x>".repeat(INBOUND_HTML_MAX_TAG_OPENERS / 2 + 1)}<p>ok</p>`;
    expect(sanitizeInboundHtml(over)).toBeNull();
    const under = `${"<x></x>".repeat(INBOUND_HTML_MAX_TAG_OPENERS / 2 - 2)}<p>ok</p>`;
    expect(sanitizeInboundHtml(under)).toBe("<p>ok</p>");
  });

  test("a long data: URL does not count against the budget", () => {
    const html = `<p>a</p><img src="data:image/png;base64,${"A".repeat(2_000_000)}">`;
    expect(sanitizeInboundHtml(html)).toBe("<p>a</p>");
  });

  test("the call after an abort sanitizes normally", () => {
    expect(
      sanitizeInboundHtml(`${"<div>".repeat(INBOUND_HTML_MAX_NESTING_DEPTH + 1)}x`),
    ).toBeNull();
    expect(sanitizeInboundHtml("<p>a</p>")).toBe("<p>a</p>");
  });
});

describe("inboundHtmlToText", () => {
  test("converts a HTML-only body to text", () => {
    expect(
      inboundHtmlToText(
        "<html><body><h1>Hello</h1><p>Only an HTML part, no text alternative.</p></body></html>",
      ),
    ).toBe("HELLO\n\nOnly an HTML part, no text alternative.");
  });

  test("HTML nested past the limit yields empty text", () => {
    expect(inboundHtmlToText(`${"<p><li>".repeat(INBOUND_HTML_MAX_NESTING_DEPTH)}x`)).toBe("");
  });

  test("style and script content is not part of the text", () => {
    expect(inboundHtmlToText("<style>p{color:red}</style><script>x()</script><p>a</p>")).toBe("a");
  });

  test("the title is not part of the text", () => {
    const html = "<html><head><title>T</title></head><body>B</body></html>";
    expect(inboundHtmlToText(html)).toBe("B");
  });

  test("section elements stay on separate lines", () => {
    const html = "<header>Head</header><section>First</section><section>Second</section>";
    expect(inboundHtmlToText(html)).toBe("Head\nFirst\nSecond");
  });

  test("deeply quoted HTML with many lines yields empty text", () => {
    const html = `${"<blockquote>".repeat(900)}<pre>${"a\n".repeat(20_000)}</pre>`;
    expect(inboundHtmlToText(html)).toBe("");
  });

  test("a normal quote with many lines keeps its text", () => {
    const html = `<blockquote><pre>${"a\n".repeat(2000)}</pre></blockquote>`;
    expect(inboundHtmlToText(html)).toContain("> a");
  });

  test("past the tag budget the text of the first tags is kept", () => {
    const html = `<p>Opening text</p>${"<x></x>".repeat(INBOUND_HTML_MAX_TAG_OPENERS)}<p>Late text</p>`;
    const text = inboundHtmlToText(html);
    expect(text).toContain("Opening text");
    expect(text).not.toContain("Late text");
  });
});
