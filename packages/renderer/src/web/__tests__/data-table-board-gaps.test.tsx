import { describe, expect, mock, spyOn, test } from "bun:test";
import { LINK_BUTTON_CLASS } from "../primitives/data-table-cell.tsx";
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

function hasAllClasses(element: Element | null | undefined, classes: string): boolean {
  return (
    element !== null &&
    element !== undefined &&
    classes.split(" ").every((token) => element.classList.contains(token))
  );
}

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
        toolbarSort
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
      within(screen.getByTestId("t-sort")).getByText("Customer");
    });
  });
});

describe("DataTable header styles", () => {
  test("headers are 13.5px regular without small caps; an action column is right-aligned with a screen-reader-only label", () => {
    render(
      <DataTable
        columns={[
          { field: "name", label: "Name", type: "string", sortable: false },
          {
            field: "act",
            label: "Action",
            type: "string",
            sortable: false,
            rowActionLink: true,
            linkFor: () => ({ href: "/x", onPress: () => {} }),
          },
        ]}
        rows={[{ id: "r1", values: { name: "Alpha", act: "Reply" } }]}
      />,
    );
    const nameHead = screen.getByTestId("column-name");
    expect(nameHead.className).not.toContain("uppercase");
    expect(nameHead.className).toContain("text-[13.5px]");
    const actionHead = screen.getByTestId("column-act");
    expect(actionHead.className).toContain("sm:text-right");
    expect(within(actionHead).getByText("Action").className).toContain("sm:sr-only");
    const tableLink = screen.getByText("Reply").closest("a");
    expect(tableLink).not.toBeNull();
    expect(hasAllClasses(tableLink, LINK_BUTTON_CLASS)).toBe(false);
    expect(screen.getByText("Reply").closest("td")?.className).toContain("sm:text-right");
  });

  test("a display: button column is an action column too", () => {
    render(
      <DataTable
        columns={[
          { field: "name", label: "Name", type: "string", sortable: false },
          {
            field: "act",
            label: "Action",
            type: "string",
            sortable: false,
            display: "button",
            linkFor: () => ({ href: "/x", onPress: () => {} }),
          },
        ]}
        rows={[{ id: "r1", values: { name: "Alpha", act: "Reply" } }]}
      />,
    );
    expect(within(screen.getByTestId("column-act")).getByText("Action").className).toContain(
      "sm:sr-only",
    );
    expect(screen.getByText("Reply").closest("td")?.className).toContain("sm:text-right");
  });

  test("on cards the action link is a plain primary link, not an outline button", () => {
    atViewportWidth(500, () => {
      render(
        <DataTable
          columns={[
            { field: "name", label: "Name", type: "string", sortable: false },
            {
              field: "act",
              label: "Action",
              type: "string",
              sortable: false,
              rowActionLink: true,
              linkFor: () => ({ href: "/x", onPress: () => {} }),
            },
          ]}
          rows={[{ id: "r1", values: { name: "Alpha", act: "Reply" } }]}
          testId="t"
        />,
      );
      const link = screen.getByText("Reply").closest("a");
      expect(link).not.toBeNull();
      expect(hasAllClasses(link, LINK_BUTTON_CLASS)).toBe(false);
      expect(link?.className).toContain("text-primary");
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

  test("an item without a label shows its value alone", () => {
    render(
      <DataTable columns={COLUMNS} rows={ROWS} summaryRow={{ items: [{ value: "7 open" }] }} />,
    );
    expect(screen.getByTestId("list-summary").textContent).toBe("7 open");
  });

  test("two identical column items render both without a duplicate-key warning", () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          summaryRow={{
            items: [
              { column: "due", value: "0" },
              { column: "due", value: "0" },
            ],
          }}
        />,
      );
      expect(screen.getAllByTestId("list-summary-item")).toHaveLength(2);
      const keyWarnings = consoleError.mock.calls.filter((call) =>
        String(call[0]).includes("same key"),
      );
      expect(keyWarnings).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  test("items with a column sit under that column, unknown columns fall back to the first", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        summaryRow={{
          items: [
            { column: "due", value: "2 overdue" },
            { column: "hidden-column", value: "9 open" },
          ],
        }}
      />,
    );
    expect(screen.getByTestId("list-summary-due").textContent).toBe("2 overdue");
    expect(screen.getByTestId("list-summary-name").textContent).toBe("9 open");
  });

  test("below sm: no summary row", () => {
    atViewportWidth(500, () => {
      render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          summaryRow={{ items: [{ label: "Orders", value: "8" }] }}
        />,
      );
      expect(screen.queryByTestId("list-summary")).toBeNull();
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
      within(buttons).getByText("Pay");
      expect(within(buttons).queryByText("Hidden")).toBeNull();
      fireEvent.click(within(buttons).getByText("Pay"));
      expect(onTrigger).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("row-r2-card-buttons").textContent).toContain("Hidden");
    });
  });
});

