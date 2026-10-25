// The correctness boundary is the ID comparison, not listener wiring.
// shouldShowUpdate encapsulates the "never show a fake banner" invariant;
// the four cases are tested directly here.

import { describe, expect, test } from "bun:test";
import { isKumikoBuild, shouldShowUpdate } from "../update-checker.tsx";

describe("shouldShowUpdate", () => {
  test("different server ID than loaded → banner", () => {
    expect(shouldShowUpdate("aaa", { id: "bbb", builtAt: "2026-06-18T00:00:00Z" })).toBe(true);
  });

  test("same ID → no banner", () => {
    expect(shouldShowUpdate("aaa", { id: "aaa", builtAt: "2026-06-18T00:00:00Z" })).toBe(false);
  });

  test("no server version (fetch error/invalid JSON → null) → no banner", () => {
    expect(shouldShowUpdate("aaa", null)).toBe(false);
  });

  test("no loaded version (Dev/old bundle) → no banner, even with server drift", () => {
    expect(shouldShowUpdate(undefined, { id: "bbb", builtAt: "2026-06-18T00:00:00Z" })).toBe(false);
    expect(shouldShowUpdate("", { id: "bbb", builtAt: "2026-06-18T00:00:00Z" })).toBe(false);
  });
});

describe("isKumikoBuild", () => {
  test("accepts a build-info shape with a non-empty id", () => {
    expect(isKumikoBuild({ id: "abc" })).toBe(true);
    expect(isKumikoBuild({ id: "abc", builtAt: "2026-06-18T00:00:00Z" })).toBe(true);
  });

  test("rejects an empty/missing/wrong-typed id, and non-object payloads", () => {
    expect(isKumikoBuild({ id: "" })).toBe(false);
    expect(isKumikoBuild({})).toBe(false);
    expect(isKumikoBuild({ id: 123 })).toBe(false);
    expect(isKumikoBuild(null)).toBe(false);
    expect(isKumikoBuild(undefined)).toBe(false);
    expect(isKumikoBuild("abc")).toBe(false);
    expect(isKumikoBuild([])).toBe(false);
  });
});
