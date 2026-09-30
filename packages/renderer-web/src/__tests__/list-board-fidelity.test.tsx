import { describe, expect, mock, test } from "bun:test";
import { defaultPrimitives } from "../primitives/index.js";
import { fireEvent, render, screen, within } from "./test-utils.js";

const { DataTable } = defaultPrimitives;

const sortableColumns = [
  { field: "name", label: "Name", type: "text", sortable: true },
  { field: "term", label: "Laufzeit", type: "date", sortable: true },
] as const;

describe("list board fidelity", () => {
  test("sort icon is visible only on the sorted column; idle columns reveal it on hover", () => {
    render(
      <DataTable
        columns={sortableColumns}
        rows={[{ id: "r1", values: { name: "A", term: "2026-03-05" } }]}
        sort={{ field: "term", dir: "desc" }}
        onSortChange={mock()}
      />,
    );
    const sortedIcon = screen.getByTestId("column-term").querySelector("[data-sort-icon]");
    const idleIcon = screen.getByTestId("column-name").querySelector("[data-sort-icon]");
    expect(sortedIcon?.getAttribute("data-sort-icon")).toBe("active");
    expect(sortedIcon?.classList.contains("opacity-0")).toBe(false);
    expect(idleIcon?.getAttribute("data-sort-icon")).toBe("idle");
    expect(idleIcon?.classList.contains("opacity-0")).toBe(true);
  });

  test("empty cell renders an en dash", () => {
    render(
      <DataTable
        columns={[{ field: "name", label: "Name", type: "text", sortable: false }]}
        rows={[{ id: "r1", values: { name: null } }]}
      />,
    );
    expect(screen.getByTestId("cell-r1-name").textContent).toBe("–");
  });

  test("number and money columns are right-aligned in header and cells", () => {
    render(
      <DataTable
        columns={[
          { field: "rent", label: "Miete", type: "number", sortable: false },
          { field: "name", label: "Name", type: "text", sortable: false },
        ]}
        rows={[{ id: "r1", values: { rent: 1200, name: "A" } }]}
      />,
    );
    expect(screen.getByTestId("column-rent").classList.contains("text-right")).toBe(true);
    expect(screen.getByTestId("cell-r1-rent").classList.contains("text-right")).toBe(true);
    expect(screen.getByTestId("cell-r1-name").classList.contains("text-right")).toBe(false);
  });

  test("select cell takes its tone from the declared option tone", () => {
    render(
      <DataTable
        columns={[
          {
            field: "status",
            label: "Status",
            type: "select",
            sortable: false,
            optionLabels: { gekuendigt: "Gekündigt", offen: "Offen" },
            optionTones: { gekuendigt: "bad" },
          },
        ]}
        rows={[
          { id: "r1", values: { status: "gekuendigt" } },
          { id: "r2", values: { status: "offen" } },
        ]}
      />,
    );
    const toned = screen.getByTestId("cell-r1-status");
    expect(toned.querySelector("[data-status-dot]")).not.toBeNull();
    expect(toned.innerHTML).toContain("text-status-bad");
    expect(screen.getByTestId("cell-r2-status").querySelector("[data-status-dot]")).toBeNull();
  });

  test("an inherited Object key as select value does not read as a declared tone", () => {
    render(
      <DataTable
        columns={[
          {
            field: "status",
            label: "Status",
            type: "select",
            sortable: false,
            optionLabels: { constructor: "Constructor", aktiv: "Aktiv" },
            optionTones: { aktiv: "ok" },
          },
        ]}
        rows={[
          { id: "r1", values: { status: "constructor" } },
          { id: "r2", values: { status: "aktiv" } },
        ]}
      />,
    );
    const cell = screen.getByTestId("cell-r1-status");
    expect(cell.textContent).toContain("Constructor");
    expect(cell.querySelector("[data-status-dot]")).toBeNull();
    expect(screen.getByTestId("cell-r2-status").querySelector("[data-status-dot]")).not.toBeNull();
  });

  test("footer names the entity plural and offers a page-size select", () => {
    const onPageSizeChange = mock();
    render(
      <DataTable
        columns={[{ field: "name", label: "Name", type: "text", sortable: false }]}
        rows={[{ id: "r1", values: { name: "A" } }]}
        testId="dt"
        itemNoun={() => "Mietverträgen"}
        pager={{
          page: 1,
          limit: 25,
          total: 19,
          onPageChange: mock(),
          pageSizeOptions: [25, 50, 100],
          onPageSizeChange,
        }}
      />,
    );
    expect(screen.getByTestId("dt-pager-status").textContent).toBe("1–19 of 19 Mietverträgen");
    const select = screen.getByTestId("dt-pager-page-size") as HTMLSelectElement;
    expect(within(select).getAllByRole("option").length).toBe(3);
    expect(select.className).toContain("appearance-none");
    expect(select.parentElement?.querySelector("svg")).not.toBeNull();
    fireEvent.change(select, { target: { value: "50" } });
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  test("count footer without pager uses singular noun", () => {
    render(
      <DataTable
        columns={[{ field: "name", label: "Name", type: "text", sortable: false }]}
        rows={[{ id: "r1", values: { name: "A" } }]}
        testId="dt"
        scrollBody
        itemNoun={(count) => (count === 1 ? "Position" : "Positionen")}
      />,
    );
    expect(screen.getByTestId("dt-footer-count").textContent).toBe("1 Position");
  });
});
