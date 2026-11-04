import { describe, expect, test } from "bun:test";
import {
  buildNamedFilterCountQueries,
  buildNamedFilterEmpty,
  buildNamedFilterFacet,
  isNamedFilterOffered,
  namedFilterCountKey,
  namedFilterSort,
} from "../named-filter-facet.ts";

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

describe("select display with counts", () => {
  const SELECT = { display: "select", showCounts: true } as const;
  const counts = {
    [namedFilterCountKey(undefined)]: 8,
    [namedFilterCountKey("open")]: 5,
  };

  test("adds an all entry and puts the hit counts on every entry that has one", () => {
    const facet = buildNamedFilterFacet([OPEN, AUDIT], translate, ["Auditor"], SELECT, counts);
    expect(facet?.display).toBe("select");
    expect(facet?.chips?.map((chip) => [chip.id, chip.count])).toEqual([
      ["all", 8],
      ["open", 5],
      ["audit", undefined],
    ]);
  });

  test("chips display has no all entry and no counts without showCounts", () => {
    const facet = buildNamedFilterFacet([OPEN], translate, [], { display: "chips" }, counts);
    expect(facet?.chips?.map((chip) => chip.id)).toEqual(["open"]);
    expect(facet?.chips?.[0]?.count).toBeUndefined();
  });

  test("asks one count query per offered filter plus one for all", () => {
    const queries = buildNamedFilterCountQueries([OPEN, AUDIT], ["User"], SELECT, { limit: 1 });
    expect(queries).toEqual([
      { key: namedFilterCountKey(undefined), payload: { limit: 1 } },
      { key: namedFilterCountKey("open"), payload: { limit: 1, namedFilter: "open" } },
    ]);
    expect(buildNamedFilterCountQueries([OPEN], [], { display: "select" }, {})).toEqual([]);
  });
});

describe("filter-owned sort and empty state", () => {
  const SORTED = { id: "todo", label: "Todo", sort: { field: "urgency", dir: "desc" } } as const;
  const WITH_EMPTY = {
    id: "todo",
    label: "Todo",
    emptyState: { title: "all.done", description: "all.done.hint" },
  };

  test("the active filter's sort is returned, none without an active filter", () => {
    expect(namedFilterSort([OPEN, SORTED], "todo")).toEqual({ field: "urgency", dir: "desc" });
    expect(namedFilterSort([OPEN, SORTED], "open")).toBeUndefined();
    expect(namedFilterSort([OPEN, SORTED], undefined)).toBeUndefined();
  });

  test("the empty state is translated and carries the reset", () => {
    const onReset = () => {};
    expect(buildNamedFilterEmpty([WITH_EMPTY], "todo", "", false, translate, onReset)).toEqual({
      title: "all.done",
      description: "all.done.hint",
      onReset,
    });
  });

  test("no empty state for a search term, another filter or none declared", () => {
    const onReset = () => {};
    expect(
      buildNamedFilterEmpty([WITH_EMPTY], "todo", "abc", false, translate, onReset),
    ).toBeUndefined();
    expect(
      buildNamedFilterEmpty([WITH_EMPTY, OPEN], "open", "", false, translate, onReset),
    ).toBeUndefined();
  });

  test("no empty state while a facet or date range narrows the list as well", () => {
    expect(
      buildNamedFilterEmpty([WITH_EMPTY], "todo", "", true, translate, () => {}),
    ).toBeUndefined();
  });
});
