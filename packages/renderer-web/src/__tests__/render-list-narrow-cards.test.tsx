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
import { defaultPrimitives } from "../primitives";
import { fireEvent, render, screen, within } from "./test-utils";

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

  test("narrow viewport: no <table>, one card per row, every column present as label + value", () => {
    withViewportWidth(500, () => {
      render(<DataTable columns={COLUMNS} rows={ROWS} testId="t" />);
      expect(document.querySelector("table")).toBeNull();
      const card = within(screen.getByTestId("t-cards")).getByTestId("row-u1");
      // Title = first column (none highlighted here) — still findable, and
      // not duplicated as a label/value pair below.
      expect(card.textContent).toContain("Anna Beispiel");
      for (const col of COLUMNS.filter((c) => c.field !== "name")) {
        expect(within(card).getByText(col.label)).not.toBeNull();
      }
      expect(within(card).getByTestId("cell-u1-email").textContent).toBe("anna@haendler.de");
      expect(within(card).getByTestId("cell-u1-role").textContent).toBe("Admin");
      expect(within(card).getByTestId("cell-u1-bio").textContent).toBe(LONG_BIO);
    });
  });

  test("highlighted column becomes the card title and does not repeat as a label/value pair", () => {
    withViewportWidth(500, () => {
      const columns = COLUMNS.map((c) => (c.field === "role" ? { ...c, highlighted: true } : c));
      render(<DataTable columns={columns} rows={ROWS} testId="t" />);
      const card = within(screen.getByTestId("t-cards")).getByTestId("row-u1");
      expect(within(card).queryByText("Role")).toBeNull();
      expect(within(card).getByText("Name")).not.toBeNull();
    });
  });

  test("a value the table would truncate is shown in full in the card, without the truncate class", () => {
    const originalWidth = window.innerWidth;
    try {
      setViewportWidth(1024);
      const { unmount } = render(<DataTable columns={COLUMNS} rows={ROWS} testId="t" />);
      const desktopCell = screen.getByTestId("cell-u1-bio");
      expect(desktopCell.className).toContain("truncate");
      unmount();

      setViewportWidth(500);
      render(<DataTable columns={COLUMNS} rows={ROWS} testId="t" />);
      const cardCell = screen.getByTestId("cell-u1-bio");
      expect(cardCell.className).not.toContain("truncate");
      expect(cardCell.textContent).toBe(LONG_BIO);
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
