import { describe, expect, test } from "bun:test";
import { generateHTML, generateJSON } from "@tiptap/html/server";
import { sanitizeDocumentHtml, sanitizeTemplateBody } from "../document-sanitizer";
import { DOCUMENT_TEXT_ALIGNMENTS, documentExtensions } from "../web/document-schema";
import { documentBodyFixture } from "./document-body-fixture";

function violationCodes(html: string): string[] {
  const result = sanitizeDocumentHtml(html);
  return result.ok ? [] : result.violations.map((item) => item.code);
}

describe("sanitizeDocumentHtml", () => {
  test("keeps a canonical body with every node byte for byte", () => {
    const result = sanitizeDocumentHtml(documentBodyFixture);
    expect(result).toEqual({ ok: true, html: documentBodyFixture });
  });

  test("rejects script elements", () => {
    expect(violationCodes("<p>a</p><script>alert(1)</script>")).toContain("script_element");
  });

  test("rejects inline event handlers", () => {
    expect(violationCodes('<p onclick="x()">a</p>')).toContain("event_handler_attribute");
    expect(violationCodes('<img onerror="x()" data-resource="logo">')).toContain(
      "event_handler_attribute",
    );
  });

  test.each([
    '<a href="javascript:alert(1)">x</a>',
    '<a href="JaVaScRiPt:alert(1)">x</a>',
    '<a href="java&#x09;script:alert(1)">x</a>',
  ])("rejects javascript link %s", (html) => {
    expect(violationCodes(html)).toContain("disallowed_link_href");
  });

  test.each([
    "/impressum",
    "/a/b?x=1#y",
    "./x",
    "../x",
    "#top",
    "?page=2",
    "https://example.com/a",
    "mailto:team@example.com",
  ])("keeps the link target %s", (href) => {
    expect(sanitizeDocumentHtml(`<p><a href="${href}">x</a></p>`)).toEqual({
      ok: true,
      html: `<p><a href="${href}">x</a></p>`,
    });
  });

  test.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//evil.com",
    "/\\evil.com",
    "\\\\evil",
    "x:y/z",
  ])("rejects the link target %j", (href) => {
    const escaped = href.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    expect(violationCodes(`<p><a href="${escaped}">x</a></p>`)).toContain("disallowed_link_href");
  });

  test.each([
    '<form action="/x"><p>a</p></form>',
    '<p><button formaction="/x">a</button></p>',
    '<svg><use xlink:href="/x"></use></svg>',
    '<base href="/x">',
  ])("relative paths are only for anchors: %s", (html) => {
    expect(sanitizeDocumentHtml(html).ok).toBe(false);
  });

  test("reports the offending href in the message", () => {
    const result = sanitizeDocumentHtml('<a href="javascript:alert(1)">x</a>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]?.message).toBe(
        'Link target "javascript:alert(1)" is not allowed; use https, http, mailto, tel, a relative path or a {{placeholder}}',
      );
    }
  });

  test("rejects external and inline image sources", () => {
    expect(violationCodes('<img src="https://evil.example/x.png" data-resource="logo">')).toContain(
      "external_image_source",
    );
    expect(violationCodes('<img src="data:image/png;base64,AAAA" data-resource="logo">')).toContain(
      "external_image_source",
    );
  });

  test("rejects images without a resource", () => {
    expect(violationCodes('<img alt="x">')).toContain("image_without_resource");
  });

  test("rejects a button whose target is not a placeholder", () => {
    expect(violationCodes('<a data-button="" href="https://x.example">Go</a>')).toContain(
      "button_href_not_placeholder",
    );
  });

  test("keeps a placeholder inside a button label", () => {
    const html =
      '<a data-button="" href="{{pageUrl}}">View <span data-variable="pageName"></span> now</a>';
    expect(sanitizeDocumentHtml(html)).toEqual({ ok: true, html });
  });

  test("rejects invalid reference names", () => {
    expect(violationCodes('<p><span data-variable="a b"></span></p>')).toContain(
      "invalid_reference_name",
    );
  });

  test("collects all violations in one pass", () => {
    expect(violationCodes('<script></script><p onclick="x"></p>')).toEqual([
      "script_element",
      "event_handler_attribute",
    ]);
  });

  test("silently drops what the model cannot express", () => {
    const result = sanitizeDocumentHtml(
      '<div class="x"><p style="color:red" data-foo="1">Hi</p><style>p{}</style></div>',
    );
    expect(result).toEqual({ ok: true, html: "<p>Hi</p>" });
  });
});

