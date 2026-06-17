import { describe, expect, test } from "bun:test";
import { securePageHeaders } from "../security-headers";

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
      "script-src 'none'; object-src 'none'; base-uri 'none'",
    );
    expect(h["x-frame-options"]).toBe("SAMEORIGIN");
  });
});
