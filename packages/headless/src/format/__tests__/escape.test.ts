import { describe, expect, test } from "bun:test";
import { escapeHtml, escapeHtmlAttr, escapeXml } from "../escape";

describe("escapeHtml", () => {
  test('escapes & < > "', () => {
    expect(escapeHtml(`& < > "`)).toBe("&amp; &lt; &gt; &quot;");
  });

  test("does not escape '", () => {
    expect(escapeHtml("it's")).toBe("it's");
  });

  test("plain text passes through", () => {
    expect(escapeHtml("Hello, World!")).toBe("Hello, World!");
  });

  test("empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  test("multiple occurrences", () => {
    expect(escapeHtml(`<div class="foo">&bar</div>`)).toBe(
      "&lt;div class=&quot;foo&quot;&gt;&amp;bar&lt;/div&gt;",
    );
  });

  test("no double-escape", () => {
    const escaped = escapeHtml(`& < > "`);
    expect(escapeHtml(escaped)).toBe("&amp;amp; &amp;lt; &amp;gt; &amp;quot;");
  });
});

describe("escapeHtmlAttr", () => {
  test('escapes & " < > with priority on & and "', () => {
    expect(escapeHtmlAttr(`& " < >`)).toBe("&amp; &quot; &lt; &gt;");
  });

  test("does not escape '", () => {
    expect(escapeHtmlAttr("it's")).toBe("it's");
  });

  test("plain attribute value passes through", () => {
    expect(escapeHtmlAttr("https://example.com?a=1&b=2")).toBe("https://example.com?a=1&amp;b=2");
  });

  test("empty string", () => {
    expect(escapeHtmlAttr("")).toBe("");
  });

  test("no double-escape", () => {
    const escaped = escapeHtmlAttr(`& " < >`);
    expect(escapeHtmlAttr(escaped)).toBe("&amp;amp; &amp;quot; &amp;lt; &amp;gt;");
  });
});

describe("escapeXml", () => {
  test("escapes & < > \" '", () => {
    expect(escapeXml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &apos;");
  });

  test("plain text passes through", () => {
    expect(escapeXml("Hello, World!")).toBe("Hello, World!");
  });

  test("empty string", () => {
    expect(escapeXml("")).toBe("");
  });

  test("multiple occurrences", () => {
    expect(escapeXml(`<element attr="value">it's & stuff</element>`)).toBe(
      "&lt;element attr=&quot;value&quot;&gt;it&apos;s &amp; stuff&lt;/element&gt;",
    );
  });

  test("no double-escape", () => {
    const escaped = escapeXml(`& < > " '`);
    expect(escapeXml(escaped)).toBe("&amp;amp; &amp;lt; &amp;gt; &amp;quot; &amp;apos;");
  });
});
