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
          { kind: "feature-grid", heading: "F", items: [{ icon: "<rect/>", title: "x", desc: "d" }] },
        ],
      }),
    );
    expect(html).toContain("<strong>ok</strong>");
    expect(html).toContain("<svg"); // icon wrapped in standard svg
    expect(html).toContain("<rect/>");
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
          { kind: "pricing-grid", heading: "P", tiers: [{ name: "Free", amount: "0 €", benefits: ["b"], cta: { label: "g", href: "/s" } }] },
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
});