describe("sanitizeTemplateBody", () => {
  test("rejects document-pdf with a non-html format", () => {
    const result = sanitizeTemplateBody({
      kind: "document-pdf",
      contentFormat: "markdown",
      content: "# x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations[0]?.code).toBe("document_requires_html_format");
  });

  test("snippet html is sanitized like document html, other formats pass untouched", () => {
    const html = sanitizeTemplateBody({
      kind: "snippet",
      contentFormat: "html",
      content: '<p style="color:red">Hi</p>',
    });
    expect(html).toEqual({ ok: true, content: "<p>Hi</p>" });
    const hostile = sanitizeTemplateBody({
      kind: "snippet",
      contentFormat: "html",
      content: '<p onclick="x()">Hi</p>',
    });
    expect(hostile.ok).toBe(false);
    expect(
      sanitizeTemplateBody({ kind: "snippet", contentFormat: "markdown", content: "# Hi" }),
    ).toEqual({ ok: true, content: "# Hi" });
  });

  test("mail and PDF bodies reject a relative link, snippets keep it", () => {
    const content = '<p><a href="/impressum">Imprint</a></p>';
    for (const kind of ["mail", "document-pdf"]) {
      const result = sanitizeTemplateBody({ kind, contentFormat: "html", content });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations[0]?.code).toBe("relative_link_without_base");
    }
    expect(
      sanitizeTemplateBody({
        kind: "mail",
        contentFormat: "html",
        content: '<a href="https://x.example/a">x</a>',
      }).ok,
    ).toBe(true);
    expect(sanitizeTemplateBody({ kind: "snippet", contentFormat: "html", content }).ok).toBe(true);
  });

  test("rejects mail with a non-html format and names the kind", () => {
    const result = sanitizeTemplateBody({ kind: "mail", contentFormat: "markdown", content: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]?.code).toBe("document_requires_html_format");
      expect(result.violations[0]?.message).toContain("kind mail");
    }
  });

  test("sanitizes mail html", () => {
    expect(
      sanitizeTemplateBody({
        kind: "mail",
        contentFormat: "html",
        content: '<p class="x">a</p>',
      }),
    ).toEqual({ ok: true, content: "<p>a</p>" });
  });

  test("keeps null content null", () => {
    expect(
      sanitizeTemplateBody({ kind: "document-pdf", contentFormat: "html", content: null }),
    ).toEqual({ ok: true, content: null });
  });
});

