import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { DataTableViewOptions } from "../../data-table-view-types.ts";
import { DataTable } from "./_primitives-helpers.tsx";
import { fireEvent, render, screen } from "./test-utils.tsx";

const columns = [
  { field: "name", label: "Name", type: "string" as const, sortable: true },
  { field: "city", label: "City", type: "string" as const, sortable: false },
  { field: "age", label: "Age", type: "number" as const, sortable: false },
];
const rows = [
  { id: "r1", values: { name: "Ada", city: "Wien", age: 36 } },
  { id: "r2", values: { name: "Bob", city: "Graz", age: 41 } },
  { id: "r3", values: { name: "Cy", city: "Linz", age: 29 } },
];
const actions = [{ id: "open", label: "Open", onTrigger: () => {} }];

function view(overrides: Partial<DataTableViewOptions> = {}): DataTableViewOptions {
  return { density: "comfortable", viewIsDefault: true, onViewReset: () => {}, ...overrides };
}

function headerFields(): string[] {
  return Array.from(document.querySelectorAll("th[data-testid^='column-']")).map(
    (th) => th.getAttribute("data-testid")?.replace("column-", "") ?? "",
  );
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

const sizing = {
  widths: { name: 200, city: 150, age: 100 },
  minWidths: { name: 120, city: 100, age: 80 },
};

describe("DataTable column pinning", () => {
  test("left pins move to the front, right pins behind the data columns, all sticky", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        rowActions={actions}
        view={view({ pins: { age: "left", name: "right" }, onPinsChange: () => {} })}
      />,
    );
    expect(headerFields()).toEqual(["age", "city", "name", "actions"]);
    expect(screen.getByTestId("column-age").style.position).toBe("sticky");
    expect(screen.getByTestId("column-age").style.left).toBe("0px");
    expect(screen.getByTestId("column-name").style.right).toBe("0px");
    expect(screen.getByTestId("cell-r1-age").style.position).toBe("sticky");
    expect(screen.getByTestId("column-city").style.position).toBe("");
  });

  test("header sits above pins, pins above the actions column", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        rowActions={actions}
        view={view({ pins: { name: "left" }, onPinsChange: () => {} })}
      />,
    );
    expect(screen.getByTestId("column-name").style.zIndex).toBe("40");
    expect(screen.getByTestId("column-city").style.zIndex).toBe("30");
    expect(screen.getByTestId("column-actions").style.zIndex).toBe("30");
    expect(screen.getByTestId("cell-r1-name").style.zIndex).toBe("20");
  });

  test("without pins there are no sticky styles and no column-field attribute", () => {
    render(<DataTable columns={columns} rows={rows} testId="t" view={view()} />);
    expect(document.querySelector("[data-column-field]")).toBeNull();
    expect(screen.getByTestId("column-name").getAttribute("style")).toBeNull();
    expect(screen.getByTestId("cell-r1-name").getAttribute("style")).toBeNull();
  });

  test("the view menu pins a column and a second click on the same side releases it", () => {
    const onPinsChange = mock((_next: Record<string, string>) => {});
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        view={view({ pins: { city: "right" }, onPinsChange })}
      />,
    );
    fireEvent.click(screen.getByTestId("list-view-menu"));
    fireEvent.click(screen.getByTestId("list-view-pin-name-left"));
    expect(onPinsChange).toHaveBeenLastCalledWith({ city: "right", name: "left" });
    fireEvent.click(screen.getByTestId("list-view-pin-city-right"));
    expect(onPinsChange).toHaveBeenLastCalledWith({});
    expect(screen.getByTestId("list-view-pin-city-right").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  test("below md pins have no effect", () => {
    withWidth(500, () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          testId="t"
          view={view({ pins: { age: "left" }, onPinsChange: () => {} })}
        />,
      );
      expect(document.querySelector("[style*='sticky']")).toBeNull();
    });
  });
});

describe("DataTable totals row under pinned columns", () => {
  test("the leading select cell of the totals row sticks with the pinned select column", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        rowActions={actions}
        bulk={{ actions: [], reload: async () => {} }}
        totals={{ measures: [{ field: "age", kind: "sum", value: 106 }] }}
        view={view({ pins: { name: "left" }, onPinsChange: () => {} })}
      />,
    );
    const bodySelectCell = screen.getByTestId("row-r1-select").closest("td");
    const totalsSelectCell = screen.getByTestId("list-totals-__select");
    expect(bodySelectCell?.style.position).toBe("sticky");
    expect(totalsSelectCell.style.position).toBe("sticky");
    expect(totalsSelectCell.style.left).toBe(bodySelectCell?.style.left ?? "");
    expect(screen.getByTestId("list-totals-age").textContent).toContain("106");
  });
});

