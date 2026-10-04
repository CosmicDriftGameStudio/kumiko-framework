// DataTable — card layout below the 768px breakpoint (offlot#37). Below
// that width the table scrolled its columns out of reach with no visible
// affordance (worse: the `md:sticky` actions column scrolled away WITH the
// last data columns instead of staying reachable). These tests pin the
// replacement: below the breakpoint, no <table> at all — one card per row,
// every ViewModel column present as a label/value pair, actions always
// visible, and a native <select> standing in for the header-click sort
// affordance that has no header to attach to down here.
//
// Viewport is driven the same way embedded-list-input.test.tsx does it —
// happy-dom's real innerWidth backs useIsNarrowViewport's matchMedia query,
// so no matchMedia mock is needed.

import { describe, expect, mock, test } from "bun:test";
import userEvent from "@testing-library/user-event";
import { defaultPrimitives } from "../primitives/index.js";
import { fireEvent, render, screen, within } from "./test-utils.js";

const { DataTable } = defaultPrimitives;

function setViewportWidth(width: number): void {
  (
    window as unknown as { happyDOM: { setInnerWidth: (n: number) => void } }
  ).happyDOM.setInnerWidth(width);
}

function withViewportWidth(width: number, run: () => void): void {
  const originalWidth = window.innerWidth;
  setViewportWidth(width);
  try {
    run();
  } finally {
    setViewportWidth(originalWidth);
  }
}

const LONG_BIO =
  "Anna joined the handler team in 2019 and has led onboarding for every partner integration since, focusing on payment reconciliation edge cases and cross-border tax handling.";

const COLUMNS = [
  { field: "name", label: "Name", type: "string", sortable: true },
  { field: "email", label: "Email", type: "string", sortable: false },
  { field: "role", label: "Role", type: "string", sortable: true },
  { field: "bio", label: "Bio", type: "string", sortable: false },
] as const;

const ROWS = [
  {
    id: "u1",
    values: { name: "Anna Beispiel", email: "anna@haendler.de", role: "Admin", bio: LONG_BIO },
  },
];

