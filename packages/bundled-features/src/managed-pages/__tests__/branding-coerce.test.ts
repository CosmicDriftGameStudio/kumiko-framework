import { describe, expect, test } from "bun:test";
import { type BrandingTokens, EMPTY_BRANDING } from "../../page-render";
import { coerceBranding } from "../branding";

// IO-boundary coercion: untrusted `unknown` → BrandingTokens, no `as` cast —
// every missing/non-string field collapses to "" instead of throwing.

describe("coerceBranding", () => {
  const FULL: BrandingTokens = {
    title: "Acme",
    description: "We make things",
    siteUrl: "https://acme.test",
    accentColor: "#abcdef",
    logoUrl: "https://acme.test/logo.png",
    layoutPreset: "wide",
    customCss: ":root{--brand:1}",
  };

  test("passes a fully-populated response through verbatim", () => {
    expect(coerceBranding({ ...FULL })).toEqual(FULL);
  });

  test("null / undefined / primitives collapse to EMPTY_BRANDING", () => {
    for (const bad of [null, undefined, "string", 42, true, Symbol("x")]) {
      expect(coerceBranding(bad)).toEqual(EMPTY_BRANDING);
    }
  });

  test("empty object yields the all-empty token set", () => {
    expect(coerceBranding({})).toEqual(EMPTY_BRANDING);
  });

  test("missing fields fall back to '' (partial response)", () => {
    expect(coerceBranding({ title: "Acme", logoUrl: "https://acme.test/l.png" })).toEqual({
      ...EMPTY_BRANDING,
      title: "Acme",
      logoUrl: "https://acme.test/l.png",
    });
  });

  test("non-string field values are dropped to '' — never stringified or leaked", () => {
    const hostile = {
      title: 123,
      description: null,
      siteUrl: { toString: () => "https://evil.test" },
      accentColor: ["#fff"],
      logoUrl: true,
      layoutPreset: undefined,
      customCss: { malicious: "body{}" },
    };
    expect(coerceBranding(hostile)).toEqual(EMPTY_BRANDING);
  });

  test("one hostile non-string field does not poison its valid siblings", () => {
    const result = coerceBranding({ ...FULL, logoUrl: { href: "javascript:alert(1)" } });
    expect(result.logoUrl).toBe("");
    expect(result.title).toBe("Acme");
    expect(result.siteUrl).toBe("https://acme.test");
  });

  test("unknown extra keys are ignored — only the known tokens are extracted", () => {
    const result = coerceBranding({ ...FULL, evil: "<script>", extra: 1 });
    expect(result).toEqual(FULL);
    expect(Object.keys(result).sort()).toEqual(Object.keys(EMPTY_BRANDING).sort());
  });

  test("inherited (non-own) properties are not picked up", () => {
    const withInheritedTitle = Object.create({ title: "from-prototype" });
    expect(coerceBranding(withInheritedTitle)).toEqual(EMPTY_BRANDING);
  });

  test("array input is treated as a fieldless object → all-empty tokens", () => {
    expect(coerceBranding(["title", "x"])).toEqual(EMPTY_BRANDING);
  });
});