describe("DataTable right pin next to the actions column", () => {
  afterEach(() => mock.restore());

  function measureHeaderWidths(widths: Record<string, number>): void {
    spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const width = widths[this.getAttribute("data-testid") ?? ""] ?? 0;
      return new DOMRect(0, 0, width, 0);
    });
  }

  test("the actions column stays outermost, the right pin sits beside it, layers stack header > pin > actions > cells", () => {
    measureHeaderWidths({ "column-actions": 90, "column-name": 200 });
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        rowActions={actions}
        view={view({ pins: { age: "right" }, onPinsChange: () => {} })}
      />,
    );
    const actionsHeader = screen.getByTestId("column-actions");
    const actionsCell = screen.getByTestId("cell-r1-actions");
    expect(actionsHeader.className).toContain("md:right-0");
    expect(actionsCell.className).toContain("md:right-0");
    expect(screen.getByTestId("column-age").style.right).toBe("90px");
    expect(screen.getByTestId("cell-r1-age").style.right).toBe("90px");

    const pinnedBody = Number(screen.getByTestId("cell-r1-age").style.zIndex);
    expect(Number(screen.getByTestId("column-age").style.zIndex)).toBeGreaterThan(pinnedBody);
    expect(pinnedBody).toBeGreaterThan(10);
    expect(actionsCell.className).toContain("md:z-10");
    expect(actionsHeader.style.zIndex).toBe("30");
    expect(screen.getByTestId("cell-r1-name").style.zIndex).toBe("");
  });
});

describe("DataTable column resizing", () => {
  test("widths switch to a fixed layout with a colgroup, without widths the table stays auto", () => {
    const { unmount } = render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        view={view({ ...sizing, onWidthChange: () => {} })}
      />,
    );
    const table = screen.getByTestId("t");
    expect(table.style.tableLayout).toBe("fixed");
    expect(table.querySelectorAll("colgroup > col").length).toBe(3);
    unmount();
    render(<DataTable columns={columns} rows={rows} testId="t" view={view()} />);
    expect(screen.getByTestId("t").querySelector("colgroup")).toBeNull();
    expect(screen.getByTestId("t").style.tableLayout).toBe("");
  });

  test("without a chosen width the table stays auto and sizes by content, the first column unbounded", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        onRowClick={() => {}}
        view={view({ widths: {}, minWidths: sizing.minWidths, onWidthChange: () => {} })}
      />,
    );
    const table = screen.getByTestId("t");
    expect(table.style.tableLayout).toBe("");
    expect(table.querySelector("colgroup")).toBeNull();
    expect(screen.getByTestId("column-resize-name")).toBeTruthy();
    const firstCell = screen.getByTestId("cell-r1-name").className.split(/\s+/);
    expect(firstCell).toContain("[overflow-wrap:anywhere]");
    expect(firstCell).not.toContain("max-w-xs");
    expect(screen.getByTestId("cell-r1-city").className.split(/\s+/)).toContain("max-w-xs");
    expect(screen.getByRole("button", { name: "Ada" }).className).not.toContain("truncate");
  });

  test("the first resize hands over the displayed widths of the other columns", () => {
    const onWidthChange = mock(
      (_field: string, _width: number, _others?: Readonly<Record<string, number>>) => {},
    );
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        view={view({ widths: { age: 100 }, minWidths: sizing.minWidths, onWidthChange })}
      />,
    );
    // happy-dom lays nothing out, so the displayed width falls back to the default start width.
    expect(screen.getByTestId("t").style.tableLayout).toBe("fixed");
    fireEvent.keyDown(screen.getByTestId("column-resize-name"), { key: "ArrowRight" });
    expect(onWidthChange).toHaveBeenLastCalledWith("name", 176, { city: 160 });
  });

  test("arrow keys on the handle resize by 16px and clamp at the minimum width", () => {
    const onWidthChange = mock((_field: string, _width: number) => {});
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        view={view({ ...sizing, onWidthChange })}
      />,
    );
    const handle = screen.getByTestId("column-resize-name");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onWidthChange).toHaveBeenLastCalledWith("name", 216, {});
    const narrow = screen.getByTestId("column-resize-age");
    fireEvent.keyDown(narrow, { key: "ArrowLeft" });
    fireEvent.keyDown(narrow, { key: "ArrowLeft", shiftKey: true });
    expect(onWidthChange).toHaveBeenLastCalledWith("age", 80, {});
  });

  test("the handle is a focusable separator with a value range and sits beside the sort button", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        onSortChange={() => {}}
        view={view({ ...sizing, onWidthChange: () => {} })}
      />,
    );
    const handle = screen.getByTestId("column-resize-name");
    expect(handle.tagName).toBe("HR");
    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute("aria-valuenow")).toBe("200");
    expect(handle.getAttribute("aria-valuemin")).toBe("120");
    expect(handle.getAttribute("aria-valuemax")).toBe("2000");
    expect(handle.closest("button")).toBeNull();
  });

  test("the arrow keys stop at the maximum width", () => {
    const onWidthChange = mock((_field: string, _width: number) => {});
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        view={view({
          widths: { ...sizing.widths, name: 1990 },
          minWidths: sizing.minWidths,
          onWidthChange,
        })}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("column-resize-name"), { key: "ArrowRight" });
    expect(onWidthChange).toHaveBeenLastCalledWith("name", 2000, {});
  });

  test("clicking the handle does not sort", () => {
    const onSortChange = mock(() => {});
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        onSortChange={onSortChange}
        view={view({ ...sizing, onWidthChange: () => {} })}
      />,
    );
    fireEvent.click(screen.getByTestId("column-resize-name"));
    expect(onSortChange).not.toHaveBeenCalled();
  });

  test("below md there is no handle and no fixed layout", () => {
    withWidth(500, () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          testId="t"
          view={view({ ...sizing, onWidthChange: () => {} })}
        />,
      );
      expect(screen.queryByTestId("column-resize-name")).toBeNull();
    });
  });
});

