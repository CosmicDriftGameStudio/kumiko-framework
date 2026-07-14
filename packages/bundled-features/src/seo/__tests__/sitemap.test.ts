import { describe, expect, test } from "bun:test";
import { buildSitemapXml } from "../sitemap";

describe("buildSitemapXml", () => {
  test("emits urlset with loc/lastmod/changefreq", () => {
    const xml = buildSitemapXml([
      { loc: "https://example.com/", lastmod: "2026-01-01", changefreq: "weekly" },
    ]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<loc>https://example.com/</loc>");
    expect(xml).toContain("<lastmod>2026-01-01</lastmod>");
    expect(xml).toContain("<changefreq>weekly</changefreq>");
  });

  test("emits hreflang alternates", () => {
    const xml = buildSitemapXml([
      {
        loc: "https://example.com/",
        alternates: [{ hreflang: "de", href: "https://example.com/de" }],
      },
    ]);
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="de" href="https://example.com/de" />',
    );
  });

  test("escapes XML-unsafe characters in loc", () => {
    const xml = buildSitemapXml([{ loc: "https://example.com/?a=1&b=2" }]);
    expect(xml).toContain("https://example.com/?a=1&amp;b=2");
    expect(xml).not.toContain("&b=2<");
  });

  test("empty entries → valid empty urlset", () => {
    const xml = buildSitemapXml([]);
    expect(xml).toContain("<urlset");
    expect(xml).not.toContain("<url>");
  });
});
