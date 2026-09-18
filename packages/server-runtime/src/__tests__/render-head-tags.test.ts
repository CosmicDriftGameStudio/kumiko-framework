import { describe, expect, test } from "bun:test";
import { injectPageHead } from "../render-head-tags";

describe("injectPageHead", () => {
  const TAGS = '<title>New Title</title>\n<meta name="description" content="d">';

  test("replaces an existing <title> instead of duplicating it", () => {
    const html = "<html><head><title>Old</title></head><body></body></html>";
    const out = injectPageHead(html, TAGS);
    expect(out).not.toContain("<title>Old</title>");
    expect((out.match(/<title>/g) ?? []).length).toBe(1);
    expect(out).toContain("<title>New Title</title>");
  });

  test("applying twice does not duplicate the head-tags block", () => {
    const html = "<html><head><title>Old</title></head><body></body></html>";
    const once = injectPageHead(html, TAGS);
    const twice = injectPageHead(once, TAGS);
    expect(twice).toBe(once);
    expect((twice.match(/kumiko-page-head/g) ?? []).length).toBe(1);
  });

  test("HTML without </head> is returned unchanged", () => {
    const html = "<html><body><title>Old</title></body></html>";
    expect(injectPageHead(html, TAGS)).toBe(html);
  });
});