describe("sanitizeDocumentHtml :: hostile input", () => {
  const rejected: ReadonlyArray<readonly [string, string, string]> = [
    ["proto placeholder link", '<a href="{{__proto__}}">x</a>', "disallowed_link_href"],
    [
      "prototype chain placeholder link",
      '<a href="{{constructor.prototype}}">x</a>',
      "disallowed_link_href",
    ],
    [
      "proto placeholder button",
      '<a data-button="" href="{{__proto__}}">Go</a>',
      "button_href_not_placeholder",
    ],
    [
      "prototype chain placeholder button",
      '<a data-button="" href="{{constructor.prototype}}">Go</a>',
      "button_href_not_placeholder",
    ],
    ["uppercase script", "<SCRIPT>alert(1)</SCRIPT>", "script_element"],
    ["script with src", "<ScRiPt src=//evil.example/x.js></ScRiPt>", "script_element"],
    ["uppercase handler", '<p ONCLICK="x()">a</p>', "event_handler_attribute"],
    ["attribute named on", '<p on click="x()">a</p>', "event_handler_attribute"],
    ["handler after newline", '<img\nonerror="x()" data-resource="a">', "event_handler_attribute"],
    ["leading space javascript", '<a href=" javascript:alert(1)">x</a>', "disallowed_link_href"],
    ["entity javascript", '<a href="java&#115;cript:alert(1)">x</a>', "disallowed_link_href"],
    ["tab javascript", '<a href="jav\tascript:alert(1)">x</a>', "disallowed_link_href"],
    [
      "newline entity javascript",
      '<a href="jav&#x0A;ascript:alert(1)">x</a>',
      "disallowed_link_href",
    ],
    ["percent-encoded javascript", '<a href="javascript%3Aalert(1)">x</a>', "disallowed_link_href"],
    ["data link", '<a href="data:text/html,<b>x</b>">x</a>', "disallowed_link_href"],
    ["vbscript", '<a href="vbscript:x">x</a>', "disallowed_link_href"],
    ["protocol-relative link", '<a href="//evil.example/x">x</a>', "disallowed_link_href"],
    ["uppercase scheme", '<a href="HTTPS://ok.example">x</a>', "disallowed_link_href"],
    [
      "quote in href",
      '<a href="https://x.example/&quot;onmouseover=x">x</a>',
      "disallowed_link_href",
    ],
    ["markup in href", '<a href="https://x/&lt;img&gt;">x</a>', "disallowed_link_href"],
    [
      "protocol-relative img",
      '<img src="//evil.example/x.png" data-resource="a">',
      "external_image_source",
    ],
    [
      "img srcset",
      '<img srcset="https://x.example/a.png 2x" data-resource="a">',
      "external_image_source",
    ],
    ["iframe srcdoc", '<iframe srcdoc="<script>x</script>"></iframe>', "embedded_content"],
    ["object", '<object data="https://x.example/a.swf"></object>', "embedded_content"],
    ["embed", '<embed src="https://x.example/a.swf">', "embedded_content"],
    [
      "svg foreignObject img",
      '<svg><foreignObject><img src="https://x.example/a.png"></foreignObject></svg>',
      "external_image_source",
    ],
    [
      "svg image",
      '<svg><image href="https://x.example/a.png"></image></svg>',
      "external_image_source",
    ],
    [
      "svg xlink link",
      '<svg><a xlink:href="javascript:alert(1)">x</a></svg>',
      "disallowed_link_href",
    ],
    ["form action", '<form action="javascript:alert(1)"><p>a</p></form>', "disallowed_link_href"],
    [
      "button formaction",
      '<button formaction="javascript:alert(1)">a</button>',
      "disallowed_link_href",
    ],
    ["base href", '<base href="https://evil.example/">', "disallowed_link_href"],
    [
      "nested anchors",
      "<a href=https://ok.example><a href=javascript:x>y</a></a>",
      "disallowed_link_href",
    ],
    [
      "broken anchors",
      "<a href='https://ok.example'>x</p></a><a href=javascript:alert(1)>y",
      "disallowed_link_href",
    ],
    [
      "comment smuggling",
      '<!--<img src="--><img src=x onerror=alert(1)>-->',
      "event_handler_attribute",
    ],
    ["second body", "</body><body onload=alert(1)>", "event_handler_attribute"],
    ["proto variable", '<p><span data-variable="__proto__"></span></p>', "invalid_reference_name"],
    [
      "constructor path",
      '<p><span data-variable="constructor.prototype"></span></p>',
      "invalid_reference_name",
    ],
    [
      "markup in alt",
      '<img data-resource="a" alt="&lt;img src=x onerror=alert(1)&gt;">',
      "unsafe_attribute_value",
    ],
  ];

  test.each(rejected)("rejects %s", (_name, html, code) => {
    expect(violationCodes(html)).toContain(code);
  });

  const stripped: ReadonlyArray<readonly [string, string, string]> = [
    ["style url", '<p style="background:url(https://x.example/a.png)">a</p>', "<p>a</p>"],
    ["style expression", '<p style="width:expression(alert(1))">a</p>', "<p>a</p>"],
    ["heading attributes", '<h1 id="i" class="c" title="t" data-foo="1">a</h1>', "<h1>a</h1>"],
    [
      "variable extras",
      '<p><span data-variable="x" class="c" style="color:red"></span></p>',
      '<p><span data-variable="x"></span></p>',
    ],
    [
      "button extras",
      '<a data-button="" href="{{x}}" target="_blank" rel="noopener" style="color:red">go</a>',
      '<a data-button="" href="{{x}}">go</a>',
    ],
    [
      "link extras",
      '<p><a href="https://x.example/a" target="_blank" rel="noopener">go</a></p>',
      '<p><a href="https://x.example/a">go</a></p>',
    ],
  ];

  test.each(stripped)("silently drops %s", (_name, html, expected) => {
    expect(sanitizeDocumentHtml(html)).toEqual({ ok: true, html: expected });
  });
});

