import { describe, expect, test } from "bun:test";
import { renderSafeMarkdown } from "../markdown.ts";

describe("renderSafeMarkdown — XSS protection", () => {
  test("block-level <script> is escaped as text, not passed through", () => {
    const html = renderSafeMarkdown("# Titel\n\n<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("inline raw HTML (<img onerror>) is escaped", () => {
    const html = renderSafeMarkdown('Text <img src=x onerror="alert(1)"> mehr');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  test("javascript:-link href is neutralized", () => {
    const html = renderSafeMarkdown("[klick](javascript:alert(1))");
    expect(html.toLowerCase()).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });

  // CommonMark allows a tab inside a
  // <...>-bracketed link destination; `.trim()` only strips leading/
  // trailing whitespace, so "java\tscript:" survived isSafeHref's scheme
  // regex (the tab breaks the character class before ":", the check falls
  // through to `return true`) and the browser normalizes it back to
  // "javascript:" on click. Mirrors xss-safety.test.tsx's UNSAFE_HREFS.
  test("java\\tscript:-link href (tab-obfuscated scheme via <...> destination) is neutralized", () => {
    const html = renderSafeMarkdown("[klick](<java\tscript:alert(1)>)");
    expect(html.toLowerCase()).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });

  // HTML character references decode client-side
  // (the browser parses them before the URL parser ever sees the value),
  // so "javascript&colon;", "java&Tab;script:" and "java&#9;script:" all
  // normalize to an executable javascript: URL on click even though none
  // contains a literal ":" for isSafeHref's pre-decode scheme check.
  test("HTML-entity-obfuscated javascript: hrefs are neutralized", () => {
    for (const href of [
      "javascript&colon;alert(1)",
      "java&Tab;script:alert(1)",
      "java&#9;script:alert(1)",
    ]) {
      const html = renderSafeMarkdown(`[klick](<${href}>)`);
      expect(html.toLowerCase()).not.toContain("javascript:");
      expect(html).toContain('href="#"');
    }
  });

  test("data:-image src is neutralized", () => {
    const html = renderSafeMarkdown("![x](data:text/html;base64,PHNjcmlwdD4=)");
    expect(html.toLowerCase()).not.toContain("data:");
  });

  test("https/mailto/relative Hrefs bleiben erhalten", () => {
    expect(renderSafeMarkdown("[a](https://example.com)")).toContain('href="https://example.com"');
    expect(renderSafeMarkdown("[b](mailto:x@y.de)")).toContain('href="mailto:x@y.de"');
    expect(renderSafeMarkdown("[c](/impressum)")).toContain('href="/impressum"');
  });

  test("normal Markdown structure remains intact", () => {
    const html = renderSafeMarkdown("# H1\n\n**fett** und `code`\n\n- a\n- b");
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>fett</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>a</li>");
  });
});