describe("DataTable sortOptions without a matching option", () => {
  test("shows only the prefix and never claims an order the list is not in", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        sort={{ field: "name", dir: "desc" }}
        onSortChange={mock()}
        sortOptions={SORT_OPTIONS}
        toolbarSort
      />,
    );
    const label = screen.getByTestId("render-list-sort-options-label").textContent ?? "";
    expect(label).not.toContain("Customer");
    expect(label).not.toContain(":");
  });
});

describe("DataTable footer", () => {
  test("summary row and totals row share one tfoot", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        summaryRow={{ items: [{ label: "Orders", value: "8" }] }}
        totals={{ measures: [{ field: "due", kind: "count", value: 2 }] }}
      />,
    );
    expect(document.querySelectorAll("tfoot")).toHaveLength(1);
    const footer = document.querySelector("tfoot");
    expect(footer?.contains(screen.getByTestId("list-summary"))).toBe(true);
    expect(footer?.contains(screen.getByTestId("list-totals"))).toBe(true);
  });
});

describe("DataTable row tone on a pinned first column", () => {
  test("the stripe survives the pin's own box-shadow", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowTone={() => "warn"}
        view={{
          density: "comfortable",
          viewIsDefault: true,
          onViewReset: () => {},
          pins: { name: "left" },
          onPinsChange: () => {},
        }}
      />,
    );
    const cell = screen.getByTestId("cell-r1-name");
    expect(cell.style.boxShadow).toContain("var(--row-stripe");
    expect(cell.parentElement?.className).toContain("[--row-stripe:var(--color-status-warn)]");
  });
});

