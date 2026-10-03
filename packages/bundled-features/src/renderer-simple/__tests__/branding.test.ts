import { describe, expect, test } from "bun:test";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { renderResetPasswordEmail } from "../../auth-email-password/email-templates.js";
import { createSimpleRenderer, type MailBranding, simpleRenderer } from "../simple-renderer.js";

registerMailTranslations("de", localeDeBundle);

const BRANDING: MailBranding = {
  productName: "PublicStatus",
  primaryColor: "#0a7d5c",
  logoUrl: "https://cdn.example/logo.png",
  footerText: "PublicStatus GmbH",
  footerLinks: [{ label: "Imprint", url: "https://example.com/imprint" }],
};

async function renderResetMail(
  renderer: typeof simpleRenderer,
  locale: string,
): Promise<{ html: string; subject: string }> {
  const content = renderResetPasswordEmail({
    url: "https://app.example/reset?token=abc",
    expiresAt: "2026-05-04T13:45:00.000Z",
    locale,
    appName: "PublicStatus",
  });
  const html = await renderer.render({ template: "auth.reset", variables: { ...content } });
  return { html, subject: content.subject };
}

describe("simple renderer branding", () => {
  test.each(["en", "de"])(
    "branded auth mail (%s) carries logo, color and footer",
    async (locale) => {
      const { html } = await renderResetMail(createSimpleRenderer(BRANDING), locale);

      expect(html).toContain('<img src="https://cdn.example/logo.png" alt="PublicStatus"');
      expect(html).toContain("background:#0a7d5c");
      expect(html).toContain("border-bottom:3px solid #0a7d5c");
      expect(html).toContain("PublicStatus GmbH");
      expect(html).toContain('<a href="https://example.com/imprint"');
      expect(html).toContain("Reset");
    },
  );

  test("without branding the output is unchanged", async () => {
    const plain = await renderResetMail(simpleRenderer, "en");
    const unbranded = await renderResetMail(createSimpleRenderer(), "en");

    expect(unbranded.html).toBe(plain.html);
    expect(plain.html).toContain("background:#2563eb");
    expect(plain.html).not.toContain("<img");
  });

  test("branding values are HTML-escaped", async () => {
    const renderer = createSimpleRenderer({
      productName: '<script>alert("x")</script>',
      logoUrl: 'https://cdn.example/l.png?a="onerror="alert(1)',
      footerText: "<b>bold</b>",
      footerLinks: [{ label: "<i>x</i>", url: 'https://e.example/?q="><script>' }],
    });
    const { html } = await renderResetMail(renderer, "en");

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>bold");
    expect(html).not.toContain("<i>x");
    expect(html).not.toContain('"onerror="');
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  test("non-http(s) logo and link URLs and malformed colors are dropped", async () => {
    const renderer = createSimpleRenderer({
      productName: "Acme",
      primaryColor: 'red;background:url("x")',
      logoUrl: "javascript:alert(1)",
      footerLinks: [
        { label: "bad", url: "javascript:alert(1)" },
        { label: "data", url: "data:text/html,x" },
        { label: "ok", url: "http://ok.example/" },
      ],
    });
    const { html } = await renderResetMail(renderer, "en");

    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
    expect(html).toContain("Acme");
    expect(html).toContain("background:#2563eb");
    expect(html).toContain('href="http://ok.example/"');
  });
});
