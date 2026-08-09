// embedded-list-input Tests — happy-dom + @testing-library/react. Every
// test interacts with the rendered DOM (click/type/paste) and asserts on
// the outcome; none merely check that the component mounts.

import { describe, expect, mock, test } from "bun:test";
import type { FieldIssue } from "@cosmicdrift/kumiko-headless";
import type { EmbeddedListColumn, EmbeddedListInputProps } from "@cosmicdrift/kumiko-renderer";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
} from "@cosmicdrift/kumiko-renderer";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { type ReactElement, useState } from "react";
import { EmbeddedListInput } from "../embedded-list-input";

function renderWithLocale(ui: ReactElement) {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver()}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      {ui}
    </LocaleProvider>,
  );
}

const COLUMNS: readonly EmbeddedListColumn[] = [
  { field: "description", label: "Description", type: "text", required: true, derived: false },
  { field: "quantity", label: "Qty", type: "number", required: true, derived: false },
  {
    field: "amount",
    label: "Amount",
    type: "money",
    required: false,
    derived: true,
  },
];

const LABELS = {
  addLabel: "Add row",
  removeLabel: "Remove row",
  duplicateLabel: "Duplicate row",
  moveUpLabel: "Move up",
  moveDownLabel: "Move down",
  emptyLabel: "No lines yet",
  emptyCtaLabel: "Add first line",
};

function baseProps(overrides: Partial<EmbeddedListInputProps> = {}): EmbeddedListInputProps {
  return {
    id: "lines",
    columns: COLUMNS,
    rows: [],
    onCellChange: () => {},
    onAddRow: () => {},
    onRemoveRow: () => {},
    onDuplicateRow: () => {},
    onMoveRow: () => {},
    testId: "lines",
    ...LABELS,
    ...overrides,
  };
}

// A real onAddRow that appends a row via useState, wired to the same
// pendingFocusCellId batching #1839 relies on — a mock onAddRow that
// never actually grows `rows` can't reproduce the auto-focus effect,
// since it targets a cell in a row that doesn't exist yet.
function ControlledFocusHarness({
  columns,
  initialRows,
}: {
  readonly columns: readonly EmbeddedListColumn[];
  readonly initialRows: ReadonlyArray<Record<string, unknown>>;
}) {
  const [rows, setRows] = useState(initialRows);
  return (
    <EmbeddedListInput
      {...baseProps({
        columns,
        rows,
        onAddRow: () => setRows((current) => [...current, {}]),
      })}
    />
  );
}

describe("EmbeddedListInput — header + rows", () => {
  test("renders one header cell per column and one row per data row, with values", () => {
    const rows = [
      { description: "Widget A", quantity: 2, amount: 1000 },
      { description: "Widget B", quantity: 5, amount: 2500 },
    ];
    renderWithLocale(<EmbeddedListInput {...baseProps({ rows })} />);
    const desktop = within(screen.getByTestId("lines-desktop"));
    expect(desktop.getByText("Description")).toBeTruthy();
    expect(desktop.getByText("Qty")).toBeTruthy();
    expect(desktop.getByText("Amount")).toBeTruthy();

    const row0 = within(desktop.getByTestId("lines-row-0"));
    expect((row0.getByDisplayValue("Widget A") as HTMLInputElement).value).toBe("Widget A");
    expect((row0.getByDisplayValue("2") as HTMLInputElement).value).toBe("2");

    const row1 = within(desktop.getByTestId("lines-row-1"));
    expect((row1.getByDisplayValue("Widget B") as HTMLInputElement).value).toBe("Widget B");
  });
});

describe("EmbeddedListInput — desktop/mobile are mutually exclusive mounts (#1854)", () => {
  const rows = [{ description: "Widget A", quantity: 2, amount: 1000 }];

  test("desktop viewport mounts only the table, not the card layout", () => {
    renderWithLocale(<EmbeddedListInput {...baseProps({ rows })} />);
    expect(screen.getByTestId("lines-desktop")).toBeTruthy();
    expect(screen.queryByTestId("lines-mobile")).toBeNull();
    expect(document.querySelectorAll('[data-cell-id="lines-0-amount"]').length).toBe(1);
  });

  test("mobile viewport mounts only the card layout, not the table", () => {
    const originalWidth = window.innerWidth;
    window.innerWidth = 500;
    try {
      renderWithLocale(<EmbeddedListInput {...baseProps({ rows })} />);
      expect(screen.getByTestId("lines-mobile")).toBeTruthy();
      expect(screen.queryByTestId("lines-desktop")).toBeNull();
      expect(document.querySelectorAll('[data-cell-id="lines-0-amount"]').length).toBe(1);
    } finally {
      window.innerWidth = originalWidth;
    }
  });
});

