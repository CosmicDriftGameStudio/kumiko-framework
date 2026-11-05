import { describe, expect, test } from "bun:test";
import { buildNamedFilterFacet } from "../named-filter-facet.ts";
import type { NavApi } from "../nav.tsx";
import { buildSubtitleParts } from "../projection-detail-navigation.ts";

const translate = (key: string): string => key;
const OPEN = { id: "open", label: "Open" };
const DUE = { id: "due", label: "Due", separatorAfter: true };

const nav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "",
  searchParams: {},
  setSearchParams: () => {},
};

describe("named filter separatorAfter and narrowPlacement", () => {
  test("separatorAfter lands on the chip of that filter only", () => {
    const facet = buildNamedFilterFacet([DUE, OPEN], translate, [], { display: "select" });
    expect(facet?.chips?.map((chip) => chip.separatorAfter === true)).toEqual([false, true, false]);
  });

  test("narrowPlacement of the facet options reaches the facet", () => {
    const placed = buildNamedFilterFacet([OPEN], translate, [], {
      display: "select",
      narrowPlacement: "behind-filter",
    });
    const plain = buildNamedFilterFacet([OPEN], translate, [], { display: "select" });
    expect(placed?.narrowPlacement).toBe("behind-filter");
    expect(plain?.narrowPlacement).toBeUndefined();
  });
});

describe("subtitle part prefix", () => {
  test("a prefix is translated and kept apart from the value; an empty value drops the part", () => {
    const parts = buildSubtitleParts(
      [
        { field: "owner", prefix: "detail.owner" },
        { field: "empty", prefix: "detail.owner" },
      ],
      { owner: "Meier", empty: "" },
      nav,
      [],
      undefined,
      undefined,
      (key) => (key === "detail.owner" ? "Owner" : key),
      "en",
    );
    expect(parts).toEqual([{ field: "owner", text: "Meier", prefix: "Owner" }]);
  });
});
