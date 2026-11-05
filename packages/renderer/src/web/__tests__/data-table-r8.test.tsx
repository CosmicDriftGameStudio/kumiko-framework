import { describe, expect, mock, test } from "bun:test";
import userEvent from "@testing-library/user-event";
import { defaultPrimitives } from "../primitives/index.tsx";
import { atViewportWidth, render, screen, within } from "./test-utils.tsx";

const { DataTable } = defaultPrimitives;

const COLUMNS = [
  { field: "name", label: "Name", type: "string", sortable: true },
  { field: "due", label: "Due", type: "string", sortable: true },
] as const;

const ROWS = [
  { id: "r1", values: { name: "Alpha", due: "2026-01-01" } },
  { id: "r2", values: { name: "Beta", due: "2026-02-01" } },
];

const PAGER = { page: 1, limit: 2, total: 5, onPageChange: mock() } as const;

describe("DataTable rowActionMode menu with a row opener", () => {
  const opener = [{ id: "open", label: "Open file", rowClick: true, onTrigger: mock() }] as never;

  test("menu: the opener is the only kebab entry of every row", async () => {
    const user = userEvent.setup();
    atViewportWidth(1280, () => {
      render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          rowActions={opener}
          rowActionMode="menu"
          onRowClick={mock()}
        />,
      );
    });
    expect(screen.getByTestId("row-r2-actions-menu")).toBeTruthy();
    await user.click(screen.getByTestId("row-r1-actions-menu"));
    expect(await screen.findByTestId("row-r1-action-open")).toBeTruthy();
  });

  test("adaptive: the opener stays out of the row actions", () => {
    atViewportWidth(1280, () => {
      render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          rowActions={opener}
          rowActionMode="adaptive"
          onRowClick={mock()}
        />,
      );
      expect(screen.queryByTestId("row-r1-actions-menu")).toBeNull();
      expect(screen.queryByTestId("row-r1-action-open")).toBeNull();
    });
  });
});

describe("DataTable relaxed density", () => {
  function renderWithDensity(density: "comfortable" | "relaxed") {
    const view = {
      columns: COLUMNS.map((c) => ({ field: c.field, visible: true })),
      onColumnsChange: () => {},
      density,
      onDensityChange: () => {},
      viewIsDefault: true,
      onViewReset: () => {},
    };
    atViewportWidth(1280, () => {
      render(<DataTable columns={COLUMNS} rows={ROWS} testId="dt" view={view} />);
    });
  }

  test("relaxed puts sm:py-3 on the body cells and leaves the header alone", () => {
    renderWithDensity("relaxed");
    expect(document.querySelector("tbody td")?.className).toContain("sm:py-3!");
    expect(document.querySelector("thead th")?.className).not.toContain("py-3");
  });

  test("comfortable adds no cell padding class", () => {
    renderWithDensity("comfortable");
    expect(document.querySelector("tbody td")?.className).not.toContain("sm:py-3!");
  });
});

describe("DataTable frame card", () => {
  const props = { columns: COLUMNS, rows: ROWS, testId: "dt", pager: PAGER } as const;

  test("from sm the table and the pager sit in one bordered card", () => {
    atViewportWidth(1280, () => {
      render(<DataTable {...props} frame="card" scrollBody />);
      const frame = screen.getByTestId("dt-frame");
      expect(frame.classList.contains("rounded-lg")).toBe(true);
      expect(frame.classList.contains("border")).toBe(true);
      expect(within(frame).getByTestId("dt")).toBeTruthy();
      expect(within(frame).getByTestId("dt-pager")).toBeTruthy();
    });
  });

  test("an embedded table (no scrollBody) keeps the pager inside the card", () => {
    atViewportWidth(1280, () => {
      render(<DataTable {...props} frame="card" />);
      const frame = screen.getByTestId("dt-frame");
      expect(within(frame).getByTestId("dt")).toBeTruthy();
      expect(within(frame).getByTestId("dt-pager")).toBeTruthy();
    });
  });

  test("card layout between sm and md: the list inside the frame has no second top line", () => {
    atViewportWidth(700, () => {
      render(<DataTable {...props} frame="card" scrollBody />);
      const list = within(screen.getByTestId("dt-frame")).getByRole("list");
      expect(list.classList.contains("border-t")).toBe(false);
    });
  });

  test("without frame there is no card and the pager stays outside the table", () => {
    atViewportWidth(1280, () => {
      render(<DataTable {...props} scrollBody />);
      expect(screen.queryByTestId("dt-frame")).toBeNull();
    });
  });

  test("below sm every card is a bordered, rounded card and there is no outer frame", () => {
    atViewportWidth(500, () => {
      render(<DataTable {...props} frame="card" />);
      expect(screen.queryByTestId("dt-frame")).toBeNull();
      const card = screen.getByTestId("row-r1");
      expect(card.classList.contains("rounded-lg")).toBe(true);
      expect(card.classList.contains("border")).toBe(true);
      expect(card.parentElement?.classList.contains("gap-2")).toBe(true);
    });
  });

  test("below sm without frame the cards stay flat rows", () => {
    atViewportWidth(500, () => {
      render(<DataTable {...props} />);
      expect(screen.getByTestId("row-r1").classList.contains("rounded-lg")).toBe(false);
    });
  });
});
