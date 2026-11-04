import { describe, expect, test } from "bun:test";
import { parseSummaryItems, summaryRowPayload } from "../use-list-summary-row.ts";

describe("summaryRowPayload", () => {
  const listPayload = {
    namedFilter: "open",
    search: "acme",
    filter: { status: "open" },
    filters: [{ field: "status", op: "eq", value: "open" }],
    sort: "number",
    sortDirection: "desc",
    offset: 50,
    cursor: "abc",
    limit: 25,
    totalCount: true,
  };

  test("keeps the narrowing the user sees", () => {
    const payload = summaryRowPayload(listPayload, undefined);
    expect(payload["namedFilter"]).toBe("open");
    expect(payload["search"]).toBe("acme");
    expect(payload["filter"]).toEqual({ status: "open" });
    expect(payload["filters"]).toEqual(listPayload.filters);
  });

  test("drops sort, paging and the total flag", () => {
    const payload = summaryRowPayload(listPayload, undefined);
    for (const key of ["sort", "sortDirection", "offset", "cursor", "limit", "totalCount"]) {
      expect(Object.hasOwn(payload, key)).toBe(false);
    }
  });

  test("a static param is added but never overrides a list key", () => {
    const payload = summaryRowPayload(listPayload, { currency: "EUR", search: "other" });
    expect(payload["currency"]).toBe("EUR");
    expect(payload["search"]).toBe("acme");
  });
});

describe("parseSummaryItems", () => {
  test("keeps well-formed items with string or number values and a known tone", () => {
    const items = parseSummaryItems({
      items: [
        { label: "Orders", value: 8 },
        { label: "Late", value: "3", tone: "bad" },
      ],
    });
    expect(items).toEqual([
      { label: "Orders", value: 8 },
      { label: "Late", value: "3", tone: "bad" },
    ]);
  });

  test("drops items with a non-string label, an object value or an unknown tone; a missing label is kept", () => {
    expect(
      parseSummaryItems({
        items: [
          { label: 5, value: 1 },
          { label: "A", value: { nested: true } },
          { label: "B", value: 1, tone: "purple" },
          { label: "C", value: 2 },
          { value: 3 },
        ],
      }),
    ).toEqual([{ label: "C", value: 2 }, { value: 3 }]);
  });

  test("anything but an object with an items array is empty", () => {
    expect(parseSummaryItems(null)).toEqual([]);
    expect(parseSummaryItems({ items: "x" })).toEqual([]);
    expect(parseSummaryItems([{ label: "A", value: 1 }])).toEqual([]);
  });
});