describe("EmbeddedListInput — row mutation callbacks", () => {
  const rows = [
    { description: "A", quantity: 1, amount: 100 },
    { description: "B", quantity: 2, amount: 200 },
    { description: "C", quantity: 3, amount: 300 },
  ];

  test("duplicate/remove/move fire with the clicked row's index", () => {
    const onDuplicateRow = mock((_i: number) => {});
    const onRemoveRow = mock((_i: number) => {});
    const onMoveRow = mock((_from: number, _to: number) => {});
    renderWithLocale(
      <EmbeddedListInput {...baseProps({ rows, onDuplicateRow, onRemoveRow, onMoveRow })} />,
    );
    const desktop = within(screen.getByTestId("lines-desktop"));

    fireEvent.click(desktop.getByTestId("lines-row-1-duplicate"));
    expect(onDuplicateRow).toHaveBeenLastCalledWith(1);

    fireEvent.click(desktop.getByTestId("lines-row-1-move-up"));
    expect(onMoveRow).toHaveBeenLastCalledWith(1, 0);

    fireEvent.click(desktop.getByTestId("lines-row-1-move-down"));
    expect(onMoveRow).toHaveBeenLastCalledWith(1, 2);

    fireEvent.click(desktop.getByTestId("lines-row-1-remove"));
    expect(onRemoveRow).toHaveBeenLastCalledWith(1);
  });

  test("onCellChange fires with rowIndex/field/value on edit", () => {
    const onCellChange = mock((_r: number, _f: string, _v: unknown) => {});
    renderWithLocale(<EmbeddedListInput {...baseProps({ rows, onCellChange })} />);
    const desktop = within(screen.getByTestId("lines-desktop"));
    const input = within(desktop.getByTestId("lines-row-0")).getByDisplayValue("A");
    fireEvent.change(input, { target: { value: "Updated" } });
    expect(onCellChange).toHaveBeenCalledWith(0, "description", "Updated");
  });
});