describe("DataTable — cards below 768px", () => {
  test("desktop viewport: table renders as before, no cards", () => {
    withViewportWidth(1024, () => {
      render(<DataTable columns={COLUMNS} rows={ROWS} testId="t" />);
      expect(screen.getByTestId("t").tagName).toBe("TABLE");
      expect(screen.queryByTestId("t-cards")).toBeNull();
    });
  });

  test("narrow viewport: no <table>, one list row per record with title and meta values", () => {
    withViewportWidth(500, () => {
      render(<DataTable columns={COLUMNS} rows={ROWS} testId="t" />);
      expect(document.querySelector("table")).toBeNull();
      const card = within(screen.getByTestId("t-cards")).getByTestId("row-u1");
      expect(card.tagName).toBe("LI");
      expect(card.querySelector(".font-semibold")?.textContent).toBe("Anna Beispiel");
      expect(within(card).getByTestId("cell-u1-email").textContent).toBe("anna@haendler.de");
      expect(within(card).getByTestId("cell-u1-role").textContent).toBe("Admin");
      expect(within(card).getByTestId("cell-u1-bio").textContent).toBe(LONG_BIO);
    });
  });

  test("narrow viewport: rowGrouping puts rows under toggleable headers, collapsed rows are not shown", () => {
    withViewportWidth(500, () => {
      const rows = [
        { id: "a1", values: { name: "A1", role: "open" } },
        { id: "a2", values: { name: "A2", role: "done" } },
        { id: "a3", values: { name: "A3", role: "done" } },
      ];
      render(
        <DataTable
          columns={COLUMNS}
          rows={rows}
          testId="t"
          rowGrouping={{
            keyOf: (row) => String(row.values["role"]),
            headerLabel: (key, members) => `${key} (${members.length})`,
            startsCollapsed: (key) => key === "done",
          }}
        />,
      );
      expect(screen.getByTestId("row-group-done").textContent).toBe("done (2)");
      expect(screen.getByTestId("row-group-open").textContent).toBe("open (1)");
      expect(screen.getByTestId("row-a1")).toBeTruthy();
      expect(screen.queryByTestId("row-a2")).toBeNull();

      fireEvent.click(screen.getByTestId("row-group-done-toggle"));
      expect(screen.getByTestId("row-a2")).toBeTruthy();
      expect(screen.getByTestId("row-a3")).toBeTruthy();
    });
  });

  test("narrow viewport: rowTone tints only matching cards", () => {
    withViewportWidth(500, () => {
      const rows = [
        { id: "a1", values: { name: "A1", role: "late" } },
        { id: "a2", values: { name: "A2", role: "ok" } },
      ];
      render(
        <DataTable
          columns={COLUMNS}
          rows={rows}
          testId="t"
          rowTone={(row) => (row.values["role"] === "late" ? "bad" : undefined)}
        />,
      );
      const late = screen.getByTestId("row-a1");
      expect(late.getAttribute("data-tone")).toBe("bad");
      expect(late.className).toContain("bg-status-bad/10");
      expect(screen.getByTestId("row-a2").getAttribute("data-tone")).toBeNull();
    });
  });

  test("highlighted column becomes the row title", () => {
    withViewportWidth(500, () => {
      const columns = COLUMNS.map((c) => (c.field === "role" ? { ...c, highlighted: true } : c));
      render(<DataTable columns={columns} rows={ROWS} testId="t" />);
      const card = within(screen.getByTestId("t-cards")).getByTestId("row-u1");
      expect(card.querySelector(".font-semibold")?.textContent).toBe("Admin");
    });
  });

  test("a select column renders as badge next to the title, at most three values in the meta line", () => {
    withViewportWidth(500, () => {
      const columns = [
        { field: "name", label: "Name", type: "string", sortable: false },
        { field: "status", label: "Status", type: "select", sortable: false },
        { field: "a", label: "A", type: "string", sortable: false },
        { field: "b", label: "B", type: "string", sortable: false },
        { field: "c", label: "C", type: "string", sortable: false },
        { field: "d", label: "D", type: "string", sortable: false },
      ] as const;
      const rows = [
        { id: "u1", values: { name: "Anna", status: "active", a: "1", b: "2", c: "3", d: "4" } },
      ];
      render(<DataTable columns={columns} rows={rows} testId="t" />);
      const card = within(screen.getByTestId("t-cards")).getByTestId("row-u1");
      const badge = within(card).getByTestId("cell-u1-status");
      expect(badge.className).toContain("shrink-0");
      const titleRow = within(card).getByTestId("cell-u1-name").parentElement;
      expect(badge.parentElement).toBe(titleRow);
      expect(titleRow?.className).toContain("items-start");
      expect(titleRow?.contains(within(card).getByTestId("cell-u1-a"))).toBe(false);
      expect(within(card).queryByTestId("cell-u1-d")).toBeNull();
      expect(within(card).getByTestId("cell-u1-c").textContent).toBe("3");
    });
  });

  test("the meta line wraps between values (two lines at most) and clips the separator at a line start", () => {
    withViewportWidth(500, () => {
      const columns = [
        { field: "name", label: "Name", type: "string", sortable: false },
        { field: "from", label: "From", type: "string", sortable: false },
        { field: "to", label: "To", type: "string", sortable: false },
      ] as const;
      const rows = [{ id: "u1", values: { name: "Anna", from: "4. Okt. 2026", to: "5. Okt." } }];
      render(<DataTable columns={columns} rows={rows} testId="t" />);
      const to = screen.getByTestId("cell-u1-to");
      const metaRow = screen.getByTestId("card-meta-u1");
      const clipBox = metaRow.parentElement;
      // happy-dom has no layout; the clipping contract is the class set: the row is
      // shifted left by exactly the separator width inside an overflow-hidden box.
      expect(metaRow.className).toContain("flex-wrap");
      expect(metaRow.className).toContain("-ms-3");
      expect(clipBox?.className).toContain("overflow-hidden");
      expect(clipBox?.className).toContain("max-h-10");
      const wrapper = to.parentElement;
      expect(wrapper?.parentElement).toBe(metaRow);
      expect(to.className).toContain("truncate");
      expect(to.textContent).toBe("5. Okt.");
      for (const value of ["cell-u1-from", "cell-u1-to"]) {
        const separator = screen.getByTestId(value).previousElementSibling;
        expect(separator?.getAttribute("aria-hidden")).toBe("true");
        expect(separator?.textContent).toBe("·");
      }
      expect(metaRow.className).not.toContain("before:");
    });
  });

  test("a true boolean meta column shows its label, false and blank values show nothing", () => {
    withViewportWidth(500, () => {
      render(
        <DataTable
          columns={[
            { field: "name", label: "Name", type: "string", sortable: false },
            { field: "plan", label: "Plan", type: "string", sortable: false },
            { field: "baseline", label: "Baseline", type: "boolean", sortable: false },
            { field: "note", label: "Note", type: "string", sortable: false },
          ]}
          rows={[
            { id: "a", values: { name: "A", plan: "FY26", baseline: true, note: "  " } },
            { id: "b", values: { name: "B", plan: "FY26", baseline: false, note: "" } },
          ]}
          testId="t"
        />,
      );
      const rowA = screen.getByTestId("row-a");
      expect(within(rowA).getByTestId("cell-a-baseline").textContent).toBe("Baseline");
      expect(within(rowA).queryByTestId("cell-a-note")).toBeNull();
      expect(screen.getByTestId("card-meta-a").children).toHaveLength(2);
      const rowB = screen.getByTestId("row-b");
      expect(within(rowB).queryByTestId("cell-b-baseline")).toBeNull();
      expect(screen.getByTestId("card-meta-b").children).toHaveLength(1);
    });
  });

  test("a text-typed column with format boolean behaves like a boolean column in the card", () => {
    withViewportWidth(500, () => {
      render(
        <DataTable
          columns={[
            { field: "name", label: "Name", type: "string", sortable: false },
            {
              field: "current",
              label: "This device",
              type: "text",
              sortable: false,
              renderer: { format: "boolean" },
            },
          ]}
          rows={[
            { id: "a", values: { name: "A", current: true } },
            { id: "b", values: { name: "B", current: false } },
          ]}
          testId="t"
        />,
      );
      expect(within(screen.getByTestId("row-a")).getByTestId("cell-a-current").textContent).toBe(
        "This device",
      );
      expect(within(screen.getByTestId("row-b")).queryByTestId("cell-b-current")).toBeNull();
    });
  });

  test("a false boolean column with a non-boolean format spec still renders in card and table", () => {
    const columns = [
      { field: "name", label: "Name", type: "string", sortable: false },
      {
        field: "flag",
        label: "Flag",
        type: "boolean",
        sortable: false,
        renderer: { format: "enumOption", keyPrefix: "x:option:" },
      },
    ] as const;
    const rows = [{ id: "a", values: { name: "A", flag: false } }];
    withViewportWidth(500, () => {
      render(<DataTable columns={columns} rows={rows} testId="t" />);
      expect(screen.getByTestId("cell-a-flag").textContent).toBe("false");
    });
    withViewportWidth(1024, () => {
      render(<DataTable columns={columns} rows={rows} testId="t2" />);
      expect(screen.getAllByTestId("cell-a-flag").at(-1)?.textContent).toBe("false");
    });
  });

  test("a boolean column with its own trueLabel keeps it in the card subtitle", () => {
    withViewportWidth(500, () => {
      render(
        <DataTable
          columns={[
            { field: "name", label: "Name", type: "string", sortable: false },
            {
              field: "baseline",
              label: "Baseline",
              type: "boolean",
              sortable: false,
              renderer: { format: "boolean", trueLabel: "Active", falseLabel: "Off" },
            },
          ]}
          rows={[{ id: "a", values: { name: "A", baseline: true } }]}
          testId="t"
        />,
      );
      expect(screen.getByTestId("cell-a-baseline").textContent).toBe("Active");
    });
  });

  test("with onRowClick the whole row opens the record, also via Enter", async () => {
    const originalWidth = window.innerWidth;
    setViewportWidth(500);
    try {
      const onRowClick = mock();
      render(<DataTable columns={COLUMNS} rows={ROWS} onRowClick={onRowClick} testId="t" />);
      const card = screen.getByTestId("row-u1");
      await userEvent.setup().click(card);
      expect(onRowClick).toHaveBeenCalledTimes(1);
      fireEvent.keyDown(card.querySelector("button") as HTMLElement, { key: "Enter" });
      expect(onRowClick).toHaveBeenCalledTimes(2);
    } finally {
      setViewportWidth(originalWidth);
    }
  });

  test("row actions are present in the DOM and operable in card mode", async () => {
    const originalWidth = window.innerWidth;
    setViewportWidth(500);
    try {
      const onTrigger = mock();
      render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          rowActions={[{ id: "edit", label: "Edit", onTrigger }]}
          testId="t"
        />,
      );
      const button = screen.getByTestId("row-u1-action-edit");
      await userEvent.setup().click(button);
      expect(onTrigger).toHaveBeenCalledTimes(1);
    } finally {
      setViewportWidth(originalWidth);
    }
  });

  test("empty state renders the same way in card mode, no card container", () => {
    withViewportWidth(500, () => {
      render(<DataTable columns={COLUMNS} rows={[]} testId="t" />);
      expect(screen.getByTestId("t-empty")).not.toBeNull();
      expect(screen.queryByTestId("t-cards")).toBeNull();
    });
  });
});

