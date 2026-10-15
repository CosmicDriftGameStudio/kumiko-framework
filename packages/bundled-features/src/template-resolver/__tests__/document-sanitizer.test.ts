import { describe, expect, test } from "bun:test";
import { sanitizeDocumentHtml, sanitizeTemplateBody } from "../document-sanitizer";
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

  test("reports the offending href in the message", () => {
    const result = sanitizeDocumentHtml('<a href="javascript:alert(1)">x</a>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]?.message).toBe(
        'Link target "javascript:alert(1)" is not allowed; use https, http, mailto, tel or a {{placeholder}}',
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
      '<div class="x"><p style="color:red" data-foo="1">Hi</p><iframe src="https://x"></iframe><style>p{}</style></div>',
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

  test("passes mail-html markdown through unchanged", () => {
    expect(
      sanitizeTemplateBody({ kind: "mail-html", contentFormat: "markdown", content: "<script>" }),
    ).toEqual({ ok: true, content: "<script>" });
  });

  test("sanitizes mail-html html", () => {
    expect(
      sanitizeTemplateBody({
        kind: "mail-html",
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
