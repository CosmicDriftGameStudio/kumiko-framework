import { describe, expect, test } from "bun:test";
import { type ApexPage, renderApexPage } from "../index";

const brand = { tokensCss: ":root{--primary:#123;--primary-fg:#fff;--bg:#fff;--fg:#000;}" };

function page(overrides: Partial<ApexPage> = {}): ApexPage {
  return {
    brand,
    head: { lang: "de", title: "T", description: "D" },
    header: { brand: { href: "/", label: "Acme" } },
    sections: [],
    footer: { brand: { label: "Acme" } },
    ...overrides,
  };
}

describe("renderApexPage", () => {
  test("theme dark sets body class, light (default) does not", () => {
    expect(renderApexPage(page({ theme: "dark" }))).toContain('<body class="apex-dark">');
    // light is default — both CSS sets ship, only the body class toggles
    expect(renderApexPage(page())).toContain("<body>");
    expect(renderApexPage(page())).not.toContain('<body class="apex-dark">');
  });

  test("escapes user-provided text in title and content", () => {
    const html = renderApexPage(
      page({
        head: { lang: "de", title: "<script>x</script>", description: "a & b" },
        sections: [{ kind: "info-grid", items: [{ title: "<b>t</b>", desc: "d" }] }],
      }),
    );
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &amp; b");
    expect(html).toContain("&lt;b&gt;t&lt;/b&gt;");
  });

  test("metaHtml and feature icon are passed through unescaped (app-authored)", () => {
    const html = renderApexPage(
      page({
        sections: [
          { kind: "hero", title: "h", tagline: "t", metaHtml: "<strong>ok</strong>" },
          {
            kind: "feature-grid",
            heading: "F",
            items: [{ icon: "<rect/>", title: "x", desc: "d" }],
          },
        ],
      }),
    );
    expect(html).toContain("<strong>ok</strong>");
    expect(html).toContain("<svg"); // icon wrapped in standard svg
    expect(html).toContain("<rect/>");
  });

  test("nav menu entry renders a dropdown; plain links stay anchors", () => {
    const html = renderApexPage(
      page({
        header: {
          brand: { href: "/", label: "Acme" },
          navLinks: [
            {
              kind: "menu",
              label: "Product",
              items: [
                { icon: "<rect/>", title: "Planner", desc: "Plan it", href: "/p" },
                { title: "<b>Reports</b>", href: "/r" },
              ],
              footer: { label: "See all", href: "/all" },
            },
            { label: "Pricing", href: "#pricing" },
          ],
        },
      }),
    );
    // Menu chrome + trigger label.
    expect(html).toContain('class="nav-menu"');
    expect(html).toContain('class="nav-menu__trigger"');
    expect(html).toContain("Product");
    // Items: title, description, wrapped icon; missing desc/icon simply omitted.
    expect(html).toContain('class="nav-menu__item" href="/p"');
    expect(html).toContain("Planner");
    expect(html).toContain("Plan it");
    expect(html).toContain("<rect/>");
    // Footer link under the divider.
    expect(html).toContain('class="nav-menu__more" href="/all"');
    expect(html).toContain("See all");
    // Item titles are escaped (app-data, not trusted HTML).
    expect(html).toContain("&lt;b&gt;Reports&lt;/b&gt;");
    expect(html).not.toContain("<b>Reports</b>");
    // The sibling plain link still renders as a normal anchor.
    expect(html).toContain('<a href="#pricing">Pricing</a>');
  });

  test("pricing: featured card gets badge + featured class, cap line precedes benefits", () => {
    const html = renderApexPage(
      page({
        sections: [
          {
            kind: "pricing-grid",
            heading: "P",
            tiers: [
              {
                name: "Pro",
                amount: "9 €",
                priceSuffix: "/Monat",
                featured: true,
                badge: "Beliebt",
                capLine: "50 X",
                benefits: ["b1"],
                cta: { label: "Go", href: "/s" },
              },
            ],
          },
        ],
      }),
    );
    expect(html).toContain("price-card--featured");
    expect(html).toContain('class="price-badge">Beliebt');
    expect(html).toContain("/Monat");
    // cap line must render before the first benefit
    expect(html.indexOf("price-cap")).toBeLessThan(html.indexOf("b1"));
    // featured tier without explicit cta variant → primary button
    expect(html).toContain('class="btn btn-primary" href="/s"');
  });

  test("cta variant link renders a plain anchor, default renders a button", () => {
    const html = renderApexPage(
      page({
        header: {
          brand: { href: "/", label: "Acme" },
          actions: [
            { label: "Login", href: "/login", variant: "link" },
            { label: "Start", href: "/signup" },
          ],
        },
      }),
    );
    expect(html).toContain('<a href="/login">Login</a>'); // link → no class
    expect(html).toContain('<a class="btn btn-primary" href="/signup">Start</a>');
  });

  test("footer --footer-cols reflects column count and survives without columns", () => {
    const twoCols = renderApexPage(
      page({
        footer: {
          brand: { label: "Acme" },
          columns: [
            { heading: "A", links: [{ href: "/a", label: "a" }] },
            { heading: "B", links: [{ href: "/b", label: "b" }] },
          ],
        },
      }),
    );
    expect(twoCols).toContain("--footer-cols:2");
    expect(renderApexPage(page())).toContain("--footer-cols:0");
  });

  test("renders every section kind without throwing or leaking undefined", () => {
    const html = renderApexPage(
      page({
        sections: [
          { kind: "hero", title: "h", tagline: "t" },
          { kind: "feature-grid", heading: "F", items: [{ title: "x", desc: "d" }] },
          {
            kind: "pricing-grid",
            heading: "P",
            tiers: [
              { name: "Free", amount: "0 €", benefits: ["b"], cta: { label: "g", href: "/s" } },
            ],
          },
          { kind: "info-grid", items: [{ title: "t", desc: "d" }] },
          { kind: "final-cta", heading: "c", cta: { label: "g", href: "/s" } },
          { kind: "html", html: "<div id='raw'></div>" },
        ],
      }),
    );
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("[object Object]");
    expect(html).toContain("id='raw'");
    expect(html).toContain("trust-item");
  });

  test("renders robots meta when set, absent when omitted", () => {
    const without = renderApexPage(page());
    expect(without).not.toContain("robots");
    const withRobots = renderApexPage(
      page({ head: { lang: "de", title: "T", description: "D", robots: "noindex, nofollow" } }),
    );
    expect(withRobots).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  test("renders og:site_name and og:locale", () => {
    const html = renderApexPage(
      page({
        head: {
          lang: "de",
          title: "T",
          description: "D",
          siteName: "Acme",
          locale: "de_DE",
        },
      }),
    );
    expect(html).toContain('<meta property="og:site_name" content="Acme" />');
    expect(html).toContain('<meta property="og:locale" content="de_DE" />');
  });

  test("renders twitter:card when ogImage is set, plus twitter:site", () => {
    const html = renderApexPage(
      page({
        head: {
          lang: "de",
          title: "T",
          description: "D",
          ogImage: "https://example.com/image.png",
          twitterSite: "@acme",
        },
      }),
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<meta name="twitter:site" content="@acme" />');
  });

  test("does not render twitter:card without ogImage", () => {
    const html = renderApexPage(
      page({
        head: { lang: "de", title: "T", description: "D", twitterSite: "@acme" },
      }),
    );
    expect(html).not.toContain("twitter:card");
    expect(html).toContain("twitter:site");
  });

  test("renders preconnect links", () => {
    const html = renderApexPage(
      page({
        head: {
          lang: "de",
          title: "T",
          description: "D",
          preconnects: ["https://fonts.example.com", "https://api.example.com"],
        },
      }),
    );
    expect(html).toContain('<link rel="preconnect" href="https://fonts.example.com" />');
    expect(html).toContain('<link rel="preconnect" href="https://api.example.com" />');
  });

  test("renders schemaJson as json-ld script tag", () => {
    const html = renderApexPage(
      page({
        head: {
          lang: "de",
          title: "T",
          description: "D",
          schemaJson: { "@context": "https://schema.org", "@type": "WebSite", name: "Acme" },
        },
      }),
    );
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('{"@context":"https://schema.org","@type":"WebSite","name":"Acme"}');
    expect(html).toContain("</script>");
  });
});
