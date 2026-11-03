import { describe, expect, test } from "bun:test";
import { buildNamedFilterFacet, isNamedFilterOffered } from "../named-filter-facet.ts";

const translate = (key: string): string => key;
const OPEN = { id: "open", label: "Open" };
const AUDIT = { id: "audit", label: "Audit", roles: ["Auditor", "TenantAdmin"] };

describe("isNamedFilterOffered", () => {
  test("a filter without roles is offered to everyone", () => {
    expect(isNamedFilterOffered(OPEN, [])).toBe(true);
    expect(isNamedFilterOffered(OPEN, undefined)).toBe(true);
  });

  test("a restricted filter needs one of its roles; unknown roles deny", () => {
    expect(isNamedFilterOffered(AUDIT, ["User"])).toBe(false);
    expect(isNamedFilterOffered(AUDIT, ["User", "Auditor"])).toBe(true);
    expect(isNamedFilterOffered(AUDIT, undefined)).toBe(false);
  });
});

describe("buildNamedFilterFacet", () => {
  test("hides the chips the user may not open", () => {
    const facet = buildNamedFilterFacet([OPEN, AUDIT], translate, ["User"]);
    expect(facet?.chips?.map((chip) => chip.id)).toEqual(["open"]);
  });

  test("keeps every chip for a matching role", () => {
    const facet = buildNamedFilterFacet([OPEN, AUDIT], translate, ["TenantAdmin"]);
    expect(facet?.chips?.map((chip) => chip.id)).toEqual(["open", "audit"]);
  });

  test("offers no facet when nothing is left", () => {
    expect(buildNamedFilterFacet([AUDIT], translate, ["User"])).toBeUndefined();
    expect(buildNamedFilterFacet(undefined, translate, ["User"])).toBeUndefined();
  });
});
