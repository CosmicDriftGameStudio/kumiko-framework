// Class contracts for layout fixes that only a DOM test can pin: the visual
// bug (clipped card, padding inside a bordered child, cramped sheet) has no
// other observable behaviour in happy-dom.

import { describe, expect, test } from "bun:test";
import { defaultPrimitives } from "../primitives/index.js";
import { Sidebar, SidebarContent, SidebarProvider, SidebarTrigger } from "../ui/sidebar.js";
import { fireEvent, render, screen, within } from "./test-utils.js";

const { DataTable, Form, GridCell, Grid } = defaultPrimitives;

function withViewportWidth(width: number, run: () => void): void {
  const happyDom = (window as unknown as { happyDOM: { setInnerWidth: (n: number) => void } })
    .happyDOM;
  const originalWidth = window.innerWidth;
  happyDom.setInnerWidth(width);
  try {
    run();
  } finally {
    happyDom.setInnerWidth(originalWidth);
  }
}

describe("DataTable cards: right padding follows the row menu", () => {
  const columns = [{ field: "name", label: "Name", type: "string", sortable: false }] as const;
  const rows = [{ id: "r1", values: { name: "Anna" } }];

  test("no row actions: pr-4, so the content does not touch the edge", () => {
    withViewportWidth(500, () => {
      render(<DataTable columns={columns} rows={rows} testId="t" />);
      const card = screen.getByTestId("row-r1");
      expect(card.className).toContain("pr-4");
      expect(card.className).not.toContain("pr-2");
    });
  });

  test("with a menu action: pr-2, the menu button supplies the remaining space", () => {
    withViewportWidth(500, () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          rowActions={[{ id: "edit", label: "Edit", onTrigger: () => {} }]}
          testId="t"
        />,
      );
      const card = screen.getByTestId("row-r1");
      expect(card.className).toContain("pr-2");
      expect(card.className).not.toContain("pr-4");
    });
  });
});

describe("DataTable cells: numbers right-aligned, digit columns tabular", () => {
  const columns = [
    { field: "amount", label: "Amount", type: "number", sortable: false },
    { field: "due", label: "Due", type: "date", sortable: false },
    { field: "name", label: "Name", type: "string", sortable: false },
  ] as const;
  const rows = [{ id: "r1", values: { amount: 1200, due: "2026-01-15", name: "Anna" } }];

  test("numeric cell is right-aligned and tabular", () => {
    withViewportWidth(1024, () => {
      render(<DataTable columns={columns} rows={rows} testId="t" />);
      const cell = screen.getByTestId("cell-r1-amount").closest("td");
      expect(cell?.className).toContain("text-right");
      expect(cell?.className).toContain("tabular-nums");
    });
  });

  test("date cell is tabular but keeps its left alignment; text cells are neither", () => {
    withViewportWidth(1024, () => {
      render(<DataTable columns={columns} rows={rows} testId="t" />);
      const dateCell = screen.getByTestId("cell-r1-due").closest("td");
      expect(dateCell?.className).toContain("tabular-nums");
      expect(dateCell?.className).not.toContain("text-right");
      const textCell = screen.getByTestId("cell-r1-name").closest("td");
      expect(textCell?.className).not.toContain("tabular-nums");
    });
  });
});

describe("Form body", () => {
  test("a non-section child gets margins instead of padding", () => {
    render(
      <Form onSubmit={() => {}} testId="f">
        <div data-testid="child">custom</div>
      </Form>,
    );
    const className = screen.getByTestId("child").parentElement?.className ?? "";
    expect(className).toContain("[&>:not(section)]:mx-6");
    expect(className).toContain("[&>:not(section)]:my-3");
    expect(className).not.toContain("[&>:not(section)]:px-6");
  });
});

describe("GridCell width", () => {
  test("timestamp cells are full width on mobile and a fixed width from sm", () => {
    render(
      <Grid columns={2} flow>
        <GridCell width="timestamp">
          <span data-testid="ts" />
        </GridCell>
      </Grid>,
    );
    const className = screen.getByTestId("ts").parentElement?.className ?? "";
    expect(className).toContain("w-full");
    expect(className).toContain("sm:w-[328px]");
  });
});

describe("GridCell toggle width", () => {
  test("toggle cells align to the top line and centre the switch on the input line", () => {
    render(
      <Grid columns={2} flow>
        <GridCell width="toggle">
          <span data-testid="tg" />
        </GridCell>
      </Grid>,
    );
    const className = screen.getByTestId("tg").parentElement?.className ?? "";
    expect(className).toContain("self-start");
    expect(className).toContain("min-w-40");
    expect(className).toContain("[&_[data-slot=switch]]:my-[0.55rem]");
  });
});

describe("SidebarContent", () => {
  test("keeps bottom padding and fades the scrolled content out", () => {
    render(<SidebarContent data-testid="nav">x</SidebarContent>);
    const className = screen.getByTestId("nav").className;
    expect(className).toContain("pb-4");
    expect(className).toContain("mask-image");
  });
});

describe("mobile sidebar sheet", () => {
  test("the sheet content has inner padding", () => {
    withViewportWidth(500, () => {
      render(
        <SidebarProvider>
          <SidebarTrigger data-testid="open" />
          <Sidebar>
            <span data-testid="nav-content">nav</span>
          </Sidebar>
        </SidebarProvider>,
      );
      fireEvent.click(screen.getByTestId("open"));
      const sheet = document.querySelector("[data-mobile='true']") as HTMLElement | null;
      expect(sheet).not.toBeNull();
      const inner = within(sheet as HTMLElement)
        .getByTestId("nav-content")
        .closest("div");
      expect(inner?.className).toContain("px-2");
      expect(inner?.className).toContain("py-3");
    });
  });
});
