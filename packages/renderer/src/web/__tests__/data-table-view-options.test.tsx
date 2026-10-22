import { describe, expect, mock, test } from "bun:test";
import type { DataTableViewOptions } from "../../data-table-view-types.ts";
import { DataTable } from "./_primitives-helpers.tsx";
import { fireEvent, render, screen, within } from "./test-utils.tsx";

const columns = [
  { field: "name", label: "Name", type: "string" as const, sortable: false },
  { field: "city", label: "City", type: "string" as const, sortable: false },
  { field: "age", label: "Age", type: "number" as const, sortable: false },
];
const rows = [{ id: "r1", values: { name: "Ada", city: "Wien", age: 36 } }];

function view(overrides: Partial<DataTableViewOptions> = {}): DataTableViewOptions {
  return {
    columns: [
      { field: "name", visible: true },
      { field: "city", visible: true },
      { field: "age", visible: true },
    ],
    onColumnsChange: () => {},
    density: "comfortable",
    onDensityChange: () => {},
    viewIsDefault: true,
    onViewReset: () => {},
    ...overrides,
  };
}

function headerFields(): string[] {
  return Array.from(document.querySelectorAll("th[data-testid^='column-']"))
    .map((th) => th.getAttribute("data-testid")?.replace("column-", "") ?? "")
    .filter((field) => columns.some((c) => c.field === field));
}

function withWidth(width: number, run: () => void): void {
  const happy = (window as unknown as { happyDOM: { setInnerWidth: (n: number) => void } })
    .happyDOM;
  const original = window.innerWidth;
  happy.setInnerWidth(width);
  try {
    run();
  } finally {
    happy.setInnerWidth(original);
  }
}

describe("DataTable view options", () => {
  test("hidden columns disappear and the saved order applies in the table layout", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        view={view({
          columns: [
            { field: "age", visible: true },
            { field: "city", visible: false },
            { field: "name", visible: true },
          ],
        })}
      />,
    );
    expect(headerFields()).toEqual(["age", "name"]);
    expect(screen.queryByTestId("cell-r1-city")).toBeNull();
  });

  test("below md visibility applies but the order does not", () => {
    withWidth(500, () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          testId="t"
          view={view({
            columns: [
              { field: "age", visible: true },
              { field: "city", visible: false },
              { field: "name", visible: true },
            ],
          })}
        />,
      );
      expect(screen.queryByTestId("cell-r1-city")).toBeNull();
      const title = screen.getByTestId("cell-r1-name");
      expect(title.className).toContain("font-semibold");
    });
  });

  test("compact density shrinks the row, comfortable and no view add nothing", () => {
    const { unmount } = render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        scrollBody
        view={view({ density: "compact" })}
      />,
    );
    expect(screen.getByTestId("row-r1").className).toContain("h-8");
    expect(screen.getByTestId("row-r1").className).not.toContain("h-10");
    unmount();
    render(<DataTable columns={columns} rows={rows} testId="t" scrollBody view={view()} />);
    expect(screen.getByTestId("row-r1").className).toContain("h-10");
  });

  test("the view menu toggles a column and keeps the last visible one", () => {
    const onColumnsChange = mock();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        view={view({
          onColumnsChange,
          columns: [
            { field: "name", visible: true },
            { field: "city", visible: false },
            { field: "age", visible: false },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByTestId("list-view-menu"));
    const panel = within(screen.getByTestId("list-view-menu-content"));
    const checkboxes = panel.getAllByRole("checkbox");
    expect(
      checkboxes[0]?.hasAttribute("disabled") ||
        checkboxes[0]?.getAttribute("aria-disabled") === "true" ||
        checkboxes[0]?.getAttribute("data-disabled") !== null,
    ).toBe(true);
    fireEvent.click(checkboxes[1] as HTMLElement);
    expect(onColumnsChange).toHaveBeenCalledWith([
      { field: "name", visible: true },
      { field: "city", visible: true },
      { field: "age", visible: false },
    ]);
  });

  test("move buttons reorder columns", () => {
    const onColumnsChange = mock();
    render(<DataTable columns={columns} rows={rows} testId="t" view={view({ onColumnsChange })} />);
    fireEvent.click(screen.getByTestId("list-view-menu"));
    fireEvent.click(screen.getByLabelText("Move Name down"));
    expect(onColumnsChange).toHaveBeenCalledWith([
      { field: "city", visible: true },
      { field: "name", visible: true },
      { field: "age", visible: true },
    ]);
  });

  test("resetAll replaces the facet reset", () => {
    const onReset = mock();
    const facet = { field: "status", label: "Status", options: [{ value: "open", label: "Open" }] };
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        filterFacets={[facet]}
        filterValues={{ status: ["open"] }}
        onFilterChange={() => {}}
        onFilterReset={() => {}}
        resetAll={{ active: true, onReset }}
      />,
    );
    expect(screen.queryByTestId("facet-reset")).toBeNull();
    fireEvent.click(screen.getByTestId("list-reset-all"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test("resetAll shows without facets while something deviates and hides at the default", () => {
    const { unmount } = render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        resetAll={{ active: true, onReset: () => {} }}
      />,
    );
    expect(screen.getByTestId("list-reset-all")).not.toBeNull();
    unmount();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        resetAll={{ active: false, onReset: () => {} }}
      />,
    );
    expect(screen.queryByTestId("list-reset-all")).toBeNull();
  });
});
