import { describe, expect, test } from "bun:test";
import { buildMailFooterHtml, layoutLinksToPlaceholder } from "../mail-footer";

const FOOTER = {
  text: "Sent via <b>Demo</b>",
  imprint: { label: "Impressum", url: "https://demo.example/impressum" },
  privacy: { label: "Datenschutz", url: "https://demo.example/datenschutz" },
};

function build(overrides: Partial<Parameters<typeof buildMailFooterHtml>[0]> = {}): string {
  return buildMailFooterHtml({
    footer: FOOTER,
    unsubscribeUrl: "https://demo.example/unsub?token=a&b=1",
    locale: "de-DE",
    layoutLinksImprint: false,
    layoutLinksUnsubscribe: false,
    ...overrides,
  });
}

describe("mail footer", () => {
  test("text is escaped and links follow in a fixed order with a localized unsubscribe label", () => {
    const html = build();
    expect(html).toContain("Sent via &lt;b&gt;Demo&lt;/b&gt;");
    expect(html.indexOf("Impressum")).toBeLessThan(html.indexOf("Datenschutz"));
    expect(html.indexOf("Datenschutz")).toBeLessThan(html.indexOf("Abmelden"));
    expect(html).toContain('href="https://demo.example/unsub?token=a&amp;b=1"');
  });

  test("links the layout already carries are not doubled", () => {
    const html = build({ layoutLinksImprint: true, layoutLinksUnsubscribe: true });
    expect(html).not.toContain("Impressum");
    expect(html).not.toContain("Abmelden");
    expect(html).toContain("Datenschutz");
  });

  test("unsafe urls and empty labels are dropped, nothing at all yields an empty footer", () => {
    expect(
      build({
        footer: { privacy: { label: "x", url: "javascript:alert(1)" } },
        unsubscribeUrl: "",
      }),
    ).toBe("");
    expect(build({ footer: { imprint: { label: " ", url: "https://a.example" } } })).not.toContain(
      "a.example",
    );
    expect(build({ footer: null, unsubscribeUrl: "" })).toBe("");
  });

  test("an unknown language falls back to the English unsubscribe label", () => {
    expect(build({ footer: null, locale: "fr" })).toContain("Unsubscribe");
  });

  test("layoutLinksToPlaceholder only matches a link to that placeholder", () => {
    expect(layoutLinksToPlaceholder('<a href="{{imprint}}">I</a>', "imprint")).toBe(true);
    expect(layoutLinksToPlaceholder('<span data-variable="imprint"></span>', "imprint")).toBe(
      false,
    );
    expect(layoutLinksToPlaceholder('<a href="{{unsubscribeUrl}}">U</a>', "imprint")).toBe(false);
  });
});
