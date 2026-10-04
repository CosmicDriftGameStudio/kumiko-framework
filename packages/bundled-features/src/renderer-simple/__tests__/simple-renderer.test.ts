import { describe, expect, test } from "bun:test";
import { createSimpleRenderer, simpleRenderer } from "../simple-renderer.js";

describe("simple renderer", () => {
  test("renders header", async () => {
    const html = await simpleRenderer.render({
      template: "test",
      variables: { header: "Willkommen" },
    });
    expect(html).toContain("<h1");
    expect(html).toContain("Willkommen");
    expect(html).toContain("<!DOCTYPE html>");
  });

  test("renders text section", async () => {
    const html = await simpleRenderer.render({
      template: "test",
      variables: {
        sections: [{ text: "Dies ist ein Absatz." }],
      },
    });
    expect(html).toContain("<p");
    expect(html).toContain("Dies ist ein Absatz.");
  });

  test("renders heading section as escaped h2", async () => {
    const html = await simpleRenderer.render({
      template: "test",
      variables: { sections: [{ heading: "Terms <b>& more</b>" }] },
    });
    expect(html).toContain("<h2");
    expect(html).toContain("Terms &lt;b&gt;&amp; more&lt;/b&gt;");
  });

  test("renders markdown section as HTML", async () => {
    const html = await simpleRenderer.render({
      template: "test",
      variables: { sections: [{ markdown: "# Title\n\nSome **bold** text\n\n- one\n- two" }] },
    });
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<li>one</li>");
  });

  test("markdown section escapes raw HTML and neutralizes javascript: links", async () => {
    const html = await simpleRenderer.render({
      template: "test",
      variables: {
        sections: [
          {
            markdown:
              "<script>alert(1)</script>\n\n[click](javascript:alert(1))\n\n<img src=x onerror=alert(1)>",
          },
        ],
      },
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });

  test("renders button section with link", async () => {
    const html = await simpleRenderer.render({
      template: "test",
      variables: {
        sections: [{ button: { label: "Klick mich", url: "https://example.com/action" } }],
      },
    });
    expect(html).toContain('href="https://example.com/action"');
    expect(html).toContain("Klick mich");
    expect(html).toContain("<a ");
  });

  test("renders footer", async () => {
    const html = await simpleRenderer.render({
      template: "test",
      variables: { footer: "Kumiko Framework" },
    });
    expect(html).toContain("Kumiko Framework");
    expect(html).toContain("border-top");
  });

  test("renders full email with all parts", async () => {
    const html = await simpleRenderer.render({
      template: "order-assigned",
      variables: {
        header: "Neuer Auftrag",
        sections: [
          { text: "Auftrag #42 wurde dir zugewiesen." },
          { button: { label: "Auftrag oeffnen", url: "/orders/42" } },
        ],
        footer: "Automatische Benachrichtigung",
      },
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Neuer Auftrag");
    expect(html).toContain("Auftrag #42 wurde dir zugewiesen.");
    expect(html).toContain('href="/orders/42"');
    expect(html).toContain("Auftrag oeffnen");
    expect(html).toContain("Automatische Benachrichtigung");
    expect(html).toContain("</html>");
  });

  test("escapes HTML in all fields", async () => {
    const html = await simpleRenderer.render({
      template: "test",
      variables: {
        header: '<script>alert("xss")</script>',
        sections: [
          { text: "Text with <b>tags</b>" },
          { button: { label: "Click <here>", url: 'https://evil.com/"><script>' } },
        ],
        footer: "Footer & more",
      },
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("Footer &amp; more");
  });

  test("renders empty template without errors", async () => {
    const html = await simpleRenderer.render({
      template: "empty",
      variables: {},
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });
});

describe("simple renderer text part", () => {
  test("renders the same content as plain text, unescaped, buttons as label and url", async () => {
    const text = await simpleRenderer.renderText?.({
      template: "full",
      variables: {
        header: "Rechnung & Mahnung",
        sections: [
          { heading: "Offener Betrag" },
          { text: "Bitte zahle <bis> Freitag." },
          { markdown: "**Wichtig:** siehe [AGB](https://x.test/agb)" },
          { button: { label: "Jetzt zahlen", url: "https://x.test/pay?a=1&b=2" } },
        ],
        footer: "Acme GmbH",
      },
    });
    expect(text).toBe(
      [
        "Rechnung & Mahnung",
        "Offener Betrag",
        "Bitte zahle <bis> Freitag.",
        "**Wichtig:** siehe [AGB](https://x.test/agb)",
        "Jetzt zahlen: https://x.test/pay?a=1&b=2",
        "Acme GmbH",
      ].join("\n\n"),
    );
  });

  test("title + body fallback becomes header and one paragraph", async () => {
    const text = await simpleRenderer.renderText?.({
      template: "plain",
      variables: { title: "Hallo", body: "Dein Code ist 1234." },
    });
    expect(text).toBe("Hallo\n\nDein Code ist 1234.");
  });

  test("branding footer text and links follow the locale", async () => {
    const renderer = createSimpleRenderer({
      footerText: { de: "Acme GmbH, Berlin", en: "Acme Ltd, Berlin" },
      footerLinks: [
        { label: { de: "Impressum", en: "Imprint" }, url: "https://acme.test/impressum" },
        { label: "Broken", url: "javascript:alert(1)" },
      ],
    });
    const text = await renderer.renderText?.({
      template: "x",
      variables: { header: "Hi" },
      locale: "de",
    });
    expect(text).toBe("Hi\n\nAcme GmbH, Berlin\nImpressum: https://acme.test/impressum");
  });

  test("an empty template renders an empty text part", async () => {
    expect(await simpleRenderer.renderText?.({ template: "empty", variables: {} })).toBe("");
  });
});
