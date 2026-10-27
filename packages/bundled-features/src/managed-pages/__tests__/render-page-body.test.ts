import { describe, expect, test } from "bun:test";
import { renderPageBody } from "../render-page-body.ts";

type Warning = { message: string; data: Record<string, unknown> | undefined };

function collectingLogger() {
  const warnings: Warning[] = [];
  return {
    warnings,
    log: {
      warn: (message: string, data?: Record<string, unknown>) => {
        warnings.push({ message, data });
      },
    },
  };
}

describe("renderPageBody", () => {
  test("markdown goes through the markdown renderer", () => {
    const { log, warnings } = collectingLogger();
    const html = renderPageBody(
      { slug: "a", body: "# T\n\n**bold**", bodyFormat: "markdown" },
      log,
    );
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
    expect(warnings).toHaveLength(0);
  });

  test("raw HTML in a markdown body stays escaped", () => {
    const html = renderPageBody({ slug: "a", body: "<b>x</b>", bodyFormat: "markdown" });
    expect(html).toContain("&lt;b&gt;");
  });

  test("a document body is emitted as sanitized HTML, not escaped", () => {
    const { log, warnings } = collectingLogger();
    const html = renderPageBody(
      { slug: "a", body: "<p>Hi <strong>there</strong></p>", bodyFormat: "document" },
      log,
    );
    expect(html).toContain("<strong>there</strong>");
    expect(html).not.toContain("&lt;");
    expect(warnings).toHaveLength(0);
  });

  test("a document that fails the sanitizer renders empty and logs a warning", () => {
    const { log, warnings } = collectingLogger();
    const html = renderPageBody(
      { slug: "bad", body: "<p>ok</p><script>alert(1)</script>", bodyFormat: "document" },
      log,
    );
    expect(html).toBe("");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.data?.["slug"]).toBe("bad");
    expect(warnings[0]?.data?.["violations"]).toEqual(expect.arrayContaining([expect.any(String)]));
  });
});
