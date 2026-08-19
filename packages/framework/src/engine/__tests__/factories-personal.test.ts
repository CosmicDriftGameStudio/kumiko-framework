// Unit tests for the `personal`/`find` PII annotation resolution
// (kumiko-framework#2250) — the `expandPersonalAnnotations` helper in
// ../factories, exercised through the public factory functions.

import { describe, expect, test } from "bun:test";
import { createLongTextField, createTextField, createTimestampField } from "../factories";

describe("createTextField — personal/find resolution", () => {
  test("no annotation at all: no PII flags, no personal/find/reason leak into the field", () => {
    const f = createTextField({ required: true });
    expect(f).toEqual({
      type: "text",
      maxLength: 200,
      required: true,
      searchable: false,
      sortable: false,
    });
    expect(f).not.toHaveProperty("personal");
    expect(f).not.toHaveProperty("find");
    expect(f).not.toHaveProperty("reason");
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
});
