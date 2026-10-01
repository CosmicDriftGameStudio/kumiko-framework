import { describe, expect, mock, test } from "bun:test";
import type { DataTableProps } from "@cosmicdrift/kumiko-renderer";
import { fireEvent, render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../index.js";

const { DataTable } = defaultPrimitives;

const columns = [
  { field: "name", label: "Name", type: "string", sortable: false },
  { field: "status", label: "Status", type: "string", sortable: false },
] as const;

const rows = [
  { id: "r1", values: { name: "Spring", status: "open" } },
  { id: "r2", values: { name: "Summer", status: "done" } },
];

function renderTable(overrides: Partial<DataTableProps> = {}) {
  const onToggleRowExpanded = mock();
  const result = render(
    <DataTable
      columns={columns}
      rows={rows}
      testId="t"
      onToggleRowExpanded={onToggleRowExpanded}
      renderExpandedRow={(row) => <div data-testid={`content-${row.id}`}>sub-list of {row.id}</div>}
      expandedRowIds={new Set<string>()}
      {...overrides}
    />,
  );
  return { onToggleRowExpanded, ...result };
}

describe("DataTable expandable rows (table layout)", () => {
  test("without the expansion props there is no toggle column", () => {
    render(<DataTable columns={columns} rows={rows} testId="t" />);
    expect(screen.queryByTestId("row-r1-toggle")).toBeNull();
    expect(screen.queryByTestId("column-expand")).toBeNull();
  });

  test("every row gets a toggle button that starts collapsed, with no expansion row", () => {
    renderTable();
    for (const id of ["r1", "r2"]) {
      const toggle = screen.getByTestId(`row-${id}-toggle`);
      expect(toggle.tagName).toBe("BUTTON");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByTestId(`row-${id}-expansion`)).toBeNull();
    }
  });

  test("the toggle reports the row id and its label names the row", () => {
    const { onToggleRowExpanded } = renderTable();
    const toggle = screen.getByTestId("row-r1-toggle");
    expect(toggle.getAttribute("aria-label")).toContain("Spring");
    fireEvent.click(toggle);
    expect(onToggleRowExpanded).toHaveBeenCalledTimes(1);
    expect(onToggleRowExpanded).toHaveBeenCalledWith("r1");
  });

  test("an expanded row renders a full-width expansion row that the toggle controls", () => {
    renderTable({ expandedRowIds: new Set(["r1"]) });
    const toggle = screen.getByTestId("row-r1-toggle");
    const expansion = screen.getByTestId("row-r1-expansion");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe(expansion.id);
    expect(expansion.querySelector("td")?.getAttribute("colspan")).toBe("3");
    expect(screen.getByTestId("content-r1")).toBeDefined();
    expect(screen.queryByTestId("row-r2-expansion")).toBeNull();
  });

  test("several rows can be open at once", () => {
    renderTable({ expandedRowIds: new Set(["r1", "r2"]) });
    expect(screen.getByTestId("row-r1-expansion")).toBeDefined();
    expect(screen.getByTestId("row-r2-expansion")).toBeDefined();
  });

  test("toggling or clicking inside the expansion does not trigger the row click", () => {
    const onRowClick = mock();
    const { onToggleRowExpanded } = renderTable({
      expandedRowIds: new Set(["r1"]),
      onRowClick,
    });
    fireEvent.click(screen.getByTestId("row-r1-toggle"));
    fireEvent.click(screen.getByTestId("content-r1"));
    expect(onToggleRowExpanded).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test("keyboard events on the toggle stay inside it (no ancestor key handling)", () => {
    const onAncestorKeyDown = mock();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: probes that key events do not bubble out of the toggle
      <div onKeyDown={onAncestorKeyDown}>
        <DataTable
          columns={columns}
          rows={rows}
          testId="t"
          onToggleRowExpanded={mock()}
          renderExpandedRow={() => null}
          expandedRowIds={new Set<string>()}
        />
      </div>,
    );
    fireEvent.keyDown(screen.getByTestId("row-r1-toggle"), { key: "Enter" });
    expect(onAncestorKeyDown).not.toHaveBeenCalled();
  });

  test("a fixed-height table styles only its own header and cells, not nested tables", () => {
    renderTable({ scrollBody: true, expandedRowIds: new Set(["r1"]) });
    const className = screen.getByTestId("t").className;
    expect(className).toContain("[&>thead>tr>th]:sticky");
    expect(className).not.toContain("[&_th]");
    expect(className).not.toContain("[&_td]");
  });
});

describe("DataTable expandable rows (card layout)", () => {
  test("narrow viewport: toggle inside the row item, expansion as a sibling item outside the click target", () => {
    const originalWidth = window.innerWidth;
    window.innerWidth = 500;
    try {
      const onRowClick = mock();
      const { onToggleRowExpanded } = renderTable({
        expandedRowIds: new Set(["r1"]),
        onRowClick,
      });
      const item = screen.getByTestId("row-r1");
      const expansion = screen.getByTestId("row-r1-expansion");
      expect(item.tagName).toBe("LI");
      expect(item.contains(screen.getByTestId("row-r1-toggle"))).toBe(true);
      expect(item.contains(expansion)).toBe(false);
      expect(expansion.tagName).toBe("LI");

      fireEvent.click(screen.getByTestId("row-r1-toggle"));
      fireEvent.click(screen.getByTestId("content-r1"));
      expect(onToggleRowExpanded).toHaveBeenCalledWith("r1");
      expect(onRowClick).not.toHaveBeenCalled();
    } finally {
      window.innerWidth = originalWidth;
    }
  });
});
