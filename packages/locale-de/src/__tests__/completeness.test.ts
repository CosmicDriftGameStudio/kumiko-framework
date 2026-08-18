import { describe, expect, test } from "bun:test";
import { localeDeBundle } from "../strings";
import { frameworkEnCatalog } from "./en-catalog";

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
}

describe("locale-de completeness", () => {
  test("has every English framework key", () => {
    const missing = Object.keys(frameworkEnCatalog).filter((k) => localeDeBundle[k] === undefined);
    expect(missing).toEqual([]);
  });

  test("has no stale extra keys", () => {
    const extra = Object.keys(localeDeBundle).filter((k) => frameworkEnCatalog[k] === undefined);
    expect(extra).toEqual([]);
  });

  test("interpolation placeholders match English", () => {
    for (const key of Object.keys(frameworkEnCatalog)) {
      expect(placeholders(localeDeBundle[key] ?? "")).toEqual(
        placeholders(frameworkEnCatalog[key] ?? ""),
      );
    }
  });
});
