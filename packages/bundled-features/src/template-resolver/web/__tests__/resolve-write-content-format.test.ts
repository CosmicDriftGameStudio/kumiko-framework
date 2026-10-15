import { describe, expect, test } from "bun:test";

// client-plugin.tsx pulls in React modules; the pure function itself needs no DOM.
const { resolveWriteContentFormat } = await import("../client-plugin.js");

describe("resolveWriteContentFormat", () => {
  test.each([
    ["plain", "plain"],
    ["rich", "html"],
    ["document", "html"],
    ["markdown", "markdown"],
  ] as const)("collection format %s writes %s", (collection, written) => {
    expect(resolveWriteContentFormat(collection, "mjml")).toBe(written);
  });

  test("no collection format keeps the loaded value", () => {
    expect(resolveWriteContentFormat(undefined, "mjml")).toBe("mjml");
  });

  test("no collection format and nothing loaded stays undefined", () => {
    expect(resolveWriteContentFormat(undefined, undefined)).toBeUndefined();
  });
});
