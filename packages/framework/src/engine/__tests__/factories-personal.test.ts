// Unit tests for the `personal`/`find` PII annotation resolution
// (kumiko-framework#2250) — the `expandPersonalAnnotations` helper in
// ../factories, exercised through the public factory functions.

import { describe, expect, test } from "bun:test";
import {
  createLongTextField,
  createNumberField,
  createTextField,
  createTimestampField,
} from "../factories.js";

describe("createTextField — personal/find resolution", () => {
  // kumiko-framework#2921 — a text field can no longer be constructed
  // without declaring whose data it holds, neither at the type level nor
  // at runtime (fail-closed for untyped JS callers).
  test("no argument at all throws", () => {
    expect(() =>
      // @ts-expect-error overrides (with a personal stance) is now required
      createTextField(),
    ).toThrow(/must declare an explicit personal-data stance/);
  });

  test("options without `personal` throws", () => {
    expect(() =>
      // @ts-expect-error `personal` is required on the options object
      createTextField({ required: true }),
    ).toThrow(/createTextField\(\.\.\.\) must declare an explicit personal-data stance/);
  });

  test("an untyped JS caller passing null throws the same guidance instead of a raw TypeError", () => {
    // Simulated untyped-boundary call — a real JS consumer has no compiler
    // to reject this, so the runtime gate must catch it. Cast only here.
    const call = () => createTextField(null as unknown as Parameters<typeof createTextField>[0]);
    expect(call).toThrow(/must declare an explicit personal-data stance/);
  });

  test("an untyped JS caller passing personal: null throws the guidance message, not a raw TypeError", () => {
    // Same untyped-boundary simulation, but `personal` itself is null
    // instead of the whole options object — the object-branch subject
    // check must not dereference `.of` on it.
    const call = () =>
      createTextField({ personal: null } as unknown as Parameters<typeof createTextField>[0]);
    expect(call).toThrow(/must declare an explicit personal-data stance/);
  });

  test('personal: "self" without find throws', () => {
    expect(() =>
      // @ts-expect-error `find` is required alongside a named subject
      createTextField({ personal: "self" }),
    ).toThrow(/must declare an explicit personal-data stance/);
  });

  test("personal: false without a reason throws", () => {
    expect(() =>
      // @ts-expect-error `reason` is required alongside `personal: false`
      createTextField({ personal: false }),
    ).toThrow(/must declare an explicit personal-data stance/);
  });

  test("personal: false with a reason works", () => {
    const f = createTextField({ personal: false, reason: "is_business_data" });
    expect(f.allowPlaintext).toBe("is_business_data");
  });

  test("an invalid personal value throws and lists every valid stance", () => {
    const call = () =>
      createTextField({
        // @ts-expect-error "yes" is not a valid personal stance
        personal: "yes",
      });
    expect(call).toThrow(/must declare an explicit personal-data stance/);
    try {
      call();
      throw new Error("expected createTextField to throw");
    } catch (error) {
      const message = String(error);
      expect(message).toContain('personal: "self"');
      expect(message).toContain('personal: "tenant"');
      expect(message).toContain('personal: { of: "<ownerField>" }');
      expect(message).toContain('personal: "ref"');
      expect(message).toContain("personal: false, reason:");
    }
  });

  test('personal: "self", find: "exact" → pii + lookupable', () => {
    const f = createTextField({ personal: "self", find: "exact" });
    expect(f.pii).toBe(true);
    expect(f.lookupable).toBe(true);
    expect(f.searchable).toBe(false);
    expect(f).not.toHaveProperty("personal");
    expect(f).not.toHaveProperty("find");
  });

  test('personal: "self", find: "fuzzy" → pii + lookupable + searchable', () => {
    const f = createTextField({ personal: "self", find: "fuzzy" });
    expect(f.pii).toBe(true);
    expect(f.lookupable).toBe(true);
    expect(f.searchable).toBe(true);
  });

  test('personal: "self", find: "none" → pii only, no lookup/search flags', () => {
    const f = createTextField({ personal: "self", find: "none" });
    expect(f.pii).toBe(true);
    expect(f.lookupable).toBeUndefined();
    expect(f.searchable).toBe(false);
    expect(f.sensitive).toBeUndefined();
  });

  test('personal: "self", find: "secret" → pii + sensitive, no lookup/search', () => {
    const f = createTextField({ personal: "self", find: "secret" });
    expect(f.pii).toBe(true);
    expect(f.sensitive).toBe(true);
    expect(f.lookupable).toBeUndefined();
    expect(f.searchable).toBe(false);
  });

  test('personal: "tenant", find: "exact" → tenantOwned + lookupable', () => {
    const f = createTextField({ personal: "tenant", find: "exact" });
    expect(f.tenantOwned).toBe(true);
    expect(f.lookupable).toBe(true);
    expect(f.pii).toBeUndefined();
  });

  test('personal: { of: "ownerId" }, find: "exact" → userOwned + lookupable', () => {
    const f = createTextField({ personal: { of: "ownerId" }, find: "exact" });
    expect(f.userOwned).toEqual({ ownerField: "ownerId" });
    expect(f.lookupable).toBe(true);
  });

  test('personal: "ref" → subjectRef only, no find allowed on this variant', () => {
    const f = createTextField({ personal: "ref" });
    expect(f.subjectRef).toBe(true);
    expect(f.pii).toBeUndefined();
    expect(f.lookupable).toBeUndefined();
  });

  test("personal: false, reason given → allowPlaintext carries the reason", () => {
    const f = createTextField({ personal: false, reason: "public display name, not identifying" });
    expect(f.allowPlaintext).toBe("public display name, not identifying");
    expect(f.pii).toBeUndefined();
  });

  test("anonymize survives resolution alongside a subject annotation", () => {
    const anonymize = () => "[ANONYMIZED]";
    const f = createTextField({ personal: "self", find: "none", anonymize });
    expect(f.pii).toBe(true);
    expect(f.anonymize).toBe(anonymize);
  });

  test("other overrides (e.g. maxLength) pass through unaffected", () => {
    const f = createTextField({ personal: "self", find: "none", maxLength: 500 });
    expect(f.maxLength).toBe(500);
    expect(f.pii).toBe(true);
  });
});