// No column headers below the breakpoint, so SortableHeader's click-to-sort
// has nothing to attach to — a native <select> fed from the sortable
// columns is the whole replacement, only rendered when there is something
// to sort and somewhere for the result to go.
describe("DataTable — card-mode sort select", () => {
  test("lists only the sortable columns, both directions, and reports the picked one", () => {
    withViewportWidth(500, () => {
      const onSortChange = mock();
      render(<DataTable columns={COLUMNS} rows={ROWS} onSortChange={onSortChange} testId="t" />);
      const select = screen.getByTestId("t-sort") as HTMLSelectElement;
      const optionLabels = Array.from(select.options).map((o) => o.textContent);
      expect(optionLabels).toEqual(["Unsorted", "Name ↑", "Name ↓", "Role ↑", "Role ↓"]);

      fireEvent.change(select, { target: { value: "role:desc" } });
      expect(onSortChange).toHaveBeenCalledWith({ field: "role", dir: "desc" });
    });
  });

  test("a sort on a non-sortable column still shows up in the select instead of 'Unsorted'", () => {
    withViewportWidth(500, () => {
      render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          sort={{ field: "email", dir: "asc" }}
          onSortChange={mock()}
          testId="t"
        />,
      );
      const select = screen.getByTestId("t-sort") as HTMLSelectElement;
      expect(select.value).toBe("email:asc");
      expect(select.selectedOptions[0]?.textContent).toBe("Email ↑");
    });
  });

  test("narrow viewport: the bare testId stays resolvable next to -cards", () => {
    withViewportWidth(500, () => {
      render(<DataTable columns={COLUMNS} rows={ROWS} testId="t" />);
      expect(within(screen.getByTestId("t")).getByTestId("t-cards")).not.toBeNull();
    });
  });

  test("no select without onSortChange — nothing to wire it to", () => {
    withViewportWidth(500, () => {
      render(<DataTable columns={COLUMNS} rows={ROWS} testId="t" />);
      expect(screen.queryByTestId("t-sort")).toBeNull();
    });
  });

  test("no select when no column is sortable", () => {
    withViewportWidth(500, () => {
      const onSortChange = mock();
      const nonSortableColumns = COLUMNS.map((c) => ({ ...c, sortable: false }));
      render(
        <DataTable
          columns={nonSortableColumns}
          rows={ROWS}
          onSortChange={onSortChange}
          testId="t"
        />,
      );
      expect(screen.queryByTestId("t-sort")).toBeNull();
    });
  });

  test("desktop viewport never renders the select — header clicks already cover it", () => {
    withViewportWidth(1024, () => {
      const onSortChange = mock();
      render(<DataTable columns={COLUMNS} rows={ROWS} onSortChange={onSortChange} testId="t" />);
      expect(screen.queryByTestId("t-sort")).toBeNull();
    });
  });
});

