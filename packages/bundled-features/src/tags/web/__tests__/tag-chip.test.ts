import { describe, expect, test } from "bun:test";
import { contrastText } from "../tag-chip";

// contrastText is the only non-trivial logic in TagChip: the YIQ pick must put
// white on dark labels and black on light ones, and reject non-hex input so the
// chip falls back to neutral instead of rendering an invalid CSS color.
describe("contrastText", () => {
  test("white text on dark colors", () => {
    expect(contrastText("#000000")).toBe("#ffffff");
    expect(contrastText("#1e3a8a")).toBe("#ffffff"); // dark blue
  });

  test("black text on light colors", () => {
    expect(contrastText("#ffffff")).toBe("#000000");
    expect(contrastText("#fde68a")).toBe("#000000"); // light yellow
  });

  test("supports 3-digit shorthand hex", () => {
    expect(contrastText("#fff")).toBe("#000000");
    expect(contrastText("#000")).toBe("#ffffff");
  });

  test("trims surrounding whitespace", () => {
    expect(contrastText("  #ffffff  ")).toBe("#000000");
  });

  test("returns null for non-hex / malformed input", () => {
    expect(contrastText("")).toBeNull();
    expect(contrastText("rebeccapurple")).toBeNull();
    expect(contrastText("#12")).toBeNull();
    expect(contrastText("#1234")).toBeNull();
    expect(contrastText("22cc88")).toBeNull(); // missing #
  });
});