describe("DataTable card clicks", () => {
  test("a card button does not open the row", () => {
    const onRowClick = mock();
    const onTrigger = mock();
    atViewportWidth(500, () => {
      render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          onRowClick={onRowClick}
          rowActions={[{ id: "pay", label: "Pay", display: "button", onTrigger }]}
          testId="t"
        />,
      );
      fireEvent.click(within(screen.getByTestId("row-r1-card-buttons")).getByText("Pay"));
      expect(onTrigger).toHaveBeenCalledTimes(1);
      expect(onRowClick).not.toHaveBeenCalled();
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
    within(list).getByText("21 Aug");
  });
});

describe("DataTable showOnNarrowOnly and plainSentence", () => {
  const narrowOnlyColumns = [
    ...COLUMNS,
    { field: "rent", label: "Rent", type: "string", sortable: false, showOnNarrowOnly: true },
  ] as const;
  const rentRows = [{ id: "r1", values: { name: "Alpha", due: "x", rent: "890 EUR cold" } }];

  test("the column is left out of the table", () => {
    atViewportWidth(1280, () => {
      render(<DataTable columns={narrowOnlyColumns} rows={rentRows} testId="wide" />);
      expect(screen.queryByText("890 EUR cold")).toBeNull();
    });
  });

  test("the column shows on the cards", () => {
    atViewportWidth(500, () => {
      render(<DataTable columns={narrowOnlyColumns} rows={rentRows} testId="phone" />);
      screen.getByText("890 EUR cold");
    });
  });

  const reasonHint = (plainSentence: boolean) =>
    [
      {
        field: "next",
        label: "Next",
        type: "text",
        sortable: false,
        hint: {
          emptyLabel: "Nothing open",
          reasonLabel: "Why?",
          reasonField: "why",
          toneField: "tone",
          ...(plainSentence && { plainSentence: true }),
        },
      },
    ] as const;
  const hintRows = [{ id: "r1", values: { next: "Ship it", why: "Paid", tone: "bad" } }];

  test("the sentence takes the tone color unless plainSentence is set", () => {
    render(<DataTable columns={reasonHint(false)} rows={hintRows} testId="tone" />);
    expect(screen.getByText("Ship it").className).toContain("text-status-bad");
  });

  test("plainSentence keeps the normal text color", () => {
    render(<DataTable columns={reasonHint(true)} rows={hintRows} testId="plain" />);
    expect(screen.getByText("Ship it").className).not.toContain("text-status-bad");
  });

  test("cards drop the reason and its toggle", () => {
    atViewportWidth(500, () => {
      render(<DataTable columns={reasonHint(false)} rows={hintRows} testId="cards" />);
      screen.getByText("Ship it");
      expect(screen.queryByRole("button", { name: "Why?" })).toBeNull();
      expect(screen.queryByText("Paid")).toBeNull();
    });
  });
});

describe("DataTable hint reason box", () => {
  const reasonColumns = [
    COLUMNS[0],
    {
      field: "note",
      label: "Note",
      type: "string",
      sortable: false,
      hint: {
        emptyLabel: "-",
        reasonLabel: "Why",
        reasonField: "why",
        reasonOpenField: "whyOpen",
        reasonTitleField: "whyTitle",
      },
    },
  ] as const;
  const reasonRows = [
    {
      id: "r1",
      values: {
        name: "Alpha",
        note: "Send",
        why: "14 days overdue.",
        whyOpen: true,
        whyTitle: "Rule 10",
      },
    },
    {
      id: "r2",
      values: { name: "Beta", note: "Call", why: "Asked twice.", whyOpen: false, whyTitle: "" },
    },
  ];

  test("opens the reason box with its title on rows flagged open", () => {
    render(<DataTable columns={reasonColumns} rows={reasonRows} />);
    expect(screen.getAllByText(/14 days overdue\./)).toHaveLength(1);
    screen.getByText("Rule 10");
    expect(screen.queryByText(/Asked twice\./)).toBeNull();
  });
});

describe("DataTable reason box toggle", () => {
  const columns = [
    COLUMNS[0],
    {
      field: "note",
      label: "Note",
      type: "string",
      sortable: false,
      hint: {
        emptyLabel: "-",
        reasonLabel: "Why",
        reasonField: "why",
        reasonOpenField: "whyOpen",
      },
    },
  ] as const;
  const rows = [
    { id: "r1", values: { name: "Alpha", note: "Send", why: "14 days overdue.", whyOpen: true } },
  ];

  test("the (i) closes the open box and reopens it, never doubling it", () => {
    render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getAllByText(/14 days overdue\./)).toHaveLength(1);
    const toggle = document.body.querySelector("[data-hint-reason-toggle]") as HTMLElement;
    fireEvent.click(toggle);
    expect(screen.queryByText(/14 days overdue\./)).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getAllByText(/14 days overdue\./)).toHaveLength(1);
  });
});

describe("DataTable badgeDot", () => {
  const badgeRows = [{ id: "r1", values: { name: "Alpha", state: "open" } }];
  const badgeColumn = (extra: Record<string, unknown>) =>
    [
      COLUMNS[0],
      {
        field: "state",
        label: "State",
        type: "string",
        sortable: false,
        display: "badge",
        ...extra,
      },
    ] as never;

  test("the dot is drawn by default and left out with badgeDot: false", () => {
    const { unmount } = render(<DataTable columns={badgeColumn({})} rows={badgeRows} />);
    expect(document.body.querySelector("[data-status-dot]")).not.toBeNull();
    unmount();
    render(<DataTable columns={badgeColumn({ badgeDot: false })} rows={badgeRows} />);
    expect(document.body.querySelector("[data-status-dot]")).toBeNull();
  });
});

