import { describe, expect, test } from "bun:test";
import { errorKindOf } from "../error-kind.ts";

describe("errorKindOf", () => {
  test("names the error class and never the message", () => {
    const kind = errorKindOf(
      new TypeError("PUT https://s3.example.com/bucket/anna-meier.pdf failed"),
    );
    expect(kind).toBe("TypeError");
  });

  test("adds a string code of the error", () => {
    const err = Object.assign(new Error("secret text"), { code: "ECONNRESET" });
    expect(errorKindOf(err)).toBe("Error (ECONNRESET)");
  });

  test("ignores a non-string code", () => {
    expect(errorKindOf(Object.assign(new Error("x"), { code: 42 }))).toBe("Error");
  });

  test("names the type of a thrown non-error", () => {
    expect(errorKindOf("anna-meier.pdf")).toBe("string");
    expect(errorKindOf(undefined)).toBe("undefined");
  });
});