describe("document schema alone (second line of defence)", () => {
  function rebuild(html: string): string {
    return generateHTML(generateJSON(html, documentExtensions), documentExtensions);
  }

  test("drops a javascript link", () => {
    expect(rebuild('<p><a href="javascript:alert(1)">x</a></p>')).toBe("<p>x</p>");
  });

  test("drops a button with a javascript target", () => {
    expect(rebuild('<a data-button="" href="javascript:alert(1)">x</a>')).not.toContain("<a");
  });

  test("keeps only data-resource on an image", () => {
    expect(rebuild('<img src="https://x.example/a.png" onerror="x()" data-resource="logo">')).toBe(
      '<img data-resource="logo">',
    );
  });

  test("drops a variable span with an invalid name", () => {
    expect(rebuild('<p>a<span data-variable="a b"></span></p>')).toBe("<p>a</p>");
  });

  test.each([...DOCUMENT_TEXT_ALIGNMENTS])(
    "keeps data-align=%s on paragraph and heading",
    (align) => {
      const html = `<h2 data-align="${align}">T</h2><p data-align="${align}">x</p>`;
      expect(rebuild(html)).toBe(html);
    },
  );

  test.each([
    ['<p data-align="middle">x</p>', "<p>x</p>"],
    ['<p data-align="CENTER">x</p>', "<p>x</p>"],
    ['<p style="text-align:center">x</p>', "<p>x</p>"],
    ['<p data-align="center;color:red">x</p>', "<p>x</p>"],
    ['<div data-align="center">x</div>', "<p>x</p>"],
  ])("drops the alignment of %s", (html, expected) => {
    expect(sanitizeDocumentHtml(html)).toEqual({ ok: true, html: expected });
  });

  test("drops an invalid data-each", () => {
    expect(
      rebuild('<table><tbody><tr data-each="a b"><td><p>x</p></td></tr></tbody></table>'),
    ).not.toContain("data-each");
  });
});

describe("underline", () => {
  test("keeps <u> and drops attributes on it", () => {
    expect(sanitizeDocumentHtml("<p><u>x</u></p>")).toEqual({ ok: true, html: "<p><u>x</u></p>" });
    expect(sanitizeDocumentHtml('<p><u class="a" style="color:red">x</u></p>')).toEqual({
      ok: true,
      html: "<p><u>x</u></p>",
    });
  });
});

describe("steps block", () => {
  const steps =
    '<div data-steps="stage"><span data-step="reported">Gemeldet</span><span data-step="resolved">Behoben</span></div>';

  test("keeps a steps block byte for byte", () => {
    expect(sanitizeDocumentHtml(steps)).toEqual({ ok: true, html: steps });
  });

  test("rejects an invalid variable or step key", () => {
    expect(violationCodes('<div data-steps="a b"><span data-step="x">X</span></div>')).toContain(
      "invalid_reference_name",
    );
    expect(
      violationCodes('<div data-steps="stage"><span data-step="a b">X</span></div>'),
    ).toContain("invalid_reference_name");
  });

  test("the schema alone drops a block with duplicate keys or markup in a label", () => {
    const rebuild = (html: string): string =>
      generateHTML(generateJSON(html, documentExtensions), documentExtensions);
    expect(
      rebuild(
        '<div data-steps="stage"><span data-step="a">A</span><span data-step="a">B</span></div>',
      ),
    ).not.toContain("data-steps");
    expect(
      rebuild('<div data-steps="stage"><span data-step="a"><b>A</b><img src="x"></span></div>'),
    ).toBe('<div data-steps="stage"><span data-step="a">A</span></div>');
  });
});

describe("sanitizeDocumentHtml :: data-if", () => {
  test("a condition on a paragraph, heading and table row survives the round trip", () => {
    const html =
      '<p data-if="discount">a</p><h2 data-if="note">b</h2><table><tbody><tr data-if="discount"><td><p>c</p></td></tr></tbody></table>';
    expect(sanitizeDocumentHtml(html)).toEqual({ ok: true, html });
  });

  test("a condition with an invalid name is rejected", () => {
    expect(violationCodes('<p data-if="a b">x</p>')).toContain("invalid_reference_name");
  });
});

