import { describe, expect, mock, test } from "bun:test";
import { ACTIONS_CONTENT_ATTRIBUTE } from "../primitives/data-table/actions-column.tsx";
import { DataTable } from "./_primitives-helpers.tsx";
import { fireEvent, render, screen } from "./test-utils.tsx";

const columns = [
  { field: "name", label: "Name", type: "string" as const, sortable: false },
  { field: "city", label: "City", type: "string" as const, sortable: false },
];
const rows = [{ id: "r1", values: { name: "Ada", city: "Wien" } }];

function renderTable(onRowClick: () => void, sized: boolean): void {
  render(
    <DataTable
      columns={columns}
      rows={rows}
      testId="t"
      onRowClick={onRowClick}
      rowActions={[{ id: "archive", label: "Archive", onTrigger: () => {} }]}
      view={{
        density: "comfortable",
        viewIsDefault: true,
        onViewReset: () => {},
        ...(sized && {
          widths: { name: 200, city: 150 },
          minWidths: { name: 120, city: 100 },
        }),
      }}
    />,
  );
}

describe("DataTable actions cell", () => {
  test("with sized columns a click on the empty cell opens the row", () => {
    const onRowClick = mock(() => {});
    renderTable(onRowClick, true);
    const cell = screen.getByTestId("cell-r1-actions");
    expect(cell.querySelector(`[${ACTIONS_CONTENT_ATTRIBUTE}]`)).not.toBeNull();
    fireEvent.click(cell);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  test("with sized columns a click on the row menu button does not open the row", () => {
    const onRowClick = mock(() => {});
    renderTable(onRowClick, true);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test("without sized columns a click on the cell does not open the row", () => {
    const onRowClick = mock(() => {});
    renderTable(onRowClick, false);
    const cell = screen.getByTestId("cell-r1-actions");
    expect(cell.querySelector(`[${ACTIONS_CONTENT_ATTRIBUTE}]`)).toBeNull();
    fireEvent.click(cell);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
