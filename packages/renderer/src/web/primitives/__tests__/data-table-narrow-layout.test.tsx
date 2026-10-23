import { describe, expect, mock, test } from "bun:test";
import type { DataTableBulk } from "../../../data-table-bulk-types.ts";
import { fireEvent, render, screen, within } from "../../__tests__/test-utils.tsx";
import { defaultPrimitives } from "../index.tsx";

const { DataTable } = defaultPrimitives;

const columns = [
  { field: "title", label: "Title", type: "string", sortable: false },
  { field: "amount", label: "Amount", type: "number", sortable: false },
] as const;

const rows = [
  { id: "a1", values: { title: "Rent", amount: 900 } },
  { id: "a2", values: { title: "Power", amount: 80 } },
];

const statusFacet = {
  field: "status",
  label: "Status",
  options: [],
  showCounts: true,
  hideEmpty: false,
  chips: [{ id: "open", label: "Open", values: ["open"], count: 3 }],
};

function atWidth(width: number, run: () => void): void {
  const happyDom = (window as unknown as { happyDOM: { setInnerWidth: (n: number) => void } })
    .happyDOM;
  const original = window.innerWidth;
  happyDom.setInnerWidth(width);
  try {
    run();
  } finally {
    happyDom.setInnerWidth(original);
  }
}

describe("DataTable narrow layout parts", () => {
  test("a full-height narrow table hides its facets behind a toggle that opens them", () => {
    atWidth(500, () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          testId="t"
          scrollBody
          filterFacets={[statusFacet]}
          filterValues={{}}
          onFilterChange={mock()}
        />,
      );
      const toggle = screen.getByTestId("t-filter-toggle");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByTestId("facet-status-open")).toBeNull();
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByTestId("facet-status-open")).toBeDefined();
    });
  });

  test("cards carry the bulk checkbox and report the selection in the bar", () => {
    const bulk: DataTableBulk = {
      actions: [
        {
          id: "archive",
          label: "Archive",
          appliesTo: () => true,
          writeRow: async () => ({ kind: "succeeded" }),
        },
      ],
      reload: async () => {},
    };
    atWidth(500, () => {
      render(<DataTable columns={columns} rows={rows} testId="t" bulk={bulk} />);
      const card = within(screen.getByTestId("t-cards")).getByTestId("row-a1");
      fireEvent.click(within(card).getByTestId("row-a1-select"));
      expect(screen.getByTestId("bulk-selected-count").textContent).toBe("1 selected");
    });
  });

  test("cards show server group headers as list items and the totals card", () => {
    const onToggle = mock();
    atWidth(500, () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          testId="t"
          totals={{ measures: [{ field: "amount", kind: "sum", value: 980 }] }}
          serverGroups={{
            field: "title",
            totalCount: 2,
            groups: [
              {
                key: "open",
                value: "open",
                count: 2,
                measures: [],
                collapsed: false,
                rowCount: 2,
                hasMore: false,
                loading: false,
              },
            ],
            onToggle,
            onLoadMore: mock(),
            onHeaderVisible: mock(),
          }}
        />,
      );
      const header = screen.getByTestId("row-group-open-toggle");
      expect(header.closest("li")).not.toBeNull();
      fireEvent.click(header);
      expect(onToggle).toHaveBeenCalledWith("open");
      expect(within(screen.getByTestId("t-cards")).getByTestId("list-totals-amount")).toBeDefined();
    });
  });
});
