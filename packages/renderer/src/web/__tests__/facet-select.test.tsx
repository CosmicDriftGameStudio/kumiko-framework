// Chips facet with display "select": what the trigger names for an empty or a stale selection.

import { describe, expect, test } from "bun:test";
import type { DataTableFacet } from "../../primitives.tsx";
import { FacetFilter } from "../primitives/facet-filter.tsx";
import { render, screen } from "./test-utils.tsx";

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
