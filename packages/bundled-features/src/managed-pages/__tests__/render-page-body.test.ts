import { describe, expect, test } from "bun:test";
import { sanitizeDocumentHtml } from "../../template-resolver/index.ts";
import { createPageBodyRenderer, type RenderablePageBody } from "../render-page-body.ts";

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

function pageOf(overrides: Partial<RenderablePageBody>): RenderablePageBody {
  return {
    tenantId: "tenant-a",
    slug: "a",
    lang: "en",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    body: "",
    bodyFormat: "document",
    ...overrides,
  };
}

describe("renderPageBody", () => {
  const renderPageBody = createPageBodyRenderer();

  test("markdown goes through the markdown renderer", () => {
    const { log, warnings } = collectingLogger();
    const html = renderPageBody(pageOf({ body: "# T\n\n**bold**", bodyFormat: "markdown" }), log);
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
    expect(warnings).toHaveLength(0);
  });

  test("raw HTML in a markdown body stays escaped", () => {
    const html = renderPageBody(
      pageOf({ slug: "md-raw", body: "<b>x</b>", bodyFormat: "markdown" }),
    );
    expect(html).toContain("&lt;b&gt;");
  });

  test("a document body is emitted as sanitized HTML, not escaped", () => {
    const { log, warnings } = collectingLogger();
    const html = renderPageBody(pageOf({ body: "<p>Hi <strong>there</strong></p>" }), log);
    expect(html).toContain("<strong>there</strong>");
    expect(html).not.toContain("&lt;");
    expect(warnings).toHaveLength(0);
  });

  test("a document that fails the sanitizer renders empty and logs a warning", () => {
    const { log, warnings } = collectingLogger();
    const html = renderPageBody(
      pageOf({ slug: "bad", body: "<p>ok</p><script>alert(1)</script>" }),
      log,
    );
    expect(html).toBe("");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.data?.["slug"]).toBe("bad");
    expect(warnings[0]?.data?.["violations"]).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  test("a relative link survives the render", () => {
    const html = renderPageBody(
      pageOf({ slug: "rel", body: '<p><a href="/impressum">Imprint</a></p>' }),
    );
    expect(html).toContain('href="/impressum"');
  });
});

describe("renderPageBody cache", () => {
  function countingRenderer(maxEntries?: number) {
    const calls = { sanitize: 0, markdown: 0 };
    const render = createPageBodyRenderer({
      sanitizeDocument: (html) => {
        calls.sanitize += 1;
        return sanitizeDocumentHtml(html);
      },
      renderMarkdown: (markdown) => {
        calls.markdown += 1;
        return `<p>${markdown}</p>`;
      },
      ...(maxEntries === undefined ? {} : { maxEntries }),
    });
    return { calls, render };
  }

  test("the same key sanitizes once", () => {
    const { calls, render } = countingRenderer();
    const page = pageOf({ body: "<p>x</p>" });
    expect(render(page)).toBe(render(page));
    expect(calls.sanitize).toBe(1);
  });

  test("markdown is rendered once per key as well", () => {
    const { calls, render } = countingRenderer();
    const page = pageOf({ body: "x", bodyFormat: "markdown" });
    render(page);
    render(page);
    expect(calls.markdown).toBe(1);
  });

  test("a new version, tenant or slug sanitizes again", () => {
    const { calls, render } = countingRenderer();
    render(pageOf({ body: "<p>x</p>" }));
    render(pageOf({ body: "<p>y</p>", version: 2 }));
    render(pageOf({ body: "<p>x</p>", tenantId: "tenant-b" }));
    render(pageOf({ body: "<p>x</p>", slug: "other" }));
    expect(calls.sanitize).toBe(4);
  });

  test("a rejected body is cached as empty and warns only on the miss", () => {
    const { calls, render } = countingRenderer();
    const { log, warnings } = collectingLogger();
    const page = pageOf({ body: "<script>x</script>" });
    expect(render(page, log)).toBe("");
    expect(render(page, log)).toBe("");
    expect(calls.sanitize).toBe(1);
    expect(warnings).toHaveLength(1);
  });

  test("the least recently used entry is evicted at the cap", () => {
    const { calls, render } = countingRenderer(2);
    const first = pageOf({ slug: "one", body: "<p>1</p>" });
    const second = pageOf({ slug: "two", body: "<p>2</p>" });
    const third = pageOf({ slug: "three", body: "<p>3</p>" });
    render(first);
    render(second);
    render(first);
    render(third);
    expect(calls.sanitize).toBe(3);
    render(first);
    expect(calls.sanitize).toBe(3);
    render(second);
    expect(calls.sanitize).toBe(4);
  });

  test("a body above 256 KiB is returned but not cached", () => {
    let calls = 0;
    const huge = `<p>${"x".repeat(256 * 1024)}</p>`;
    const render = createPageBodyRenderer({
      sanitizeDocument: () => {
        calls += 1;
        return { ok: true, html: huge };
      },
    });
    const page = pageOf({ body: "<p>x</p>" });
    expect(render(page)).toBe(huge);
    expect(render(page)).toBe(huge);
    expect(calls).toBe(2);
  });

  test("the real sanitizer output is free of unsafe markup on the miss and on the hit", () => {
    const render = createPageBodyRenderer();
    const page = pageOf({
      slug: "real",
      body: '<p>Hi <a href="/contact">contact</a></p><script>alert(1)</script>',
    });
    const safe = pageOf({
      slug: "real-safe",
      body: '<p>Hi <a href="/contact">contact</a> <span style="x" data-foo="1">t</span></p>',
    });
    expect(render(page)).toBe("");
    expect(render(page)).toBe("");
    const first = render(safe);
    const second = render(safe);
    expect(second).toBe(first);
    expect(first).toContain('href="/contact"');
    expect(first).not.toMatch(/<script|style=|data-foo|onclick/i);
  });
});
