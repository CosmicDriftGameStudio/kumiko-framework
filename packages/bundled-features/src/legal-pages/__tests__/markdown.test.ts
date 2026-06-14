import { describe, expect, test } from "bun:test";
import { renderMarkdownToHtml } from "../markdown";

describe("renderMarkdownToHtml — XSS-Härtung", () => {
  test("block-level <script> wird als Text escaped, nicht durchgereicht", () => {
    const html = renderMarkdownToHtml("# Titel\n\n<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("inline raw HTML (<img onerror>) wird escaped", () => {
    const html = renderMarkdownToHtml('Text <img src=x onerror="alert(1)"> mehr');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  test("javascript:-Link-href wird neutralisiert", () => {
    const html = renderMarkdownToHtml("[klick](javascript:alert(1))");
    expect(html.toLowerCase()).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });

  test("data:-Image-src wird neutralisiert", () => {
    const html = renderMarkdownToHtml("![x](data:text/html;base64,PHNjcmlwdD4=)");
    expect(html.toLowerCase()).not.toContain("data:");
  });

  test("https/mailto/relative Hrefs bleiben erhalten", () => {
    expect(renderMarkdownToHtml("[a](https://example.com)")).toContain(
      'href="https://example.com"',
    );
    expect(renderMarkdownToHtml("[b](mailto:x@y.de)")).toContain('href="mailto:x@y.de"');
    expect(renderMarkdownToHtml("[c](/impressum)")).toContain('href="/impressum"');
  });

  test("normale Markdown-Struktur bleibt intakt", () => {
    const html = renderMarkdownToHtml("# H1\n\n**fett** und `code`\n\n- a\n- b");
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>fett</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>a</li>");
  });
});