describe("DataTable — card-mode row menu and hideOnNarrow", () => {
  test("the rowClick action alone leaves no menu next to the chevron", () => {
    withViewportWidth(500, () => {
      render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          onRowClick={() => {}}
          rowActions={[{ id: "edit", label: "Edit", rowClick: true, onTrigger: mock() }]}
          testId="t"
        />,
      );
      expect(within(screen.getByTestId("row-u1")).queryAllByRole("button")).toHaveLength(1);
    });
  });

  test("an action beyond the rowClick one keeps its menu", () => {
    withViewportWidth(500, () => {
      render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          onRowClick={() => {}}
          rowActions={[
            { id: "edit", label: "Edit", rowClick: true, onTrigger: mock() },
            { id: "wizard", label: "Wizard", onTrigger: mock() },
          ]}
          testId="t"
        />,
      );
      expect(within(screen.getByTestId("row-u1")).queryAllByRole("button")).toHaveLength(2);
    });
  });

  test("hideOnNarrow keeps a column out of the cards but in the table", () => {
    const columns = COLUMNS.map((c) => (c.field === "role" ? { ...c, hideOnNarrow: true } : c));
    withViewportWidth(500, () => {
      render(<DataTable columns={columns} rows={ROWS} testId="t" />);
      expect(screen.queryByTestId("cell-u1-role")).toBeNull();
      expect(screen.getByTestId("cell-u1-email")).not.toBeNull();
    });
    withViewportWidth(1024, () => {
      render(<DataTable columns={columns} rows={ROWS} testId="t2" />);
      expect(screen.getByTestId("cell-u1-role")).not.toBeNull();
    });
  });

  describe('display: "responsive" row actions', () => {
    const responsiveActions = (icon?: "check") => [
      {
        id: "mark-posted",
        label: "Mark as posted",
        display: "responsive" as const,
        ...(icon !== undefined && { icon }),
        onTrigger: mock(),
      },
    ];

    test("table layout: a labelled button with its icon", () => {
      withViewportWidth(1024, () => {
        render(<DataTable columns={COLUMNS} rows={ROWS} rowActions={responsiveActions("check")} />);
        const button = screen.getByTestId("row-u1-action-mark-posted");
        expect(button.textContent).toBe("Mark as posted");
        expect(button.querySelector("svg")).not.toBeNull();
        expect(button.getAttribute("aria-label")).toBeNull();
      });
    });

    test("card layout: icon only, the label stays the accessible name", async () => {
      const originalWidth = window.innerWidth;
      setViewportWidth(500);
      try {
        const actions = responsiveActions("check");
        render(<DataTable columns={COLUMNS} rows={ROWS} rowActions={actions} testId="t" />);
        const button = screen.getByRole("button", { name: "Mark as posted" });
        expect(button.textContent).toBe("");
        expect(button.querySelector("svg")).not.toBeNull();
        await userEvent.setup().click(button);
        expect(actions[0]?.onTrigger).toHaveBeenCalledTimes(1);
      } finally {
        setViewportWidth(originalWidth);
      }
    });

    test("card layout without an icon keeps the label", () => {
      withViewportWidth(500, () => {
        render(<DataTable columns={COLUMNS} rows={ROWS} rowActions={responsiveActions()} />);
        expect(screen.getByTestId("row-u1-action-mark-posted").textContent).toBe("Mark as posted");
      });
    });
  });
});
