import { describe, expect, test } from "bun:test";
import { createSimpleRenderer, type MailBranding } from "../simple-renderer.js";

const VARIABLES = { header: "Hi", sections: [{ text: "Body" }] };

async function render(branding: MailBranding, locale?: string): Promise<string> {
  return createSimpleRenderer(branding).render({
    template: "t",
    variables: VARIABLES,
    ...(locale !== undefined && { locale }),
  });
}

const LOCALIZED: MailBranding = {
  footerText: { de: "Impressum DE", en: "Imprint EN", fr: "Mentions FR" },
  footerLinks: [
    {
      label: { de: "Datenschutz", en: "Privacy" },
      url: { de: "https://example.com/de/datenschutz", en: "https://example.com/en/privacy" },
    },
  ],
};

describe("localized footer", () => {
  test("exact locale wins", async () => {
    const html = await render(LOCALIZED, "de");
    expect(html).toContain("Impressum DE");
    expect(html).toContain('href="https://example.com/de/datenschutz"');
    expect(html).toContain(">Datenschutz</a>");
  });

  test("language part is used when the region has no entry (de-AT -> de)", async () => {
    const html = await render(LOCALIZED, "de-AT");
    expect(html).toContain("Impressum DE");
  });

  test("an exact regional entry beats the language part", async () => {
    const html = await render({ footerText: { de: "DE", "de-AT": "AT" } }, "de-AT");
    expect(html).toContain("AT");
    expect(html).not.toContain(">DE<");
    expect(html).not.toContain("DE</p>");
  });

  test("defaultLocale is used for an unknown locale", async () => {
    const html = await render({ ...LOCALIZED, defaultLocale: "fr" }, "es");
    expect(html).toContain("Mentions FR");
  });

  test("defaultLocale is used without a locale", async () => {
    const html = await render({ ...LOCALIZED, defaultLocale: "en" });
    expect(html).toContain("Imprint EN");
    expect(html).toContain('href="https://example.com/en/privacy"');
  });

  test("first entry is the last fallback", async () => {
    const html = await render(LOCALIZED, "es");
    expect(html).toContain("Impressum DE");
  });

  test("prototype keys as locale fall through to the first entry", async () => {
    for (const locale of ["constructor", "__proto__", "toString"]) {
      const html = await render(LOCALIZED, locale);
      expect(html).toContain("Impressum DE");
      expect(html).toContain("https://example.com/de/datenschutz");
    }
  });

  test("a non-http(s) URL in a localized map fails at creation", () => {
    expect(() =>
      createSimpleRenderer({
        footerLinks: [
          { label: "x", url: { de: "https://ok.example/", en: "javascript:alert(1)" } },
        ],
      }),
    ).toThrow(/http\(s\)/);
  });

  test("string fields render identically with or without a locale", async () => {
    const branding: MailBranding = {
      productName: "Acme",
      footerText: "Acme GmbH",
      footerLinks: [{ label: "Imprint", url: "https://example.com/imprint" }],
    };
    const without = await render(branding);
    expect(await render(branding, "de")).toBe(without);
    expect(without).toBe(
      '<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:sans-serif"><div style="max-width:600px;margin:0 auto;padding:24px"><div style="margin:0 0 24px;padding:0 0 16px;border-bottom:3px solid #2563eb"><span style="font-size:18px;font-weight:700;color:#2563eb">Acme</span></div><h1 style="margin:0 0 24px;color:#111;font-size:20px;font-weight:600">Hi</h1><p style="margin:0 0 16px;color:#333;font-size:14px;line-height:1.5">Body</p><p style="margin:16px 0 0;color:#999;font-size:12px">Acme GmbH<br /><a href="https://example.com/imprint" style="color:#999">Imprint</a></p></div></body></html>',
    );
  });
});

describe("logoPath", () => {
  const base = { baseUrl: "https://app.example.com" };

  test("is resolved against baseUrl and rendered like logoUrl", async () => {
    const html = await render({ ...base, productName: "Acme", logoPath: "/assets/logo.png" });
    expect(html).toContain('<img src="https://app.example.com/assets/logo.png" alt="Acme"');
  });

  test.each([
    ["protocol-relative", { logoPath: "//evil.com/x.png" }],
    ["javascript scheme", { logoPath: "javascript:alert(1)" }],
    ["backslash host", { logoPath: "\\\\evil.com" }],
    ["backslash after slash", { logoPath: "/\\evil.com" }],
    ["relative path", { logoPath: "logo.png" }],
    ["missing baseUrl", { logoPath: "/logo.png", baseUrl: undefined }],
    ["non-http baseUrl", { logoPath: "/logo.png", baseUrl: "ftp://app.example.com" }],
    ["relative baseUrl", { logoPath: "/logo.png", baseUrl: "app.example.com" }],
    ["together with logoUrl", { logoPath: "/logo.png", logoUrl: "https://cdn.example/l.png" }],
  ])("rejects %s at creation", (_name, override) => {
    expect(() => createSimpleRenderer({ ...base, ...override })).toThrow(/createSimpleRenderer/);
  });
});
