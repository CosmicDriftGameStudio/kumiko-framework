import { describe, expect, test } from "bun:test";
import { simpleRenderer } from "../simple-renderer";

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
