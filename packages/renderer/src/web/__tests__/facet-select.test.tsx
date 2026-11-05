// Chips facet with display "select": what the trigger names for an empty or a stale selection.

import { describe, expect, test } from "bun:test";
import type { DataTableFacet } from "../../primitives.tsx";
import { FacetFilter } from "../primitives/facet-filter.tsx";
import { defaultPrimitives } from "../primitives/index.tsx";
import { atViewportWidth, render, screen } from "./test-utils.tsx";

const FACET: DataTableFacet = {
  field: "__namedFilter",
  label: "Filter",
  options: [],
  display: "select",
  chips: [
    { id: "all", label: "Alle", values: [] },
    { id: "overdue", label: "Überfällig", values: ["overdue"] },
  ],
};

function triggerText(selected: readonly string[]): string | null {
  render(<FacetFilter facet={FACET} selected={selected} onChange={() => {}} />);
  return screen.getByTestId("facet-__namedFilter").textContent;
}

describe("FacetSelect trigger", () => {
  test("an empty selection names the first entry", () => {
    expect(triggerText([])).toBe("Filter: Alle");
  });

  test("a selection of an entry the facet does not offer shows only the label, not Alle", () => {
    const text = triggerText(["gone"]);
    expect(text).toBe("Filter");
    expect(text).not.toContain("Alle");
  });

  test("a selection of an offered entry names it", () => {
    expect(triggerText(["overdue"])).toBe("Filter: Überfällig");
  });
});

describe("DataTable narrowFacets pills", () => {
  const { DataTable } = defaultPrimitives;
  const tableProps = {
    columns: [{ field: "name", label: "Name", type: "string", sortable: false }],
    rows: [{ id: "r1", values: { name: "Alpha" } }],
    filterFacets: [FACET],
    filterValues: {},
    onFilterChange: () => {},
    testId: "t",
  } as const;

  function triggerClasses(): DOMTokenList {
    return screen.getByTestId("facet-__namedFilter").classList;
  }

  test("below sm the facet trigger is a rounded auto-width pill", () => {
    atViewportWidth(500, () => {
      render(<DataTable {...tableProps} narrowFacets="pills" />);
      expect(triggerClasses().contains("rounded-full")).toBe(true);
      expect(triggerClasses().contains("border-border-strong")).toBe(true);
    });
  });

  test("below sm a multi-select facet trigger is a pill too, and no pill from sm", () => {
    const multiFacet: DataTableFacet = {
      field: "status",
      label: "Status",
      options: [{ value: "open", label: "Open" }],
    };
    const multiProps = { ...tableProps, filterFacets: [multiFacet] };
    atViewportWidth(500, () => {
      const { unmount } = render(<DataTable {...multiProps} narrowFacets="pills" />);
      const classes = screen.getByTestId("facet-status").classList;
      expect(classes.contains("rounded-full")).toBe(true);
      expect(classes.contains("border-border-strong")).toBe(true);
      unmount();
    });
    atViewportWidth(1280, () => {
      render(<DataTable {...multiProps} narrowFacets="pills" />);
      expect(screen.getByTestId("facet-status").classList.contains("rounded-full")).toBe(false);
    });
  });

  test("below sm without the option the trigger is no pill", () => {
    atViewportWidth(500, () => {
      render(<DataTable {...tableProps} />);
      expect(triggerClasses().contains("rounded-full")).toBe(false);
    });
  });

  test("from sm the option has no effect", () => {
    atViewportWidth(1280, () => {
      render(<DataTable {...tableProps} narrowFacets="pills" />);
      expect(triggerClasses().contains("rounded-full")).toBe(false);
    });
  });
});
