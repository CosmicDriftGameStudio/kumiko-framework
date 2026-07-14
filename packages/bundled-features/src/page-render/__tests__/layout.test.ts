import { describe, expect, test } from "bun:test";
import { wrapInLayout } from "../layout";

describe("wrapInLayout :: seo (opt-in OG/JSON-LD extension)", () => {
  test("without `seo` — unchanged minimal title+description head (no regression)", () => {
    const html = wrapInLayout({
      title: "About",
      bodyHtml: "<p>x</p>",
      lang: "en",
      description: "About us",
    });
    expect(html).toContain("<title>About</title>");
    expect(html).toContain('<meta name="description" content="About us">');
    expect(html).not.toContain("og:title");
    expect(html).not.toContain("application/ld+json");
  });

  test("with `seo` — emits OG/canonical/JSON-LD via the shared apex head renderer", () => {
    const html = wrapInLayout({
      title: "About",
      bodyHtml: "<p>x</p>",
      lang: "en",
      description: "About us",
      seo: {
        canonicalUrl: "https://acme.test/about",
        ogImage: "https://acme.test/og.png",
        siteName: "Acme",
        schemaJson: { "@context": "https://schema.org", "@type": "WebPage", name: "About" },
      },
    });
    expect(html).toContain("<title>About</title>");
    expect(html).toContain('<meta property="og:title" content="About" />');
    expect(html).toContain('<meta property="og:description" content="About us" />');
    expect(html).toContain('<link rel="canonical" href="https://acme.test/about" />');
    expect(html).toContain('<meta property="og:image" content="https://acme.test/og.png" />');
    expect(html).toContain('<meta property="og:site_name" content="Acme" />');
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"WebPage"');
    // no-`seo` minimal-description meta must NOT also appear (headTags replaces it)
    expect(html).not.toContain('<meta name="description" content="About us">');
  });

  test("with `seo` — escapes title/description same as the non-seo path", () => {
    const html = wrapInLayout({
      title: "<script>alert(1)</script>",
      bodyHtml: "x",
      lang: "en",
      seo: {},
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
