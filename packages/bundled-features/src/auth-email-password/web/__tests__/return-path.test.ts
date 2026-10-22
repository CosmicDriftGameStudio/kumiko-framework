import { describe, expect, test } from "bun:test";
import {
  isSafeReturnPath,
  MAX_RETURN_PATH_LENGTH,
  readReturnToFromSearch,
} from "../return-path.ts";

describe("isSafeReturnPath", () => {
  test.each([
    "/",
    "/a",
    "/a?x=1#h",
    "/a/path%2F..%2Fx",
    `/${"a".repeat(MAX_RETURN_PATH_LENGTH - 1)}`,
  ])("accepts %j", (path) => {
    expect(isSafeReturnPath(path)).toBe(true);
  });

  test.each([
    "//evil",
    "https://evil",
    "/\\evil",
    "javascript:alert(1)",
    "/\t/evil",
    "/a\u0000b",
    "/a\u0085b",
    "/.//evil",
    "/%2e%2e/x",
    "/%2E./x",
    "/a/../b",
    "/a/./b",
    "/a/%2e",
    "",
    `/${"a".repeat(MAX_RETURN_PATH_LENGTH)}`,
  ])("rejects %j", (candidate) => {
    expect(isSafeReturnPath(candidate)).toBe(false);
  });

  test("accepts dot segments that only appear in the query or hash", () => {
    expect(isSafeReturnPath("/a?next=/../b#/./c")).toBe(true);
  });

  test("rejects non-strings", () => {
    expect(isSafeReturnPath(undefined)).toBe(false);
    expect(isSafeReturnPath(null)).toBe(false);
    expect(isSafeReturnPath(42)).toBe(false);
  });
});

describe("readReturnToFromSearch", () => {
  test("returns a safe returnTo", () => {
    expect(readReturnToFromSearch("?token=t&returnTo=%2Fa%2Fsettings")).toBe("/a/settings");
  });

  test.each(["?returnTo=%2F%2Fevil", "?returnTo=https%3A%2F%2Fevil", "?other=1", ""])(
    "returns null for %j",
    (search) => {
      expect(readReturnToFromSearch(search)).toBeNull();
    },
  );
});
