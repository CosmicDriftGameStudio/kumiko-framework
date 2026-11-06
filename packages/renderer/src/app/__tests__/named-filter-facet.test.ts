import { describe, expect, test } from "bun:test";
import {
  buildNamedFilterCountQueries,
  buildNamedFilterEmpty,
  buildNamedFilterFacet,
  namedFilterCountKey,
  namedFilterSort,
} from "../named-filter-facet.ts";

const translate = (key: string): string => key;
const OPEN = { id: "open", label: "Open" };
const AUDIT = { id: "audit", label: "Audit", access: { roles: ["Auditor", "TenantAdmin"] } };

function offeredIds(
  refs: Parameters<typeof buildNamedFilterFacet>[0],
  roles: readonly string[] | undefined,
): readonly string[] | undefined {
  return buildNamedFilterFacet(refs, translate, roles)?.chips?.map((chip) => chip.id);
}

describe("named filter access rule", () => {
  test("a filter without a rule is offered to everyone", () => {
    expect(offeredIds([OPEN], [])).toEqual(["open"]);
    expect(offeredIds([OPEN], undefined)).toEqual(["open"]);
  });

  test("a restricted filter needs one of its roles; unknown roles deny", () => {
    expect(offeredIds([AUDIT], ["User"])).toBeUndefined();
    expect(offeredIds([AUDIT], ["User", "Auditor"])).toEqual(["audit"]);
    expect(offeredIds([AUDIT], undefined)).toBeUndefined();
  });

  test("anySignedIn opens a rule only next to the anonymous role", () => {
    const publicRef = {
      id: "pub",
      label: "Pub",
      access: { roles: ["anonymous"], anySignedIn: true as const },
    };
    expect(offeredIds([publicRef], ["User"])).toEqual(["pub"]);
    expect(offeredIds([publicRef], ["anonymous"])).toEqual(["pub"]);
    const gated = {
      id: "g",
      label: "G",
      access: { roles: ["Auditor"], anySignedIn: true as const },
    };
    expect(offeredIds([gated], ["User"])).toBeUndefined();
  });

  test("openToAll needs a non-empty reason", () => {
    const withReason = { id: "a", label: "A", access: { openToAll: { reason: "intake" } } };
    const blankReason = { id: "b", label: "B", access: { openToAll: { reason: " " } } };
    expect(offeredIds([withReason], ["User"])).toEqual(["a"]);
    expect(offeredIds([blankReason], ["User"])).toBeUndefined();
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

  // Stands in for the list payload builder: defaultFilters apply only without a named filter.
  const listPayloadFor = (namedFilter: string | undefined): Record<string, unknown> => ({
    limit: 25,
    sort: "due",
    sortDirection: "asc",
    offset: 50,
    cursor: "c1",
    search: "acme",
    filters: namedFilter === undefined ? [{ field: "status", value: "default" }] : [],
    ...(namedFilter === undefined ? {} : { namedFilter }),
  });

  test("the count payload is the list payload minus sort and paging, with limit 1 and totalCount", () => {
    const queries = buildNamedFilterCountQueries([OPEN, AUDIT], ["User"], SELECT, listPayloadFor);
    expect(queries).toEqual([
      {
        key: namedFilterCountKey(undefined),
        payload: {
          limit: 1,
          totalCount: true,
          search: "acme",
          filters: [{ field: "status", value: "default" }],
        },
      },
      {
        key: namedFilterCountKey("open"),
        payload: { limit: 1, totalCount: true, search: "acme", filters: [], namedFilter: "open" },
      },
    ]);
  });

  test("chips display asks no all count; nothing offered, nothing asked", () => {
    const queries = buildNamedFilterCountQueries(
      [OPEN],
      [],
      { display: "chips", showCounts: true },
      listPayloadFor,
    );
    expect(queries.map((query) => query.key)).toEqual([namedFilterCountKey("open")]);
    expect(buildNamedFilterCountQueries([AUDIT], [], SELECT, listPayloadFor)).toEqual([]);
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
