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
      expect(rowA.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
      const rowB = screen.getByTestId("row-b");
      expect(within(rowB).queryByTestId("cell-b-baseline")).toBeNull();
      expect(rowB.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
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
});
