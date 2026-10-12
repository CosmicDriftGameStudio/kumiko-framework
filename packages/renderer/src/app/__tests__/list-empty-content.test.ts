import { describe, expect, test } from "bun:test";
import { isListNarrowed } from "../list-empty-content.js";

describe("isListNarrowed", () => {
  test("a search term narrows the list", () => {
    expect(isListNarrowed("acme", {})).toBe(true);
  });

  test("a blank search term does not", () => {
    expect(isListNarrowed("  ", {})).toBe(false);
  });

  test("a filter without a declared default narrows the list", () => {
    expect(isListNarrowed("", { status: ["open"] })).toBe(true);
  });

  test("an untouched default filter does not narrow the list", () => {
    expect(isListNarrowed("", { status: ["active"] }, { status: ["active"] })).toBe(false);
  });

  test("changing a default filter narrows the list", () => {
    expect(isListNarrowed("", { status: ["ended"] }, { status: ["active"] })).toBe(true);
  });

  test("clearing a default filter narrows the list", () => {
    expect(isListNarrowed("", { status: [] }, { status: ["active"] })).toBe(true);
  });

  test("an empty selection on a facet without default is still the initial state", () => {
    expect(isListNarrowed("", { status: [] })).toBe(false);
  });
});
