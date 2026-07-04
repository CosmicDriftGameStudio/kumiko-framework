import { describe, expect, test } from "bun:test";
import { html, RawHtml, raw } from "../html-template";

const XSS = `<script>alert("1")</script>`;

describe("html tagged template", () => {
  test("escapes string interpolations", () => {
    expect(html`<p>${XSS}</p>`.toString()).toBe(
      "<p>&lt;script&gt;alert(&quot;1&quot;)&lt;/script&gt;</p>",
    );
  });

  test("escapes attribute breakouts (double quotes)", () => {
    const href = `"><img src=x onerror=alert(1)>`;
    const out = html`<a href="${href}">x</a>`.toString();
    expect(out).not.toContain('"><img');
    expect(out).toContain("&quot;&gt;&lt;img");
  });

  test("raw() passes prerendered markup through unchanged", () => {
    expect(html`<div>${raw("<b>ok</b>")}</div>`.toString()).toBe("<div><b>ok</b></div>");
  });

  test("nested html`...` fragments are not double-escaped", () => {
    const item = html`<li>${"a & b"}</li>`;
    expect(html`<ul>${item}</ul>`.toString()).toBe("<ul><li>a &amp; b</li></ul>");
  });

  test("arrays are joined with each element escaped", () => {
    const items = ["<x>", "y"].map((v) => html`<li>${v}</li>`);
    expect(html`<ul>${items}</ul>`.toString()).toBe("<ul><li>&lt;x&gt;</li><li>y</li></ul>");
  });

  test("null and undefined render as empty string", () => {
    expect(html`<p>${null}${undefined}</p>`.toString()).toBe("<p></p>");
  });

  test("numbers and booleans render via String()", () => {
    expect(html`<td>${42}${false}</td>`.toString()).toBe("<td>42false</td>");
  });

  test("toString() makes fragments usable in plain string contexts", () => {
    const fragment = html`<p>${"<i>"}</p>`;
    expect(`${fragment}`).toBe("<p>&lt;i&gt;</p>");
    expect(fragment).toBeInstanceOf(RawHtml);
  });
});
