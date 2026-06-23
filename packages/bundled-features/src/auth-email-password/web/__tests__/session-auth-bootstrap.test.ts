import { describe, expect, test } from "bun:test";
import { emailPasswordClient } from "../client-plugin";
import { hasLikelyAuthSession } from "../session";

describe("hasLikelyAuthSession", () => {
  test("no kumiko_csrf cookie → false", () => {
    expect(hasLikelyAuthSession("theme=dark")).toBe(false);
  });

  test("kumiko_csrf present → true", () => {
    expect(hasLikelyAuthSession("kumiko_csrf=abc-123")).toBe(true);
  });
});

describe("emailPasswordClient", () => {
  test("registers SessionAuthGate as gate, not SessionProvider as provider", () => {
    const feature = emailPasswordClient();
    expect(feature.providers).toEqual([]);
    expect(feature.gates).toHaveLength(1);
    expect(feature.gates[0]?.name).toBe("SessionAuthGate");
  });
});
