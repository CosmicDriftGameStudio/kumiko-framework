import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type {
  DataTableServerGroup,
  DataTableServerGroups,
} from "../../../data-table-aggregate-types.ts";
import type { DataTableProps } from "../../../index.ts";
import { defaultPrimitives } from "../index.tsx";

const { DataTable } = defaultPrimitives;

const columns = [
  { field: "title", label: "Title", type: "string", sortable: false },
  { field: "status", label: "Status", type: "string", sortable: false },
  { field: "amount", label: "Amount", type: "number", sortable: false },
] as const;

const rows = [
  { id: "a1", values: { title: "Rent", status: "open", amount: 900 } },
  { id: "a2", values: { title: "Power", status: "open", amount: 80 } },
];

function group(
  overrides: Partial<DataTableServerGroup> & { readonly key: string },
): DataTableServerGroup {
  return {
    value: overrides.key,
    count: 0,
    measures: [],
    collapsed: false,
    rowCount: 0,
    hasMore: false,
    loading: false,
    ...overrides,
  };
}

function serverGroups(groups: readonly DataTableServerGroup[]): DataTableServerGroups & {
  readonly onToggle: ReturnType<typeof mock>;
  readonly onLoadMore: ReturnType<typeof mock>;
  readonly onHeaderVisible: ReturnType<typeof mock>;
} {
  return {
    field: "status",
    groups,
    totalCount: groups.reduce((sum, g) => sum + g.count, 0),
    onToggle: mock(),
    onLoadMore: mock(),
    onHeaderVisible: mock(),
  };
}

function renderTable(overrides: Partial<DataTableProps>) {
  return render(<DataTable columns={columns} rows={rows} testId="t" {...overrides} />);
}

describe("DataTable server groups", () => {
  const open = group({
    key: "open",
    count: 7,
    rowCount: 2,
    hasMore: true,
    measures: [{ field: "amount", kind: "sum", value: 4321 }],
  });
  const done = group({ key: "done", count: 3, collapsed: true });

  test("the header shows the server count and measure, not a count of loaded rows", () => {
    renderTable({ serverGroups: serverGroups([open, done]) });
    expect(screen.getByTestId("row-group-open-count").textContent).toBe("7");
    expect(screen.getByTestId("row-group-open-sum-amount").textContent).toContain("4,321");
    expect(screen.getByTestId("row-group-done-count").textContent).toBe("3");
  });

  test("rows sit under their open group; a collapsed group shows only its header", () => {
    renderTable({ serverGroups: serverGroups([open, done]) });
    expect(screen.getByTestId("row-group-open-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("row-group-done-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Rent")).toBeDefined();
    expect(screen.queryByTestId("row-group-done-load-more")).toBeNull();
  });

  test("toggle and load more report the group key; the global pager is gone", () => {
    const groups = serverGroups([open, done]);
    renderTable({
      serverGroups: groups,
      pager: { page: 1, limit: 2, total: 10, onPageChange: () => undefined },
    });
    fireEvent.click(screen.getByTestId("row-group-done-toggle"));
    fireEvent.click(screen.getByTestId("row-group-open-load-more"));
    expect(groups.onToggle).toHaveBeenCalledWith("done");
    expect(groups.onLoadMore).toHaveBeenCalledWith("open");
    expect(screen.queryByTestId("t-pager")).toBeNull();
  });

  test("a header asks for its rows only once it scrolls near the viewport", () => {
    const observed: Array<(entries: readonly { readonly isIntersecting: boolean }[]) => void> = [];
    class FakeIntersectionObserver {
      constructor(callback: (entries: readonly { readonly isIntersecting: boolean }[]) => void) {
        observed.push(callback);
      }
      observe(): void {}
      disconnect(): void {}
    }
    const original = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
    Object.defineProperty(globalThis, "IntersectionObserver", {
      value: FakeIntersectionObserver,
      configurable: true,
      writable: true,
    });
    try {
      const groups = serverGroups([open, done]);
      renderTable({ serverGroups: groups });
      expect(groups.onHeaderVisible).not.toHaveBeenCalled();
      observed[0]?.([{ isIntersecting: true }]);
      expect(groups.onHeaderVisible).toHaveBeenCalledWith("open");
      expect(groups.onHeaderVisible).not.toHaveBeenCalledWith("done");
    } finally {
      if (original !== undefined)
        Object.defineProperty(globalThis, "IntersectionObserver", original);
    }
  });
});

describe("DataTable totals row", () => {
  test("a footer row renders each measure under its column", () => {
    renderTable({ totals: { measures: [{ field: "amount", kind: "sum", value: 980 }] } });
    expect(screen.getByTestId("list-totals")).toBeDefined();
    expect(screen.getByTestId("list-totals-amount").textContent).toContain("980");
  });
});

describe("DataTable number range facet", () => {
  test("from/to commit on blur with the field and bound", () => {
    const onRangeChange = mock();
    renderTable({
      rangeFacets: [{ field: "amount", label: "Amount", min: "", max: "100" }],
      onRangeChange,
    });
    const min = screen.getByTestId("facet-range-amount-min");
    fireEvent.change(min, { target: { value: "10" } });
    fireEvent.blur(min);
    expect(onRangeChange).toHaveBeenCalledWith("amount", "min", "10");
    expect(screen.getByTestId("facet-range-amount-max")).toHaveProperty("value", "100");
  });

  test("the truncated notice shows in the toolbar", () => {
    renderTable({ notice: "truncated" });
    expect(screen.getByTestId("list-notice").getAttribute("data-notice")).toBe("truncated");
  });
});