describe("EmbeddedListInput — min/max item limits", () => {
  const rows = [
    { description: "A", quantity: 1, amount: 100 },
    { description: "B", quantity: 2, amount: 200 },
  ];

  test("add row is disabled once maxItems is reached", () => {
    renderWithLocale(<EmbeddedListInput {...baseProps({ rows, maxItems: 2 })} />);
    const desktop = within(screen.getByTestId("lines-desktop"));
    expect((desktop.getByTestId("lines-add") as HTMLButtonElement).disabled).toBe(true);
  });

  test("add row stays enabled below maxItems", () => {
    renderWithLocale(<EmbeddedListInput {...baseProps({ rows, maxItems: 5 })} />);
    const desktop = within(screen.getByTestId("lines-desktop"));
    expect((desktop.getByTestId("lines-add") as HTMLButtonElement).disabled).toBe(false);
  });

  test("remove is disabled once row count would drop below minItems", () => {
    renderWithLocale(<EmbeddedListInput {...baseProps({ rows, minItems: 2 })} />);
    const desktop = within(screen.getByTestId("lines-desktop"));
    expect((desktop.getByTestId("lines-row-0-remove") as HTMLButtonElement).disabled).toBe(true);
  });

  test("remove stays enabled above minItems", () => {
    renderWithLocale(<EmbeddedListInput {...baseProps({ rows, minItems: 1 })} />);
    const desktop = within(screen.getByTestId("lines-desktop"));
    expect((desktop.getByTestId("lines-row-0-remove") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("EmbeddedListInput — derived cells", () => {
  test("a derived column renders its cell disabled", () => {
    const rows = [{ description: "A", quantity: 1, amount: 100 }];
    renderWithLocale(<EmbeddedListInput {...baseProps({ rows })} />);
    const desktop = within(screen.getByTestId("lines-desktop"));
    const amountCell = desktop.getByTestId("lines-cell-0-amount");
    const input = amountCell.querySelector("input");
    if (input === null) throw new Error("expected an <input> inside the amount cell");
    expect(input.disabled).toBe(true);
  });
});

describe("EmbeddedListInput — issue rendering", () => {
  function issue(path: string, message: string): FieldIssue {
    return { path, code: "custom", i18nKey: message };
  }

  test("cellIssues render under the matching cell", () => {
    const rows = [{ description: "A", quantity: 1, amount: 100 }];
    renderWithLocale(
      <EmbeddedListInput
        {...baseProps({
          rows,
          cellIssues: { "0.description": [issue("lines.0.description", "Required")] },
        })}
      />,
    );
    const desktop = within(screen.getByTestId("lines-desktop"));
    expect(
      within(desktop.getByTestId("lines-cell-0-description-errors")).getByText("Required"),
    ).toBeTruthy();
  });

  test("rowIssues render under the matching row", () => {
    const rows = [{ description: "A", quantity: 1, amount: 100 }];
    renderWithLocale(
      <EmbeddedListInput
        {...baseProps({
          rows,
          rowIssues: { 0: [issue("lines.0", "Row incomplete")] },
        })}
      />,
    );
    const desktop = within(screen.getByTestId("lines-desktop"));
    expect(
      within(desktop.getByTestId("lines-row-0-issues")).getByText("Row incomplete"),
    ).toBeTruthy();
  });

  test("listIssues render at the list level", () => {
    const rows = [{ description: "A", quantity: 1, amount: 100 }];
    renderWithLocale(
      <EmbeddedListInput
        {...baseProps({
          rows,
          listIssues: [issue("lines", "Too few lines")],
        })}
      />,
    );
    const desktop = within(screen.getByTestId("lines-desktop"));
    expect(
      within(desktop.getByTestId("lines-list-issues")).getByText("Too few lines"),
    ).toBeTruthy();
  });
});

describe("EmbeddedListInput — empty state", () => {
  test("shows emptyLabel + CTA button, click fires onAddRow", () => {
    const onAddRow = mock(() => {});
    renderWithLocale(<EmbeddedListInput {...baseProps({ rows: [], onAddRow })} />);
    expect(screen.getByText("No lines yet")).toBeTruthy();
    const cta = screen.getByTestId("lines-empty-add");
    expect(within(cta).getByText("Add first line")).toBeTruthy();
    fireEvent.click(cta);
    expect(onAddRow).toHaveBeenCalledTimes(1);
  });
});

describe("EmbeddedListInput — totals", () => {
  test("renders each total's label and value", () => {
    const rows = [{ description: "A", quantity: 1, amount: 1234 }];
    renderWithLocale(
      <EmbeddedListInput
        {...baseProps({
          rows,
          totals: [{ field: "amount", label: "Grand total", value: 1234 }],
        })}
      />,
    );
    const desktop = within(screen.getByTestId("lines-desktop"));
    const totals = desktop.getByTestId("lines-totals");
    expect(within(totals).getByText("Grand total")).toBeTruthy();
    // Money total formats via Intl.NumberFormat (EUR) — assert the digits
    // it must contain rather than pinning the exact locale/space glyphs.
    expect(totals.textContent).toContain("12");
    expect(totals.textContent).toContain("34");
  });

  test("a plain number total renders as a locale-formatted number", () => {
    const rows = [{ description: "A", quantity: 7, amount: 100 }];
    renderWithLocale(
      <EmbeddedListInput
        {...baseProps({
          rows,
          columns: [
            {
              field: "description",
              label: "Description",
              type: "text",
              required: true,
              derived: false,
            },
            { field: "quantity", label: "Qty", type: "number", required: true, derived: false },
          ],
          totals: [{ field: "quantity", label: "Total qty", value: 7 }],
        })}
      />,
    );
    const desktop = within(screen.getByTestId("lines-desktop"));
    const totals = desktop.getByTestId("lines-totals");
    expect(within(totals).getByText("7")).toBeTruthy();
  });
});

describe("EmbeddedListInput — tab-to-add-row", () => {
  test("Tab on the last cell of the last row (no maxItems limit) fires onAddRow and prevents default", () => {
    const rows = [{ description: "A", quantity: 1, amount: 100 }];
    const onAddRow = mock(() => {});
    renderWithLocale(<EmbeddedListInput {...baseProps({ rows, onAddRow })} />);
    const desktop = within(screen.getByTestId("lines-desktop"));
    const lastCell = desktop.getByTestId("lines-cell-0-amount");
    const input = lastCell.querySelector("input");
    if (input === null) throw new Error("expected an <input> inside the last cell");

    // fireEvent returns false when the event's default was prevented —
    // same return-value convention as native dispatchEvent.
    const notPrevented = fireEvent.keyDown(input, { key: "Tab", code: "Tab" });
    expect(onAddRow).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });

  test("Tab does not fire onAddRow once maxItems is reached", () => {
    const rows = [{ description: "A", quantity: 1, amount: 100 }];
    const onAddRow = mock(() => {});
    renderWithLocale(<EmbeddedListInput {...baseProps({ rows, onAddRow, maxItems: 1 })} />);
    const desktop = within(screen.getByTestId("lines-desktop"));
    const lastCell = desktop.getByTestId("lines-cell-0-amount");
    const input = lastCell.querySelector("input");
    if (input === null) throw new Error("expected an <input> inside the last cell");

    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });
    expect(onAddRow).not.toHaveBeenCalled();
  });
});

describe("EmbeddedListInput — paste", () => {
  test("a two-row, two-column tab-separated paste fires onPasteCells with the parsed grid", () => {
    const rows = [{ description: "A", quantity: 1, amount: 100 }];
    const onPasteCells = mock(
      (_r: number, _c: number, _grid: readonly (readonly string[])[]) => {},
    );
    renderWithLocale(<EmbeddedListInput {...baseProps({ rows, onPasteCells })} />);
    const desktop = within(screen.getByTestId("lines-desktop"));
    const cell = desktop.getByTestId("lines-cell-0-description");
    const input = cell.querySelector("input");
    if (input === null) throw new Error("expected an <input> inside the cell");

    const clipboardData = {
      getData: (format: string) => (format === "text" ? "Widget\t5\nGadget\t9" : ""),
    };
    fireEvent.paste(input, { clipboardData });

    expect(onPasteCells).toHaveBeenCalledTimes(1);
    const [rowIndex, columnIndex, grid] = onPasteCells.mock.calls[0] as [
      number,
      number,
      readonly (readonly string[])[],
    ];
    expect(rowIndex).toBe(0);
    expect(columnIndex).toBe(0);
    expect(grid).toEqual([
      ["Widget", "5"],
      ["Gadget", "9"],
    ]);
  });

  test("a single-value paste does not call onPasteCells", () => {
    const rows = [{ description: "A", quantity: 1, amount: 100 }];
    const onPasteCells = mock(
      (_r: number, _c: number, _grid: readonly (readonly string[])[]) => {},
    );
    renderWithLocale(<EmbeddedListInput {...baseProps({ rows, onPasteCells })} />);
    const desktop = within(screen.getByTestId("lines-desktop"));
    const cell = desktop.getByTestId("lines-cell-0-description");
    const input = cell.querySelector("input");
    if (input === null) throw new Error("expected an <input> inside the cell");

    const clipboardData = { getData: (format: string) => (format === "text" ? "Solo" : "") };
    fireEvent.paste(input, { clipboardData });
    expect(onPasteCells).not.toHaveBeenCalled();
  });
});

describe("EmbeddedListInput — Enter-to-add-row (#1839)", () => {
  test("Enter on the last cell of the last row fires onAddRow and prevents default, same as Tab", () => {
    const rows = [{ description: "A", quantity: 1, amount: 100 }];
    const onAddRow = mock(() => {});
    renderWithLocale(<EmbeddedListInput {...baseProps({ rows, onAddRow })} />);
    const desktop = within(screen.getByTestId("lines-desktop"));
    const lastCell = desktop.getByTestId("lines-cell-0-amount");
    const input = lastCell.querySelector("input");
    if (input === null) throw new Error("expected an <input> inside the last cell");

    const notPrevented = fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(onAddRow).toHaveBeenCalledTimes(1);
    // false = event.preventDefault() was called — same convention the
    // existing Tab test relies on. A form wrapping this field must not see
    // Enter as a submit trigger.
    expect(notPrevented).toBe(false);
  });

  test("Enter does not fire onAddRow once maxItems is reached", () => {
    const rows = [{ description: "A", quantity: 1, amount: 100 }];
    const onAddRow = mock(() => {});
    renderWithLocale(<EmbeddedListInput {...baseProps({ rows, onAddRow, maxItems: 1 })} />);
    const desktop = within(screen.getByTestId("lines-desktop"));
    const lastCell = desktop.getByTestId("lines-cell-0-amount");
    const input = lastCell.querySelector("input");
    if (input === null) throw new Error("expected an <input> inside the last cell");

    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(onAddRow).not.toHaveBeenCalled();
  });
});

describe("EmbeddedListInput — auto-focus into wrapped cell types (#1839)", () => {
  test("a date first-column focuses the inner DateField input, not the wrapper div", () => {
    const columns: readonly EmbeddedListColumn[] = [
      { field: "due", label: "Due", type: "date", required: false, derived: false },
      { field: "desc", label: "Desc", type: "text", required: false, derived: false },
    ];
    renderWithLocale(
      <ControlledFocusHarness columns={columns} initialRows={[{ due: "", desc: "x" }]} />,
    );
    const desktop = within(screen.getByTestId("lines-desktop"));
    const lastInput = desktop.getByTestId("lines-cell-0-desc").querySelector("input");
    if (lastInput === null) throw new Error("expected an <input> in the last cell");
    fireEvent.keyDown(lastInput, { key: "Tab", code: "Tab" });

    const newDueCell = desktop.getByTestId("lines-cell-1-due");
    expect(newDueCell.tagName).not.toBe("INPUT");
    const focusable = newDueCell.querySelector("input");
    expect(focusable).not.toBeNull();
    expect(document.activeElement).toBe(focusable);
  });

  test("a timestamp first-column focuses the inner TimestampInput date field, not the wrapper div (#1839)", () => {
    const columns: readonly EmbeddedListColumn[] = [
      { field: "loggedAt", label: "Logged at", type: "timestamp", required: false, derived: false },
      { field: "desc", label: "Desc", type: "text", required: false, derived: false },
    ];
    renderWithLocale(
      <ControlledFocusHarness columns={columns} initialRows={[{ loggedAt: "", desc: "x" }]} />,
    );
    const desktop = within(screen.getByTestId("lines-desktop"));
    const lastInput = desktop.getByTestId("lines-cell-0-desc").querySelector("input");
    if (lastInput === null) throw new Error("expected an <input> in the last cell");
    fireEvent.keyDown(lastInput, { key: "Tab", code: "Tab" });

    const newLoggedAtCell = desktop.getByTestId("lines-cell-1-loggedAt");
    expect(newLoggedAtCell.tagName).not.toBe("INPUT");
    const focusable = newLoggedAtCell.querySelector("input");
    expect(focusable).not.toBeNull();
    expect(document.activeElement).toBe(focusable);
  });

  test("a money first-column focuses the inner MoneyInput input, not the wrapper div", () => {
    const columns: readonly EmbeddedListColumn[] = [
      { field: "amount", label: "Amount", type: "money", required: false, derived: false },
      { field: "desc", label: "Desc", type: "text", required: false, derived: false },
    ];
    renderWithLocale(
      <ControlledFocusHarness columns={columns} initialRows={[{ amount: 0, desc: "x" }]} />,
    );
    const desktop = within(screen.getByTestId("lines-desktop"));
    const lastInput = desktop.getByTestId("lines-cell-0-desc").querySelector("input");
    if (lastInput === null) throw new Error("expected an <input> in the last cell");
    fireEvent.keyDown(lastInput, { key: "Tab", code: "Tab" });

    const newAmountCell = desktop.getByTestId("lines-cell-1-amount");
    const focusable = newAmountCell.querySelector("input");
    expect(focusable).not.toBeNull();
    expect(document.activeElement).toBe(focusable);
  });

  test("a select first-column focuses the combobox trigger button, not the hidden name-input or the wrapper div", () => {
    const columns: readonly EmbeddedListColumn[] = [
      {
        field: "unit",
        label: "Unit",
        type: "select",
        required: false,
        derived: false,
        options: ["hour", "day"],
      },
      { field: "desc", label: "Desc", type: "text", required: false, derived: false },
    ];
    renderWithLocale(
      <ControlledFocusHarness columns={columns} initialRows={[{ unit: "hour", desc: "x" }]} />,
    );
    const desktop = within(screen.getByTestId("lines-desktop"));
    const lastInput = desktop.getByTestId("lines-cell-0-desc").querySelector("input");
    if (lastInput === null) throw new Error("expected an <input> in the last cell");
    fireEvent.keyDown(lastInput, { key: "Tab", code: "Tab" });

    const newUnitCell = desktop.getByTestId("lines-cell-1-unit");
    const hiddenInput = newUnitCell.querySelector('input[type="hidden"]');
    const trigger = newUnitCell.querySelector("button");
    expect(hiddenInput).not.toBeNull();
    expect(trigger).not.toBeNull();
    // Must not land on the hidden input (a no-op focus target) — must be
    // the actual combobox trigger the user can operate.
    expect(document.activeElement).not.toBe(hiddenInput);
    expect(document.activeElement).toBe(trigger);
  });

  test("a reference first-column focuses the combobox trigger button, not the hidden name-input or the wrapper div", () => {
    const columns: readonly EmbeddedListColumn[] = [
      {
        field: "product",
        label: "Product",
        type: "reference",
        required: false,
        derived: false,
        referenceOptions: [{ value: "p1", label: "Widget" }],
      },
      { field: "desc", label: "Desc", type: "text", required: false, derived: false },
    ];
    renderWithLocale(
      <ControlledFocusHarness columns={columns} initialRows={[{ product: "p1", desc: "x" }]} />,
    );
    const desktop = within(screen.getByTestId("lines-desktop"));
    const lastInput = desktop.getByTestId("lines-cell-0-desc").querySelector("input");
    if (lastInput === null) throw new Error("expected an <input> in the last cell");
    fireEvent.keyDown(lastInput, { key: "Tab", code: "Tab" });

    const newProductCell = desktop.getByTestId("lines-cell-1-product");
    const hiddenInput = newProductCell.querySelector('input[type="hidden"]');
    const trigger = newProductCell.querySelector("button");
    expect(hiddenInput).not.toBeNull();
    expect(trigger).not.toBeNull();
    expect(document.activeElement).not.toBe(hiddenInput);
    expect(document.activeElement).toBe(trigger);
  });
});

describe("EmbeddedListInput — currency (#1839)", () => {
  const currencyColumns: readonly EmbeddedListColumn[] = [
    { field: "description", label: "Description", type: "text", required: true, derived: false },
    { field: "amount", label: "Amount", type: "money", required: false, derived: false },
  ];

  test("currency prop formats the totals row in that currency instead of the EUR default", () => {
    const rows = [{ description: "A", amount: 150000 }];
    renderWithLocale(
      <EmbeddedListInput
        {...baseProps({
          columns: currencyColumns,
          rows,
          currency: "USD",
          totals: [{ field: "amount", label: "Total", value: 150000 }],
        })}
      />,
    );
    const totals = within(screen.getByTestId("lines-desktop")).getByTestId("lines-totals");
    expect(totals.textContent).toContain("$");
    expect(totals.textContent).not.toContain("€");
  });

  test("currency prop is passed through to money-cell MoneyInput", () => {
    const rows = [{ description: "A", amount: 150000 }];
    renderWithLocale(
      <EmbeddedListInput {...baseProps({ columns: currencyColumns, rows, currency: "USD" })} />,
    );
    const cell = within(screen.getByTestId("lines-desktop")).getByTestId("lines-cell-0-amount");
    const input = cell.querySelector("input") as HTMLInputElement;
    expect(input.value).toContain("$");
  });

  test("without a currency prop, totals row still formats as EUR (backward-compatible default)", () => {
    const rows = [{ description: "A", amount: 150000 }];
    renderWithLocale(
      <EmbeddedListInput
        {...baseProps({
          columns: currencyColumns,
          rows,
          totals: [{ field: "amount", label: "Total", value: 150000 }],
        })}
      />,
    );
    const totals = within(screen.getByTestId("lines-desktop")).getByTestId("lines-totals");
    expect(totals.textContent).toContain("€");
  });
});
