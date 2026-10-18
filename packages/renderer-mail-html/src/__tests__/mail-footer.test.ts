import { describe, expect, test } from "bun:test";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import {
  buildMailBandLinksHtml,
  buildMailFooterHtml,
  layoutLinksToPlaceholder,
} from "../mail-footer";
import { mailChromeText } from "../mail-strings";

// The German footer labels come from the locale package, as in an app that mounts it.
localeDe();

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
    expect(build({ footer: null, locale: "nl" })).toContain("Unsubscribe");
  });

  test("imprint and privacy without a label use the framework text of the mail language", () => {
    const footer = {
      imprint: { url: "https://demo.example/impressum" },
      privacy: { url: "https://demo.example/datenschutz" },
    };
    const german = build({ footer, unsubscribeUrl: "", locale: "de-AT" });
    expect(german).toContain(">Impressum</a>");
    expect(german).toContain(">Datenschutz</a>");
    const english = build({ footer, unsubscribeUrl: "", locale: "en" });
    expect(english).toContain(">Imprint</a>");
    expect(english).toContain(">Privacy policy</a>");
  });

  test("the sender line follows the mail language and falls back to English", () => {
    expect(mailChromeText("de-DE", "mail.footer.sentBy", { sender: "Acme" })).toBe(
      "Gesendet von Acme",
    );
    expect(mailChromeText("nl", "mail.footer.sentBy", { sender: "Acme" })).toBe("Sent by Acme");
  });

  test("layoutLinksToPlaceholder only matches a link to that placeholder", () => {
    expect(layoutLinksToPlaceholder('<a href="{{imprint}}">I</a>', "imprint")).toBe(true);
    expect(layoutLinksToPlaceholder('<span data-variable="imprint"></span>', "imprint")).toBe(
      false,
    );
    expect(layoutLinksToPlaceholder('<a href="{{unsubscribeUrl}}">U</a>', "imprint")).toBe(false);
  });
});

describe("mail band links", () => {
  test("shows the tenant host and the unsubscribe link, escaped", () => {
    const html = buildMailBandLinksHtml({
      siteUrl: "https://status.acme.example/?a=1&b=2",
      unsubscribeUrl: "https://demo.example/unsub?token=a&b=1",
      locale: "de",
      layoutLinksUnsubscribe: false,
    });
    expect(html).toBe(
      '<a href="https://status.acme.example/?a=1&amp;b=2" style="color:#4A515E">status.acme.example</a> · <a href="https://demo.example/unsub?token=a&amp;b=1" style="color:#4A515E">Abmelden</a>',
    );
  });

  test("drops a non-web site url and an unsubscribe link the layout already carries", () => {
    expect(
      buildMailBandLinksHtml({
        siteUrl: "javascript:alert(1)",
        unsubscribeUrl: "https://demo.example/unsub",
        locale: "en",
        layoutLinksUnsubscribe: true,
      }),
    ).toBe("");
  });
});
