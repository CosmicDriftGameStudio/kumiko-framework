import { describe, expect, mock, test } from "bun:test";
import { defaultPrimitives } from "../primitives/index.tsx";
import { StepBar } from "../widgets/step-bar.tsx";
import { atViewportWidth, fireEvent, render, screen, within } from "./test-utils.tsx";

const { DataTable } = defaultPrimitives;

const COLUMNS = [
  { field: "name", label: "Name", type: "string", sortable: true },
  { field: "due", label: "Due", type: "string", sortable: true },
] as const;

const ROWS = [
  { id: "r1", values: { name: "Alpha", due: "2026-01-01" } },
  { id: "r2", values: { name: "Beta", due: "2026-02-01" } },
];

const SORT_OPTIONS = [
  { field: "due", dir: "desc", label: "Urgency" },
  { field: "name", dir: "asc", label: "Customer" },
] as const;

describe("DataTable sortOptions", () => {
  test("shows the active option and reports the picked one", () => {
    const onSortChange = mock();
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        sort={{ field: "due", dir: "desc" }}
        onSortChange={onSortChange}
        sortOptions={SORT_OPTIONS}
      />,
    );
    expect(screen.getByTestId("render-list-sort-options-label").textContent).toContain("Urgency");
    fireEvent.change(screen.getByTestId("render-list-sort-options"), {
      target: { value: "name:asc" },
    });
    expect(onSortChange).toHaveBeenCalledWith({ field: "name", dir: "asc" });
  });

  test("narrow viewport: the cards offer the same labelled options", () => {
    atViewportWidth(500, () => {
      render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          sort={null}
          onSortChange={mock()}
          sortOptions={SORT_OPTIONS}
          testId="t"
        />,
      );
      expect(within(screen.getByTestId("t-sort")).getByText("Customer")).toBeTruthy();
    });
  });
});

describe("DataTable summaryRow", () => {
  test("renders label value pairs above the totals", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        summaryRow={{
          items: [
            { label: "Orders", value: "8" },
            { label: "Overdue", value: "1.200 EUR", tone: "bad" },
          ],
        }}
      />,
    );
    const items = screen.getAllByTestId("list-summary-item");
    expect(items.map((item) => item.textContent)).toEqual(["Orders 8", " · Overdue 1.200 EUR"]);
  });

  test("narrow viewport: renders as a card", () => {
    atViewportWidth(500, () => {
      render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          summaryRow={{ items: [{ label: "Orders", value: "8" }] }}
        />,
      );
      expect(screen.getByTestId("list-summary").textContent).toContain("Orders 8");
    });
  });
});

describe("DataTable hint column width", () => {
  const hintColumns = [
    COLUMNS[0],
    {
      field: "note",
      label: "Note",
      type: "string",
      sortable: false,
      hint: { emptyLabel: "-", reasonLabel: "Why" },
      width: 320,
      minWidth: 240,
    },
  ] as const;
  const rows = [{ id: "r1", values: { name: "Alpha", note: "x" } }];

  test("a hint column sizes itself without resizing, other columns do not", () => {
    atViewportWidth(1024, () => {
      render(<DataTable columns={hintColumns} rows={rows} />);
      const headers = document.querySelectorAll("th");
      const noteHeader = Array.from(headers).find((th) => th.textContent?.includes("Note"));
      expect(noteHeader?.style.width).toBe("320px");
      expect(noteHeader?.style.minWidth).toBe("240px");
      const nameHeader = Array.from(headers).find((th) => th.textContent?.includes("Name"));
      expect(nameHeader?.style.width).toBe("");
    });
  });
});

describe("DataTable card buttons", () => {
  test("display button actions render as buttons under the card, the rest stay in the kebab", () => {
    const onTrigger = mock();
    atViewportWidth(500, () => {
      render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          rowActions={[
            { id: "pay", label: "Pay", display: "button", onTrigger },
            { id: "a", label: "A", onTrigger: mock() },
            { id: "b", label: "B", onTrigger: mock() },
            {
              id: "hidden",
              label: "Hidden",
              display: "button",
              onTrigger: mock(),
              isVisible: (row) => row.id === "r2",
            },
          ]}
          testId="t"
        />,
      );
      const buttons = screen.getByTestId("row-r1-card-buttons");
      expect(within(buttons).getByText("Pay")).toBeTruthy();
      expect(within(buttons).queryByText("Hidden")).toBeNull();
      fireEvent.click(within(buttons).getByText("Pay"));
      expect(onTrigger).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("row-r2-card-buttons").textContent).toContain("Hidden");
    });
  });
});

describe("StepBar stacked", () => {
  test("lists every step with its subtitle", () => {
    render(
      <StepBar
        steps={["Placed", "Paid"]}
        currentIndex={1}
        compactLabel="Paid"
        orientation="stacked"
        subtitles={["21 Aug", undefined]}
        testId="stages"
      />,
    );
    const list = screen.getByTestId("stages");
    expect(list.tagName).toBe("OL");
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(within(list).getByText("21 Aug")).toBeTruthy();
  });
});
