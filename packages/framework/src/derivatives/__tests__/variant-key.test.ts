import { describe, expect, test } from "bun:test";
import { deriveKey } from "../../files/file-handle";
import { derivativeListPrefix, isDerivativeKeyOf, specHash, variantSuffix } from "../variant-key";

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

  test("different blurRegions produce different hashes — corrected regions need a fresh URL", () => {
    expect(specHash({ blurRegions: [{ x: 0, y: 0, width: 0.5, height: 0.5 }] })).not.toBe(
      specHash({ blurRegions: [{ x: 0.5, y: 0.5, width: 0.5, height: 0.5 }] }),
    );
  });
});

describe("variantSuffix", () => {
  test("the name is part of the suffix — same spec, different name diverges", () => {
    const spec = { maxEdge: 512 } as const;
    expect(variantSuffix("thumb", spec)).not.toBe(variantSuffix("card", spec));
  });

  test("shape is `<name>-<16 hex chars>`", () => {
    expect(variantSuffix("thumb", { maxEdge: 512 })).toMatch(/^thumb-[0-9a-f]{16}$/);
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

// These pin the grammar `isDerivativeKeyOf`/`derivativeListPrefix` use to
// recognize forget/tenant-destroy erasure targets — real deriveKey() output,
// not a hand-rolled key shape, so a drift in deriveKey's own splitting logic
// would show up here too.
describe("derivativeListPrefix + isDerivativeKeyOf — real deriveKey() output", () => {
  const original = "tenant/photo.jpg";
  const suffix = variantSuffix("thumb", { maxEdge: 512 });
  const derived = deriveKey(original, suffix);

  test("deriveKey's own output matches isDerivativeKeyOf for its original", () => {
    expect(isDerivativeKeyOf(original, derived)).toBe(true);
  });

  test("derivativeListPrefix is a prefix of every derivative deriveKey() produces", () => {
    expect(derived.startsWith(derivativeListPrefix(original))).toBe(true);
  });

  test("the original key is not its own derivative", () => {
    expect(isDerivativeKeyOf(original, original)).toBe(false);
  });

  test("a same-directory sibling original with a DIFFERENT extension is not a derivative", () => {
    // Same base ("tenant/photo"), so it shares derivativeListPrefix — the
    // extension anchor is what must reject it, or a forget/tenant-destroy
    // prefix-delete would sweep up a different file (possibly another
    // user's) alongside the intended derivatives.
    expect(isDerivativeKeyOf(original, "tenant/photo.png")).toBe(false);
    expect(isDerivativeKeyOf(original, "tenant/photo.other-1234567890abcdef.png")).toBe(false);
  });

  test("an unrelated key under the same directory is not a derivative", () => {
    expect(isDerivativeKeyOf(original, "tenant/other-file.jpg")).toBe(false);
  });

  test("a key with the right prefix/ext but no valid <name>-<hash> middle is not a derivative", () => {
    expect(isDerivativeKeyOf(original, "tenant/photo.old.jpg")).toBe(false);
    expect(isDerivativeKeyOf(original, "tenant/photo.jpg")).toBe(false);
  });

  test("extension-less original: derivatives have no trailing extension either", () => {
    const noExtOriginal = "tenant/document";
    const noExtSuffix = variantSuffix("preview", { maxEdge: 256 });
    const noExtDerived = deriveKey(noExtOriginal, noExtSuffix);
    expect(isDerivativeKeyOf(noExtOriginal, noExtDerived)).toBe(true);
    expect(derivativeListPrefix(noExtOriginal)).toBe("tenant/document.");
  });

  test("multiple variants of the same original all match", () => {
    const cardSuffix = variantSuffix("card", { maxEdge: 1024 });
    const cardDerived = deriveKey(original, cardSuffix);
    expect(isDerivativeKeyOf(original, cardDerived)).toBe(true);
    expect(isDerivativeKeyOf(original, derived)).toBe(true);
  });
});