describe("DataTable keyboard navigation", () => {
  function rowEl(id: string): HTMLElement {
    return screen.getByTestId(`row-${id}`);
  }

  test("exactly one row is a tab stop; arrows, Home and End move focus and the tab stop", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        onRowClick={() => {}}
        view={view({ keyboardNavigation: true })}
      />,
    );
    expect(rowEl("r1").tabIndex).toBe(0);
    expect(rowEl("r2").tabIndex).toBe(-1);
    rowEl("r1").focus();
    fireEvent.keyDown(rowEl("r1"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(rowEl("r2"));
    expect(rowEl("r2").tabIndex).toBe(0);
    expect(rowEl("r1").tabIndex).toBe(-1);
    fireEvent.keyDown(rowEl("r2"), { key: "End" });
    expect(document.activeElement).toBe(rowEl("r3"));
    fireEvent.keyDown(rowEl("r3"), { key: "Home" });
    expect(document.activeElement).toBe(rowEl("r1"));
  });

  test("Enter opens a clickable row, Space is left alone, keys from a child are ignored", () => {
    const onRowClick = mock((_row: unknown) => {});
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        onRowClick={onRowClick}
        view={view({ keyboardNavigation: true })}
      />,
    );
    rowEl("r1").focus();
    const space = fireEvent.keyDown(rowEl("r1"), { key: " " });
    expect(space).toBe(true);
    fireEvent.keyDown(rowEl("r1"), { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByTestId("cell-r1-city"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(rowEl("r1"));
  });

  test("pinned and actions cells repeat the focus ring because they paint over the row outline", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        rowActions={actions}
        view={view({
          keyboardNavigation: true,
          pins: { name: "left" },
          onPinsChange: () => {},
        })}
      />,
    );
    expect(rowEl("r1").className).toContain("group/row");
    for (const id of ["cell-r1-name", "cell-r1-actions"]) {
      expect(screen.getByTestId(id).className).toContain(
        "group-focus-visible/row:after:border-ring",
      );
    }
  });

  test("without keyboardNavigation or below md rows carry no tabindex", () => {
    const { unmount } = render(
      <DataTable columns={columns} rows={rows} testId="t" view={view()} />,
    );
    expect(rowEl("r1").getAttribute("tabindex")).toBeNull();
    unmount();
    withWidth(500, () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          testId="t"
          view={view({ keyboardNavigation: true })}
        />,
      );
      expect(document.querySelector("[data-keyboard-row]")).toBeNull();
    });
  });
});
