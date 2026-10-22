import { describe, expect, mock, test } from "bun:test";
import type { DataTableBulk, DataTableBulkAction } from "../../data-table-bulk-types.ts";
import type { DataTableViewOptions } from "../../data-table-view-types.ts";
import { DataTable } from "./_primitives-helpers.tsx";
import { act, fireEvent, render, screen } from "./test-utils.tsx";

const columns = [
  { field: "name", label: "Name", type: "string" as const, sortable: false },
  { field: "locked", label: "Locked", type: "boolean" as const, sortable: false },
];
const rows = [
  { id: "r1", values: { id: "r1", name: "Ada", locked: false } },
  { id: "r2", values: { id: "r2", name: "Bob", locked: true } },
  { id: "r3", values: { id: "r3", name: "Cy", locked: false } },
];

function archiveAction(overrides: Partial<DataTableBulkAction> = {}): DataTableBulkAction {
  return {
    id: "archive",
    label: "Archive",
    appliesTo: () => true,
    writeRow: async () => ({ kind: "succeeded" }),
    ...overrides,
  };
}

function bulkOf(action: DataTableBulkAction, reload = mock(async () => {})): DataTableBulk {
  return { actions: [action], reload };
}

function checkbox(testId: string): HTMLElement {
  return screen.getByTestId(testId);
}

function isChecked(testId: string): boolean {
  return checkbox(testId).getAttribute("data-state") === "checked";
}

const keyboardView: DataTableViewOptions = {
  density: "comfortable",
  viewIsDefault: true,
  onViewReset: () => {},
  keyboardNavigation: true,
};

describe("DataTable bulk selection", () => {
  test("without bulk there is no selection column and no bar", () => {
    render(<DataTable columns={columns} rows={rows} testId="t" />);
    expect(screen.queryByTestId("column-select")).toBeNull();
    expect(screen.queryByTestId("row-r1-select")).toBeNull();
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
  });

  test("a row checkbox selects without opening the row and shows the count in the bar", () => {
    const onRowClick = mock();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        onRowClick={onRowClick}
        bulk={bulkOf(archiveAction())}
      />,
    );
    expect(screen.getByTestId("column-select")).toBeTruthy();
    fireEvent.click(checkbox("row-r1-select"));
    fireEvent.click(checkbox("row-r3-select"));
    expect(onRowClick).not.toHaveBeenCalled();
    expect(screen.getByTestId("bulk-selected-count").textContent).toBe("2 selected");
    expect(checkbox("row-r1-select").getAttribute("aria-label")).toBe("Select Ada");
    expect(checkbox("select-all").getAttribute("data-state")).toBe("indeterminate");
  });

  test("the header checkbox selects all loaded rows and clears them again", () => {
    render(<DataTable columns={columns} rows={rows} testId="t" bulk={bulkOf(archiveAction())} />);
    fireEvent.click(checkbox("select-all"));
    expect(rows.every((row) => isChecked(`row-${row.id}-select`))).toBe(true);
    fireEvent.click(checkbox("select-all"));
    expect(rows.some((row) => isChecked(`row-${row.id}-select`))).toBe(false);
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
  });

  test("a run writes each applicable row, keeps failed rows selected and reloads once", async () => {
    const written: string[] = [];
    const reload = mock(async () => {});
    const action = archiveAction({
      appliesTo: (row) => row.values["locked"] !== true,
      writeRow: async (row) => {
        written.push(row.id);
        return row.id === "r3" ? { kind: "failed", message: "No access" } : { kind: "succeeded" };
      },
    });
    render(<DataTable columns={columns} rows={rows} testId="t" bulk={bulkOf(action, reload)} />);
    fireEvent.click(checkbox("select-all"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-action-archive"));
    });
    expect(written.sort()).toEqual(["r1", "r3"]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("bulk-result-succeeded").textContent).toBe("Succeeded: 1");
    expect(screen.getByTestId("bulk-result-failed").textContent).toBe("Failed: 1");
    expect(screen.getByTestId("bulk-result-skipped").textContent).toBe("Skipped: 1");
    expect(screen.getByTestId("bulk-result-error").textContent).toBe("No access");
    expect(isChecked("row-r3-select")).toBe(true);
    expect(isChecked("row-r1-select")).toBe(false);
    expect(isChecked("row-r2-select")).toBe(false);
  });

  test("Space on a focused row toggles its selection when keyboard navigation is on", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        view={keyboardView}
        bulk={bulkOf(archiveAction())}
      />,
    );
    const row = screen.getByTestId("row-r2");
    row.focus();
    const notPrevented = fireEvent.keyDown(row, { key: " " });
    expect(notPrevented).toBe(false);
    expect(isChecked("row-r2-select")).toBe(true);
    fireEvent.keyDown(row, { key: " " });
    expect(isChecked("row-r2-select")).toBe(false);
  });
});
