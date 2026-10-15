import { describe, expect, test } from "bun:test";
import {
  readLayoutRegions,
  sanitizeLayoutHtml,
  sanitizeTemplateWriteBody,
} from "../layout-regions";

const VALID =
  '<div data-header><p>Head <span data-variable="tenantName"></span></p></div><div data-content></div><div data-footer><p>Foot</p></div>';

function codes(result: ReturnType<typeof sanitizeLayoutHtml>): string[] {
  return result.ok ? [] : result.violations.map((item) => item.code);
}

describe("sanitizeLayoutHtml", () => {
  test("keeps the regions in canonical order and drops empty ones", () => {
    const result = sanitizeLayoutHtml(
      "<div data-footer><p>F</p></div>\n<div data-content></div><div data-header><p>H</p></div><div data-signature> </div>",
    );
    expect(result).toEqual({
      ok: true,
      html: "<div data-header><p>H</p></div><div data-content></div><div data-footer><p>F</p></div>",
    });
  });

  test("requires the content slot, empty and exactly once", () => {
    expect(codes(sanitizeLayoutHtml("<div data-header><p>H</p></div>"))).toEqual([
      "layout_missing_content_slot",
    ]);
    expect(codes(sanitizeLayoutHtml("<div data-content><p>x</p></div>"))).toEqual([
      "layout_invalid_structure",
    ]);
    expect(codes(sanitizeLayoutHtml("<div data-content></div><div data-content></div>"))).toEqual([
      "layout_invalid_structure",
    ]);
  });

  test("rejects anything but the four region divs at the top level", () => {
    expect(codes(sanitizeLayoutHtml("<div data-content></div><p>loose</p>"))).toEqual([
      "layout_invalid_structure",
    ]);
    expect(codes(sanitizeLayoutHtml("stray<div data-content></div>"))).toEqual([
      "layout_invalid_structure",
    ]);
    expect(codes(sanitizeLayoutHtml("<div data-content></div><div>plain</div>"))).toEqual([
      "layout_invalid_structure",
    ]);
  });

  test("passes region sanitizer violations through", () => {
    expect(
      codes(
        sanitizeLayoutHtml("<div data-header><script>x</script></div><div data-content></div>"),
      ),
    ).toContain("script_element");
  });
});

describe("readLayoutRegions", () => {
  test("returns the inner html of each region, empty when missing", () => {
    const regions = readLayoutRegions(VALID);
    expect(regions.header).toContain("Head");
    expect(regions.footer).toBe("<p>Foot</p>");
    expect(regions.signature).toBe("");
  });
});

describe("sanitizeTemplateWriteBody layout rules", () => {
  const mjml = "<mjml><mj-body><mj-raw>{{{content}}}</mj-raw></mj-body></mjml>";

  test("system mjml needs the content slot exactly once", () => {
    const write = (content: string) =>
      sanitizeTemplateWriteBody({
        kind: "mail-layout",
        scope: "system",
        contentFormat: "mjml",
        content,
      });
    expect(write(mjml)).toEqual({ ok: true, content: mjml });
    const missing = write("<mjml></mjml>");
    expect(!missing.ok && missing.violations[0]?.code).toBe("layout_missing_content_slot");
    expect(write(`${mjml}${mjml}`).ok).toBe(false);
  });

  test("tenant mjml is refused, tenant html is structured", () => {
    const tenantMjml = sanitizeTemplateWriteBody({
      kind: "mail-layout",
      scope: "tenant",
      contentFormat: "mjml",
      content: mjml,
    });
    expect(!tenantMjml.ok && tenantMjml.violations[0]?.code).toBe("layout_source_system_only");
    const tenantHtml = sanitizeTemplateWriteBody({
      kind: "mail-layout",
      scope: "tenant",
      contentFormat: "html",
      content: VALID,
    });
    expect(tenantHtml.ok).toBe(true);
  });

  test("pdf-layout is html only and structured, also for the system", () => {
    const markdown = sanitizeTemplateWriteBody({
      kind: "pdf-layout",
      scope: "system",
      contentFormat: "markdown",
      content: "x",
    });
    expect(!markdown.ok && markdown.violations[0]?.code).toBe("document_requires_html_format");
    const noSlot = sanitizeTemplateWriteBody({
      kind: "pdf-layout",
      scope: "system",
      contentFormat: "html",
      content: "<p>x</p>",
    });
    expect(noSlot.ok).toBe(false);
  });
});
