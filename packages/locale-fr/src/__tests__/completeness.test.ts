import { describe, expect, test } from "bun:test";
import { localeFrBundle } from "../strings";
import { frameworkEnCatalog } from "./en-catalog";

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
}

describe("locale-fr completeness", () => {
  test("has every English framework key", () => {
    const missing = Object.keys(frameworkEnCatalog).filter((k) => localeFrBundle[k] === undefined);
    expect(missing).toEqual([]);
  });

  test("has no stale extra keys", () => {
    const extra = Object.keys(localeFrBundle).filter((k) => frameworkEnCatalog[k] === undefined);
    expect(extra).toEqual([]);
  });

  test("interpolation placeholders match English", () => {
    for (const key of Object.keys(frameworkEnCatalog)) {
      expect(placeholders(localeFrBundle[key] ?? "")).toEqual(
        placeholders(frameworkEnCatalog[key] ?? ""),
      );
    }
  });

  test("uses localized tenant wording, not raw English tenant labels", () => {
    const roleAllowlist = new Set(["TenantAdmin", "SystemAdmin"]);
    const offenders: string[] = [];
    for (const [key, value] of Object.entries(localeFrBundle)) {
      if (roleAllowlist.has(value)) continue;
      if (/\btenants?\b/i.test(value)) offenders.push(key);
    }
    expect(offenders).toEqual([]);
  });
});
