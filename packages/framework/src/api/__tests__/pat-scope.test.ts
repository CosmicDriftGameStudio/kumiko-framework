import { describe, expect, it } from "bun:test";
import { patAllows, qnMatches } from "../pat-scope";

describe("qnMatches", () => {
  it("exact match", () => {
    expect(qnMatches("credit:query:schedule", "credit:query:schedule")).toBe(true);
    expect(qnMatches("credit:query:schedule", "credit:query:credit:list")).toBe(false);
  });

  it("wildcard suffix matches on prefix", () => {
    expect(qnMatches("credit:write:bauspar:*", "credit:write:bauspar:create")).toBe(true);
    expect(qnMatches("credit:write:bauspar:*", "credit:write:bauspar:delete")).toBe(true);
    expect(qnMatches("credit:write:bauspar:*", "credit:write:create")).toBe(false);
  });

  it("bare wildcard matches everything", () => {
    expect(qnMatches("*", "anything:at:all")).toBe(true);
  });
});

describe("patAllows", () => {
  const allowed = ["credit:write:create", "credit:write:bauspar:*"];

  it("permits an exact or wildcard-covered type", () => {
    expect(patAllows(allowed, "credit:write:create")).toBe(true);
    expect(patAllows(allowed, "credit:write:bauspar:update")).toBe(true);
  });

  it("denies a type no scope covers", () => {
    expect(patAllows(allowed, "credit:write:credit:delete")).toBe(false);
  });

  it("fail-closed on an empty allow-list", () => {
    expect(patAllows([], "credit:write:create")).toBe(false);
  });
});