describe("DataTable toolbarSort", () => {
  const props = {
    columns: COLUMNS,
    rows: ROWS,
    testId: "dt",
    sortOptions: SORT_OPTIONS,
    sort: { field: "due", dir: "desc" },
    onSortChange: mock(),
    toolbarSort: true,
  } as const;

  test("from sm the toolbar shows a bordered sort select", () => {
    atViewportWidth(1280, () => {
      render(<DataTable {...props} />);
      const label = screen.getByTestId("dt-sort-options-label");
      expect(label.parentElement?.classList.contains("border")).toBe(true);
    });
  });

  test("between sm and md exactly one sort select is shown", () => {
    atViewportWidth(700, () => {
      render(<DataTable {...props} />);
      expect(document.body.querySelectorAll("select[aria-label]")).toHaveLength(1);
    });
  });
});

describe("DataTable rowActionMode menu", () => {
  const actions = [
    { id: "open", label: "Open", display: "button", onTrigger: mock() },
    { id: "archive", label: "Archive", onTrigger: mock() },
  ] as never;

  test("the table puts every action in the kebab", () => {
    atViewportWidth(1280, () => {
      render(<DataTable columns={COLUMNS} rows={ROWS} rowActions={actions} rowActionMode="menu" />);
      screen.getByTestId("row-r1-actions-menu");
      expect(screen.queryByTestId("row-r1-action-open")).toBeNull();
    });
  });

  test("a phone card with a row target draws no kebab", () => {
    atViewportWidth(500, () => {
      render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          rowActions={actions}
          rowActionMode="menu"
          onRowClick={mock()}
        />,
      );
      expect(screen.queryByTestId("row-r1-actions-menu")).toBeNull();
    });
  });

  test("a phone card without a row target keeps its kebab", () => {
    atViewportWidth(500, () => {
      render(<DataTable columns={COLUMNS} rows={ROWS} rowActions={actions} rowActionMode="menu" />);
      screen.getByTestId("row-r1-actions-menu");
    });
  });
});

describe("DataTable multiline and cardAbove columns", () => {
  const columns = [
    { field: "name", label: "Name", type: "string", sortable: false },
    { field: "channel", label: "Channel", type: "string", sortable: false, cardAbove: true },
    { field: "text", label: "Text", type: "string", sortable: false, multiline: true },
  ] as const;
  const rows = [{ id: "r1", values: { name: "Alpha", channel: "Mail", text: "one\ntwo" } }];

  test("a multiline cell keeps the line break", () => {
    atViewportWidth(1280, () => {
      render(<DataTable columns={columns} rows={rows} testId="wide" />);
      const cell = screen.getByText(
        (_content, el) => el?.textContent === "one\ntwo" && el.tagName === "TD",
      );
      expect(cell.className).toContain("whitespace-pre-line");
    });
  });

  test("a multiline cell wraps long text instead of truncating, a plain one truncates", () => {
    atViewportWidth(1280, () => {
      render(<DataTable columns={columns} rows={rows} testId="wide" />);
      const multi = screen.getByText(
        (_c, el) => el?.textContent === "one\ntwo" && el.tagName === "TD",
      );
      expect(multi.className).not.toContain("truncate");
      expect(multi.className).toContain("break-words");
      expect(screen.getByText("Alpha").closest("td")?.className).toContain("truncate");
    });
  });

  test("on the phone card the cardAbove column stands above the title", () => {
    atViewportWidth(500, () => {
      render(<DataTable columns={columns} rows={rows} testId="phone" />);
      const above = screen.getByTestId("card-above-r1");
      expect(above.textContent).toContain("Mail");
      const title = screen.getByText("Alpha");
      expect(above.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByTestId("card-meta-r1").textContent).not.toContain("Mail");
    });
  });

  test("an emphasis column above the title stays bold foreground on the phone card", () => {
    atViewportWidth(500, () => {
      render(
        <DataTable
          columns={[
            { field: "name", label: "Name", type: "string", sortable: false },
            { field: "todo", label: "To do", type: "string", sortable: false, emphasis: true },
            {
              field: "channel",
              label: "Channel",
              type: "string",
              sortable: false,
              emphasis: true,
              cardAbove: true,
            },
          ]}
          rows={[{ id: "r1", values: { name: "Alpha", todo: "Reply", channel: "Mail" } }]}
          testId="phone"
        />,
      );
      const channel = within(screen.getByTestId("card-above-r1")).getByTestId("cell-r1-channel");
      expect(channel.className).toContain("font-semibold");
      expect(channel.className).toContain("text-foreground");
    });
  });
});

