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
import type { ReactElement } from "react";
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
