import { describe, expect, test } from "bun:test";
import { securePageHeaders } from "../security-headers.ts";

describe("securePageHeaders", () => {
  test("merges caller headers alongside the security defaults", () => {
    const h = securePageHeaders({ "content-type": "text/html; charset=utf-8" });
    expect(h["content-type"]).toBe("text/html; charset=utf-8");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["content-security-policy"]).toContain("script-src 'none'");
  });

  test("a caller can NEVER override a hardened security header", () => {
    const h = securePageHeaders({
      "content-security-policy": "default-src *",
      "x-frame-options": "ALLOWALL",
    });
    expect(h["content-security-policy"]).toBe(
      "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'none'; frame-ancestors 'self'",
    );
    expect(h["x-frame-options"]).toBe("SAMEORIGIN");
  });

  test("default policy closes forms and foreign fetches", () => {
    const csp = securePageHeaders({})["content-security-policy"];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("img-src 'self' https: data:");
  });

  test("cspOverrides replace form-action and frame-ancestors in place, each once", () => {
    const h = securePageHeaders({}, { "form-action": "'self'", "frame-ancestors": "'none'" });
    const directives = (h["content-security-policy"] ?? "").split("; ");
    const startingWith = (name: string) => directives.filter((d) => d.startsWith(name));
    expect(startingWith("form-action")).toEqual(["form-action 'self'"]);
    expect(startingWith("frame-ancestors")).toEqual(["frame-ancestors 'none'"]);
    expect(h["content-security-policy"]).toContain("script-src 'none'");
  });

  test("an undefined override keeps the closed default instead of dropping the directive", () => {
    const csp = securePageHeaders({}, { "form-action": undefined })["content-security-policy"];
    expect(csp).toContain("form-action 'none'");
  });
});
