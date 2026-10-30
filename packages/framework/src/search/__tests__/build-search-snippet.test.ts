import { describe, expect, test } from "bun:test";
import { buildSearchSnippet } from "../build-search-snippet.ts";

describe("buildSearchSnippet", () => {
  test("returns null without a match or with an empty term", () => {
    expect(buildSearchSnippet("Hello world", "xyz")).toBeNull();
    expect(buildSearchSnippet("Hello world", "  ")).toBeNull();
  });

  test("matches case-insensitively and keeps the original spelling in hit", () => {
    expect(buildSearchSnippet("Hello World", "world")).toEqual({
      before: "Hello ",
      hit: "World",
      after: "",
    });
  });

  test("handles umlauts", () => {
    expect(buildSearchSnippet("Die Übergabe der Schlüssel", "übergabe")).toEqual({
      before: "Die ",
      hit: "Übergabe",
      after: " der Schlüssel",
    });
  });

  test("adds an ellipsis only on the side that was shortened, at word boundaries", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const text = `${words} NEEDLE ${words}`;
    const snippet = buildSearchSnippet(text, "needle", { radius: 30 });
    expect(snippet?.hit).toBe("NEEDLE");
    expect(snippet?.before.startsWith("…word")).toBe(true);
    expect(snippet?.after.endsWith("…")).toBe(true);
    expect(/word\d+…$/.test(snippet?.after ?? "")).toBe(true);
  });

  test("a match at the start or end has no ellipsis on that side", () => {
    const start = buildSearchSnippet("needle at the start", "needle");
    expect(start?.before).toBe("");
    expect(start?.after).toBe(" at the start");
    const end = buildSearchSnippet("the end is a needle", "needle");
    expect(end?.before).toBe("the end is a ");
    expect(end?.after).toBe("");
  });
});
