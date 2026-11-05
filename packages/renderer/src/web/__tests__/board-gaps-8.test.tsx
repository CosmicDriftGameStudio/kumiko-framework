import { describe, expect, mock, test } from "bun:test";
import type { DataTableFacet } from "../../primitives.tsx";
import { sortSummaryText } from "../primitives/data-table/sort-options-select.tsx";
import type { DataTableModel } from "../primitives/data-table/use-data-table-state.ts";
import { FacetFilter } from "../primitives/facet-filter.tsx";
import { defaultPrimitives } from "../primitives/index.tsx";
import { DefaultMetric } from "../primitives/metric.tsx";
import { StatCard } from "../widgets/stat.tsx";
import { atViewportWidth, fireEvent, render, screen } from "./test-utils.tsx";

const { DataTable } = defaultPrimitives;

const facet: DataTableFacet = {
  field: "state",
  label: "Status",
  options: [],
  display: "select",
  showCounts: true,
  chips: [
    { id: "action", label: "Handlungsbedarf", values: ["a"], count: 4, separatorAfter: true },
    { id: "all", label: "Alle", values: [], count: 26 },
  ],
};

describe("select facet", () => {
  test("a set filter shows key and value separately, the value in primary", () => {
    render(<FacetFilter facet={facet} selected={["a"]} onChange={() => {}} />);
    const trigger = screen.getByTestId("facet-state");
    expect(trigger.textContent).toBe("Status: Handlungsbedarf");
    const value = screen.getByTestId("facet-state-value");
    expect(value.classList.contains("text-primary")).toBe(true);
    expect(trigger.classList.contains("border-primary")).toBe(true);
  });

  test("the trigger is a button with a popup and a visible name, findable by role", () => {
    render(<FacetFilter facet={facet} selected={[]} onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: /Status/ });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  });

  test("an unset filter keeps the value in foreground and the border neutral", () => {
    render(<FacetFilter facet={facet} selected={[]} onChange={() => {}} />);
    expect(screen.getByTestId("facet-state-value").classList.contains("text-primary")).toBe(false);
    expect(screen.getByTestId("facet-state").classList.contains("border-primary")).toBe(false);
  });

  test("the open menu right-aligns counters and draws a separator after a chip with separatorAfter", () => {
    render(<FacetFilter facet={facet} selected={[]} onChange={() => {}} />);
    fireEvent.pointerDown(screen.getByTestId("facet-state"), { button: 0, ctrlKey: false });
    const first = screen.getByTestId("facet-state-action");
    expect(first.querySelector(".ml-auto")?.textContent).toBe("4");
    expect(first.nextElementSibling?.getAttribute("role")).toBe("separator");
    expect(screen.getByTestId("facet-state-all").nextElementSibling).toBeNull();
  });
});

describe("pager footer", () => {
  test("status has no noun, the page-size select has no arrow, the current page is primary", () => {
    render(
      <DataTable
        columns={[{ field: "name", label: "Name", type: "text", sortable: false }]}
        rows={[{ id: "r1", values: { name: "A" } }]}
        testId="dt"
        itemNoun={() => "Verträge"}
        pager={{
          page: 1,
          limit: 10,
          total: 26,
          onPageChange: mock(),
          pageSizeOptions: [10, 25],
          onPageSizeChange: mock(),
        }}
      />,
    );
    expect(screen.getByTestId("dt-pager-status").textContent).toBe("1–10 of 26");
    const select = screen.getByTestId("dt-pager-page-size");
    expect(select.parentElement?.querySelector("svg")).toBeNull();
    const current = screen.getByTestId("dt-pager-page-1");
    expect(current.classList.contains("bg-primary")).toBe(true);
    expect(screen.getByTestId("dt-pager-page-2").classList.contains("bg-primary")).toBe(false);
  });
});

describe("table footer rows", () => {
  test("the sticky actions cell of the footer keeps the footer background", () => {
    atViewportWidth(1280, () => {
      render(
        <DataTable
          columns={[{ field: "rent", label: "Miete", type: "number", sortable: false }]}
          rows={[{ id: "r1", values: { rent: 10 } }]}
          testId="dt"
          rowActions={[{ id: "pay", label: "Pay", display: "button", onTrigger: mock() }] as never}
          totals={{ measures: [{ field: "rent", kind: "count", value: 1 }] }}
        />,
      );
      const footerCells = [...document.querySelectorAll("tfoot td, tfoot th")];
      const stickyCell = footerCells.find((cell) => cell.classList.contains("md:sticky"));
      expect(stickyCell).toBeDefined();
      expect(stickyCell?.classList.contains("md:bg-muted")).toBe(true);
    });
  });
});

describe("sort summary", () => {
  function model(total: number, tableTranslate?: DataTableModel["tableTranslate"]): DataTableModel {
    return {
      sortOptions: [{ field: "term", dir: "desc", label: "Dringlichkeit" }],
      sort: { field: "term", dir: "desc" },
      rows: [],
      pager: { total },
      itemNoun: (count: number) => (count === 1 ? "Vertrag" : "Verträge"),
      tableTranslate,
    } as unknown as DataTableModel;
  }
  const bundle: Record<string, string> = {
    "kumiko.list.sort.summary": "Nach {sort} {direction} · {count} {noun}",
  };
  const translate = (key: string, vars?: Record<string, unknown>): string => {
    const text = bundle[key];
    if (text === undefined) return key;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));
  };

  test("reads the sentence from one key with the formatted count and the noun of the total", () => {
    expect(sortSummaryText(model(1, translate))).toBe("Nach Dringlichkeit ↓ · 1 Vertrag");
    expect(sortSummaryText(model(1234, translate))).toBe(
      `Nach Dringlichkeit ↓ · ${(1234).toLocaleString()} Verträge`,
    );
  });
});

describe("stat tiles", () => {
  test("an inset tile uses the page background without shadow", () => {
    render(<StatCard label="Offen" value="4" tone="warn" inset testId="tile" />);
    const tile = screen.getByTestId("tile");
    expect(tile.classList.contains("bg-background")).toBe(true);
    expect(tile.classList.contains("shadow-none")).toBe(true);
    expect(tile.classList.contains("border-l-status-warn")).toBe(true);
  });

  test("a detail metric tile puts sub on its own line under the value", () => {
    render(<DefaultMetric label="Miete" value="1.200" sub="netto" tile testId="metric" />);
    const sub = document.querySelector('[data-kumiko-layout="stat-card-sub"]');
    expect(sub?.textContent).toBe("netto");
    expect(screen.getByTestId("metric").classList.contains("bg-background")).toBe(false);
  });
});