describe("DataTable cardLabel columns", () => {
  const OLD_IBAN = "DE02120300000000202051";
  const columns = [
    { field: "name", label: "Name", type: "string", sortable: false },
    { field: "current", label: "Current value", type: "string", sortable: false, cardLabel: true },
    { field: "next", label: "New value", type: "string", sortable: false, cardLabel: true },
  ] as const;
  const rows = [{ id: "r1", values: { name: "Owner", current: OLD_IBAN, next: "DE89" } }];

  test("on the phone card each labelled column has its own line that starts with the label", () => {
    atViewportWidth(500, () => {
      render(<DataTable columns={columns} rows={rows} testId="phone" />);
      const meta = screen.getByTestId("card-meta-r1");
      const current = within(meta).getByTestId("cell-r1-current");
      const next = within(meta).getByTestId("cell-r1-next");
      expect(current.textContent).toBe(`Current value: ${OLD_IBAN}`);
      expect(next.textContent).toBe("New value: DE89");
      expect(current.parentElement).not.toBe(next.parentElement);
      // The value moves below its label as one piece before it breaks inside.
      expect(within(current).getByText(OLD_IBAN).className).toContain("inline-block");
    });
  });

  test("a labelled amount puts its name left and the figure right, like the totals card", () => {
    atViewportWidth(500, () => {
      render(
        <DataTable
          columns={[
            ...columns,
            { field: "paid", label: "Paid", type: "money", sortable: false, cardLabel: true },
          ]}
          rows={[
            { id: "r1", values: { ...rows[0]?.values, paid: { amount: 25496, currency: "EUR" } } },
          ]}
          testId="phone"
        />,
      );
      const paid = within(screen.getByTestId("card-meta-r1")).getByTestId("cell-r1-paid");
      expect(paid.className).toContain("justify-between");
      expect(paid.firstElementChild?.textContent).toBe("Paid");
      expect(paid.textContent).not.toContain("Paid:");
      // A text value keeps the inline "Label: value" form.
      expect(screen.getByTestId("cell-r1-next").className).not.toContain("justify-between");
    });
  });

  test("a labelled amount that shares its line (narrowInline) stays inline", () => {
    atViewportWidth(500, () => {
      render(
        <DataTable
          columns={[
            ...columns,
            {
              field: "count",
              label: "Debits",
              type: "number",
              sortable: false,
              cardLabel: true,
              narrowInline: true,
            },
          ]}
          rows={[{ id: "r1", values: { ...rows[0]?.values, count: 3 } }]}
          testId="phone"
        />,
      );
      const count = within(screen.getByTestId("card-meta-r1")).getByTestId("cell-r1-count");
      expect(count.className).not.toContain("justify-between");
      expect(count.textContent).toBe("Debits: 3");
    });
  });

  test("a labelled date keeps date and time together when the card line runs out of room", () => {
    atViewportWidth(500, () => {
      render(
        <DataTable
          columns={[
            ...columns,
            {
              field: "by",
              label: "Requested by",
              type: "string",
              sortable: false,
              cardLabel: true,
              narrowInline: true,
            },
            {
              field: "at",
              label: "Requested at",
              type: "string",
              sortable: false,
              cardLabel: true,
              narrowInline: true,
              renderer: { format: "timestamp" },
            },
          ]}
          rows={[
            { id: "r1", values: { ...rows[0]?.values, by: "Lukas", at: "2026-11-18T12:46:00Z" } },
          ]}
          testId="phone"
        />,
      );
      const meta = screen.getByTestId("card-meta-r1");
      const valueSpan = (field: string): Element | null =>
        within(meta).getByTestId(`cell-r1-${field}`).querySelector("span.inline-block");
      expect(valueSpan("at")?.className).toContain("whitespace-nowrap");
      expect(valueSpan("by")?.className).not.toContain("whitespace-nowrap");
    });
  });

  test("the wide table keeps the label in the header only", () => {
    atViewportWidth(1280, () => {
      render(<DataTable columns={columns} rows={rows} testId="wide" />);
      expect(screen.getByText(OLD_IBAN).closest("td")?.textContent).toBe(OLD_IBAN);
    });
  });
});
