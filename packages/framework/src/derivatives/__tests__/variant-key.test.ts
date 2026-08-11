import { describe, expect, test } from "bun:test";
import { specHash, variantSuffix } from "../variant-key";

describe("specHash — key stability", () => {
  test("key order doesn't matter", () => {
    expect(specHash({ fit: "cover", maxEdge: 512 })).toBe(specHash({ maxEdge: 512, fit: "cover" }));
  });

  test("an explicit undefined is neutral, same as omitting the key", () => {
    expect(specHash({ fit: "cover" })).toBe(specHash({ fit: "cover", blur: undefined }));
  });

  test("nested object keys are sorted too", () => {
    expect(specHash({ size: { width: 1, height: 2 } })).toBe(
      specHash({ size: { height: 2, width: 1 } }),
    );
  });

  test("a changed value produces a different hash — the whole point of hashing the spec", () => {
    expect(specHash({ maxEdge: 512 })).not.toBe(specHash({ maxEdge: 640 }));
  });
});

describe("variantSuffix", () => {
  test("the name is part of the suffix — same spec, different name diverges", () => {
    const spec = { maxEdge: 512 } as const;
    expect(variantSuffix("thumb", spec)).not.toBe(variantSuffix("card", spec));
  });

  test("shape is `<name>-<8 hex chars>`", () => {
    expect(variantSuffix("thumb", { maxEdge: 512 })).toMatch(/^thumb-[0-9a-f]{8}$/);
  });

  test("a path-traversal name is rejected — it would escape the tenant prefix in the derived key", () => {
    expect(() => variantSuffix("../evil", {})).toThrow(/variant name/);
  });

  test("a name containing a slash is rejected", () => {
    expect(() => variantSuffix("a/b", {})).toThrow(/variant name/);
  });

  test("an empty name is rejected", () => {
    expect(() => variantSuffix("", {})).toThrow(/variant name/);
  });

  test("a name over 32 chars is rejected", () => {
    expect(() => variantSuffix("a".repeat(40), {})).toThrow(/variant name/);
  });

  test("ordinary names pass through", () => {
    expect(() => variantSuffix("thumb", {})).not.toThrow();
    expect(() => variantSuffix("card-2x", {})).not.toThrow();
    expect(() => variantSuffix("Hero", {})).not.toThrow();
  });
});
