import { describe, expect, mock, test } from "bun:test";
import { defaultPrimitives } from "../primitives/index.tsx";
import { atViewportWidth, render, screen, within } from "./test-utils.tsx";

const { DataTable } = defaultPrimitives;

const STATEMENT_COLUMNS = [
  { field: "property", label: "Property", type: "string", sortable: false },
  {
    field: "from",
    label: "From",
    type: "date",
    sortable: false,
    narrowInline: true,
    cardAbove: true,
  },
  { field: "to", label: "To", type: "date", sortable: false, narrowInline: true, cardAbove: true },
  { field: "status", label: "Status", type: "select", sortable: false },
  { field: "result", label: "Result", type: "string", sortable: false, cardLabel: true },
  { field: "reportFiles", label: "Report", type: "files", sortable: false },
] as const;

function statementRow(reportFiles: unknown) {
  return {
    id: "s1",
    values: {
      from: "2026-07-01",
      to: "2026-09-30",
      property: "Lindenstraße 12",
      status: "payout-created",
      result: "0,00 €",
      reportFiles,
    },
  };
}

describe("phone card layout", () => {
  test("a long status badge wraps below the title instead of truncating it", () => {
    atViewportWidth(500, () => {
      render(<DataTable columns={STATEMENT_COLUMNS} rows={[statementRow(null)]} testId="t" />);
      const title = screen.getByTestId("cell-s1-property");
      expect(title.className).toContain("max-w-full");
      expect(title.parentElement?.className).toContain("flex-wrap");
    });
  });

  test("two unlabeled dates above the title read as a range", () => {
    atViewportWidth(500, () => {
      render(<DataTable columns={STATEMENT_COLUMNS} rows={[statementRow(null)]} testId="t" />);
      const line = screen.getByTestId("card-vals-s1-from");
      const parts = [...line.children].map((child) => child.textContent);
      expect(parts).toHaveLength(3);
      expect(parts[1]).toBe("–");
    });
  });

  test("two unlabeled dates below the title stay separate dates, not a range", () => {
    const columns = [
      { field: "property", label: "Property", type: "string", sortable: false },
      {
        field: "createdAt",
        label: "Created",
        type: "timestamp",
        sortable: false,
        narrowInline: true,
      },
      { field: "dueAt", label: "Due", type: "timestamp", sortable: false, narrowInline: true },
    ] as const;
    const row = {
      id: "s1",
      values: {
        property: "Lindenstraße 12",
        createdAt: "2026-07-01T09:00:00Z",
        dueAt: "2026-09-30T09:00:00Z",
      },
    };
    atViewportWidth(500, () => {
      render(<DataTable columns={columns} rows={[row]} testId="t" />);
      const line = screen.getByTestId("card-vals-s1-createdAt");
      expect([...line.children].map((child) => child.textContent)).not.toContain("–");
    });
  });

  test("an empty file list takes no meta line", () => {
    atViewportWidth(500, () => {
      render(<DataTable columns={STATEMENT_COLUMNS} rows={[statementRow([])]} testId="t" />);
      expect(within(screen.getByTestId("row-s1")).queryByTestId("cell-s1-reportFiles")).toBeNull();
    });
  });

  test("row actions sit beside the title, the meta lines span the full card", () => {
    atViewportWidth(500, () => {
      render(
        <DataTable
          columns={STATEMENT_COLUMNS}
          rows={[statementRow(null)]}
          rowActions={[{ id: "edit", label: "Edit", onTrigger: mock() }]}
          testId="t"
        />,
      );
      const card = screen.getByTestId("row-s1");
      const cardChild = (testId: string): Element | undefined =>
        [...card.children].find((child) => within(child as HTMLElement).queryByTestId(testId));
      const metaBlock = cardChild("card-meta-s1");
      const titleBlock = cardChild("cell-s1-property");
      const menuBlock = cardChild("row-s1-action-edit");
      expect(metaBlock?.className).toContain("basis-full");
      expect(cardChild("card-above-s1")?.className).toContain("basis-full");
      expect(titleBlock).not.toBe(metaBlock);
      expect(menuBlock).not.toBe(metaBlock);
      const order = [...card.children];
      expect(order.indexOf(menuBlock as Element)).toBe(order.indexOf(titleBlock as Element) + 1);
    });
  });
});

describe("plain phone card: values on one line", () => {
  const OFFER_COLUMNS = [
    { field: "vendor", label: "Vendor", type: "string", sortable: false },
    { field: "amount", label: "Amount", type: "money", sortable: false, narrowInline: true },
    { field: "receivedOn", label: "Received", type: "date", sortable: false, narrowInline: true },
  ] as const;
  const offerRow = {
    id: "o1",
    values: {
      vendor: "Schmidt Haustechnik",
      amount: { amount: 98000, currency: "EUR" },
      receivedOn: "2026-10-29",
    },
  };

  // An app stylesheet may widen the line's column gap; a comma standing as its own item would
  // then float between two gaps.
  test("the comma sticks to the front value instead of standing as its own item", () => {
    atViewportWidth(390, () => {
      render(<DataTable columns={OFFER_COLUMNS} rows={[offerRow]} plainPhoneCards testId="t" />);
      const line = screen.getByTestId("card-vals-o1-amount");
      const items = [...line.children];
      expect(items).toHaveLength(2);
      const amountText = screen.getByTestId("cell-o1-amount").textContent;
      expect(items[0]?.textContent).toBe(`${amountText},`);
      expect(items[1]?.textContent).toBe(screen.getByTestId("cell-o1-receivedOn").textContent);
    });
  });

  // App stylesheets set the line height on the line's direct children; the front value sits one
  // level deeper next to its comma and must follow that item, not fix its own.
  test("the front value takes the line height of its item", () => {
    atViewportWidth(390, () => {
      render(<DataTable columns={OFFER_COLUMNS} rows={[offerRow]} plainPhoneCards testId="t" />);
      const frontValue = screen.getByTestId("cell-o1-amount");
      expect(frontValue.className).toContain("leading-[inherit]");
      expect(frontValue.className).not.toContain("leading-5");
      expect(screen.getByTestId("cell-o1-receivedOn").className).toContain("leading-5");
    });
  });

  test("a date range keeps its dash flush between the dates", () => {
    atViewportWidth(390, () => {
      render(
        <DataTable
          columns={STATEMENT_COLUMNS}
          rows={[statementRow(null)]}
          plainPhoneCards
          testId="t"
        />,
      );
      const line = screen.getByTestId("card-vals-s1-from");
      expect(line.className).toContain("gap-x-0");
      expect([...line.children].map((child) => child.textContent)[1]).toBe("–");
    });
  });
});
