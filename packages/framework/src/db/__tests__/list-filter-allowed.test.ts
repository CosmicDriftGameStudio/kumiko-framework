import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine/factories.js";
import { isListFilterAllowed, isListSortAllowed } from "../entity-field-encryption.js";

const entity = createEntity({
  table: "read_list_filter_allowed",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture" }),
    note: createTextField({ personal: false, reason: "test_fixture", encrypted: true }),
    apiKey: createTextField({ personal: "tenant", find: "secret" }),
    email: createTextField({ personal: "tenant", find: "exact" }),
    nickname: createTextField({ personal: "tenant", find: "none" }),
  },
});

describe("isListFilterAllowed", () => {
  test("plain fields accept every op", () => {
    expect(isListFilterAllowed(entity, "title", { op: "gt", value: "a" })).toBe(true);
    expect(isListFilterAllowed(entity, "title", { op: "in", value: ["a"] })).toBe(true);
  });

  test("secret, encrypted and non-findable personal fields accept no op", () => {
    for (const field of ["apiKey", "note", "nickname"]) {
      expect(isListFilterAllowed(entity, field, { op: "eq", value: "a" })).toBe(false);
    }
  });

  test("a blind-indexed personal field accepts eq with a string only", () => {
    expect(isListFilterAllowed(entity, "email", { op: "eq", value: "a@example.com" })).toBe(true);
    expect(isListFilterAllowed(entity, "email", { op: "eq", value: 1 })).toBe(false);
    expect(isListFilterAllowed(entity, "email", { op: "ne", value: "a" })).toBe(false);
    expect(isListFilterAllowed(entity, "email", { op: "in", value: ["a"] })).toBe(false);
    expect(isListFilterAllowed(entity, "email", { op: "gte", value: "a" })).toBe(false);
  });

  test("an unknown field is left to the caller", () => {
    expect(isListFilterAllowed(entity, "ghost", { op: "eq", value: "a" })).toBe(true);
  });
});

describe("isListSortAllowed", () => {
  test("only plain fields sort", () => {
    expect(isListSortAllowed(entity, "title")).toBe(true);
    for (const field of ["apiKey", "note", "email", "nickname"]) {
      expect(isListSortAllowed(entity, field)).toBe(false);
    }
  });
});