describe("createLongTextField — restricted find (PersonalAnnotationsLongText)", () => {
  test('personal: "self", find: "none" → pii only, no lookup/search flags', () => {
    const f = createLongTextField({ personal: "self", find: "none" });
    expect(f.pii).toBe(true);
    expect(f.lookupable).toBeUndefined();
    expect(f).not.toHaveProperty("searchable");
    expect(f.sensitive).toBeUndefined();
  });

  test('personal: "self", find: "secret" → pii + sensitive, no lookup/search', () => {
    const f = createLongTextField({ personal: "self", find: "secret" });
    expect(f.pii).toBe(true);
    expect(f.sensitive).toBe(true);
    expect(f.lookupable).toBeUndefined();
    expect(f).not.toHaveProperty("searchable");
  });

  test('find: "exact" is a createTextField-only value — createLongTextField rejects it', () => {
    expect(() =>
      createLongTextField({
        personal: "self",
        // @ts-expect-error "exact"/"fuzzy" don't exist on LongTextFindability
        find: "exact",
      }),
    ).toThrow(/must declare an explicit personal-data stance/);
  });
});

describe("createTimestampField — personal without find (PersonalAnnotationsNoFind)", () => {
  test("no annotation at all: plain field, no PII flags", () => {
    const f = createTimestampField({ required: true });
    expect(f).toEqual({ type: "timestamp", required: true });
  });

  test('personal: "self" alone (no find on non-text factories) → pii only', () => {
    const f = createTimestampField({ personal: "self" });
    expect(f.pii).toBe(true);
    expect(f).not.toHaveProperty("personal");
    expect(f).not.toHaveProperty("find");
  });

  test("personal: false, reason given → allowPlaintext", () => {
    const f = createTimestampField({ personal: false, reason: "server-generated, not user data" });
    expect(f.allowPlaintext).toBe("server-generated, not user data");
  });

  // kumiko-framework#2921 only tightens text/longText — NoFind factories
  // keep `personal` optional and stay callable without an argument.
  test("createTimestampField() without any argument still works", () => {
    const f = createTimestampField();
    expect(f).toEqual({ type: "timestamp", required: false });
  });

  test("createNumberField() without any argument still works", () => {
    const f = createNumberField();
    expect(f.type).toBe("number");
    expect(f).not.toHaveProperty("personal");
  });
});
