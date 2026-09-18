import { describe, expect, test } from "bun:test";
import { injectPageHead, resolveAndInjectPageHead } from "../index";

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

describe("resolveAndInjectPageHead", () => {
  const HTML = "<!doctype html><html><head><title>Shell</title></head><body>shell</body></html>";
  const input = { path: "/", host: "t", systemQuery: async () => ({}) };

  test("resolved meta is injected as head tags", async () => {
    const out = await resolveAndInjectPageHead(
      HTML,
      async () => ({ title: "Vehicle X", description: "A car", ogImage: "https://x/i.png" }),
      input,
    );
    expect(out).toContain("<title>Vehicle X</title>");
    expect(out).toContain('<meta property="og:image" content="https://x/i.png" />');
  });

  test("resolver throws → unchanged html, not a rejection", async () => {
    const out = await resolveAndInjectPageHead(
      HTML,
      async () => {
        throw new Error("boom");
      },
      input,
    );
    expect(out).toBe(HTML);
  });

  test("resolver returns null → unchanged html", async () => {
    const out = await resolveAndInjectPageHead(HTML, async () => null, input);
    expect(out).toBe(HTML);
  });

  test("resolver never resolves → unchanged html after the shared timeout", async () => {
    const out = await resolveAndInjectPageHead(HTML, () => new Promise(() => {}), input);
    expect(out).toBe(HTML);
  }, 2000);
});
