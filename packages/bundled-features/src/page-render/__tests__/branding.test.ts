import { describe, expect, test } from "bun:test";
import {
  type BrandingTokens,
  brandingHeaderHtml,
  brandingStyleBlock,
  EMPTY_BRANDING,
} from "../branding";

const tokens = (over: Partial<BrandingTokens>): BrandingTokens => ({ ...EMPTY_BRANDING, ...over });

// The branding tokens are RAW tenant input (title/description only length-capped
// at write). These emitters are the safe boundary a custom wrapLayout must use —
// prove they escape/re-validate, since interpolating branding.title directly
// would be stored XSS on the anonymous public page.
describe("brandingHeaderHtml — escapes untrusted tokens", () => {
  test("a <script> in the title is HTML-escaped, not emitted live", () => {
    const html = brandingHeaderHtml(tokens({ title: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("tag/quote syntax in the title can't break out of the logo alt", () => {
    const html = brandingHeaderHtml(
      tokens({ logoUrl: "https://cdn.test/l.png", title: '"><img src=x onerror=alert(1)>' }),
    );
    // the title's angle brackets are escaped → the injected tag is inert text
    // in the alt, never a live element.
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain('<img class="brand-logo"'); // the real logo survives
  });

  test("a non-https logo URL is dropped (no <img>)", () => {
    expect(brandingHeaderHtml(tokens({ logoUrl: "javascript:alert(1)" }))).toBe("");
    expect(brandingHeaderHtml(tokens({ logoUrl: "http://cdn.test/l.png" }))).toBe("");
  });

  test("a non-https siteUrl never becomes a home link", () => {
    const html = brandingHeaderHtml(tokens({ title: "Acme", siteUrl: "javascript:alert(1)" }));
    expect(html).toContain("Acme");
    expect(html).not.toContain("<a href");
    expect(html).not.toContain("javascript:");
  });
});

describe("brandingStyleBlock — re-validates theme tokens", () => {
  test("an invalid accent color is dropped (no --accent injected)", () => {
    const css = brandingStyleBlock(tokens({ accentColor: "red;}</style><script>" }));
    expect(css).not.toContain("--accent:red");
    expect(css).not.toContain("</style><script>");
    expect(css).not.toContain("--accent:");
  });

  test("a valid hex accent color is injected", () => {
    expect(brandingStyleBlock(tokens({ accentColor: "#ff0066" }))).toContain("--accent:#ff0066");
  });
});