describe("images block", () => {
  const images = '<div data-images="photos"></div>';
  const input = (kind: string) => ({ kind, contentFormat: "html" as const, content: images });

  test("document-pdf keeps the block byte for byte", () => {
    expect(sanitizeTemplateBody(input("document-pdf"))).toEqual({ ok: true, content: images });
  });

  test("a mail kind rejects the block", () => {
    const result = sanitizeTemplateBody(input("mail"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations[0]?.code).toBe("images_block_pdf_only");
  });

  test("an invalid variable name drops the block", () => {
    expect(
      sanitizeTemplateBody({ ...input("document-pdf"), content: '<div data-images="a b"></div>' }),
    ).not.toEqual({ ok: true, content: '<div data-images="a b"></div>' });
  });

  test("keeps data-image-columns of 1, 2 and 3 and drops any other value", () => {
    const withColumns = (value: string) => ({
      ...input("document-pdf"),
      content: `<div data-images="photos" data-image-columns="${value}"></div>`,
    });
    for (const value of ["1", "2", "3"]) {
      expect(sanitizeTemplateBody(withColumns(value))).toEqual({
        ok: true,
        content: `<div data-images="photos" data-image-columns="${value}"></div>`,
      });
    }
    expect(sanitizeTemplateBody(withColumns("4"))).toEqual({ ok: true, content: images });
  });
});

describe("print styling attributes", () => {
  const FRAME =
    '<div data-frame="" data-x="20" data-y="45" data-width="85" data-height="40" data-frame-preset="address" data-frame-flow="over"><p>Hi</p></div>';
  const roundTrips = [
    '<p><span data-text-style="" data-color="#ff0000" data-font="calibri" data-size-pt="11.5">x</span></p>',
    '<p data-line-height="1.5" data-space-before="6" data-space-after="12">x</p>',
    '<table data-borders="none"><tbody><tr><td data-colwidth="100" data-background="#eeeeee"><p>x</p></td></tr></tbody></table>',
    '<img data-resource="logo" data-bleed="">',
    FRAME,
  ];

  test.each(roundTrips)("keeps %s", (html) => {
    expect(sanitizeDocumentHtml(html)).toEqual({ ok: true, html });
  });

  test("drops invalid values instead of keeping them", () => {
    expect(
      sanitizeDocumentHtml(
        '<p><span data-text-style="" data-color="red;background:url(x)" data-font="comic" data-size-pt="999">x</span></p>',
      ),
    ).toEqual({ ok: true, html: "<p>x</p>" });
    expect(sanitizeDocumentHtml('<p data-line-height="9" data-space-before="-1">x</p>')).toEqual({
      ok: true,
      html: "<p>x</p>",
    });
  });

  test("a frame with an out-of-range dimension is unwrapped", () => {
    expect(
      sanitizeDocumentHtml(
        '<div data-frame="" data-x="1" data-y="1" data-width="5000" data-height="1"><p>x</p></div>',
      ),
    ).toEqual({ ok: true, html: "<p>x</p>" });
  });

  const NESTED =
    '<div data-frame="" data-x="1" data-y="1" data-width="1" data-height="1"><div data-frame="" data-x="1" data-y="1" data-width="1" data-height="1"><p>x</p></div></div>';
  const IN_CELL =
    '<table><tbody><tr><td><div data-frame="" data-x="1" data-y="1" data-width="1" data-height="1"><p>x</p></div></td></tr></tbody></table>';

  test.each([NESTED, IN_CELL])("rejects a frame that is not top level", (html) => {
    expect(violationCodes(html)).toContain("frame_not_top_level");
  });

  const frameAt = (y: number, height: number) =>
    `<div data-frame="" data-x="20" data-y="${y}" data-width="80" data-height="${height}"><p>x</p></div>`;

  test("rejects a frame that reaches past the largest paper", () => {
    expect(violationCodes(frameAt(900, 20))).toContain("frame_outside_page");
    expect(violationCodes(frameAt(290, 20))).toContain("frame_outside_page");
  });

  test("accepts a frame inside the paper", () => {
    expect(violationCodes(frameAt(250, 40))).not.toContain("frame_outside_page");
  });

  test.each(roundTrips)("a mail rejects the PDF-only feature %s", (content) => {
    const result = sanitizeTemplateBody({ kind: "mail", contentFormat: "html", content });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations[0]?.code).toBe("print_style_pdf_only");
  });

  test("a document-pdf keeps them", () => {
    expect(
      sanitizeTemplateBody({ kind: "document-pdf", contentFormat: "html", content: FRAME }),
    ).toEqual({ ok: true, content: FRAME });
  });
});
