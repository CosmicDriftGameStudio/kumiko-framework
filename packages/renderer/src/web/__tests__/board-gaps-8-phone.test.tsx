import { describe, expect, test } from "bun:test";
import type { DataTableFacet } from "../../primitives.tsx";
import { defaultPrimitives } from "../primitives/index.tsx";
import { DefaultMetric } from "../primitives/metric.tsx";
import { DefaultRecordSteps } from "../primitives/record-steps.tsx";
import {
  fireEvent,
  render,
  restoreViewportWidthAfterEach,
  screen,
  setViewportWidth,
  within,
} from "./test-utils.tsx";

const { DataTable } = defaultPrimitives;

const statusFacet: DataTableFacet = {
  field: "__namedFilter",
  label: "To do",
  options: [],
  display: "select",
  chips: [{ id: "all", label: "All", values: [] }],
  narrowPlacement: "behind-filter",
};
const otherFacet: DataTableFacet = { field: "kind", label: "Kind", options: [] };

function renderTable(
  facets: readonly DataTableFacet[],
  filterValues: Record<string, readonly string[]> = {},
): void {
  render(
    <DataTable
      columns={[{ field: "name", label: "Name", type: "string", sortable: false }]}
      rows={[{ id: "r1", values: { name: "A" } }]}
      scrollBody
      filterFacets={facets}
      filterValues={filterValues}
      onFilterChange={() => {}}
      narrowFacets="pills"
      toolbarStart={<input aria-label="search" />}
      testId="t"
    />,
  );
}

describe("narrowPlacement behind-filter", () => {
  restoreViewportWidthAfterEach();

  test("on a phone the facet waits behind the filter icon, other facets stay inline", () => {
    setViewportWidth(500);
    renderTable([statusFacet, otherFacet]);
    expect(screen.queryByTestId("facet-__namedFilter")).toBeNull();
    expect(screen.getByTestId("facet-kind")).toBeTruthy();
    fireEvent.click(screen.getByTestId("t-filter-toggle"));
    expect(screen.getByRole("button", { name: /To do/ })).toBeTruthy();
  });

  test("an active facet behind the toggle marks the closed toggle, an idle one does not", () => {
    setViewportWidth(500);
    renderTable([statusFacet], { __namedFilter: ["todo"] });
    const toggle = screen.getByTestId("t-filter-toggle");
    expect(toggle.getAttribute("data-active")).toBe("true");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.className).toContain("border-primary");
  });

  test("an idle facet behind the toggle leaves the toggle plain", () => {
    setViewportWidth(500);
    renderTable([statusFacet]);
    const toggle = screen.getByTestId("t-filter-toggle");
    expect(toggle.getAttribute("data-active")).toBe("false");
    expect(toggle.className).not.toContain("border-primary");
  });

  test("a chips facet beside it stays inline in the flex-wrap wrapper, with one toggle only", () => {
    setViewportWidth(500);
    renderTable([
      statusFacet,
      { field: "kind", label: "Kind", options: [], chips: [{ id: "x", label: "X", values: [] }] },
    ]);
    expect(screen.getAllByTestId("t-filter-toggle")).toHaveLength(1);
    expect(screen.getByTestId("facet-kind").closest(".flex-wrap")).not.toBeNull();
    expect(screen.queryByTestId("facet-__namedFilter")).toBeNull();
  });

  test("a date range beside it joins the facet behind the one toggle", () => {
    setViewportWidth(500);
    render(
      <DataTable
        columns={[{ field: "name", label: "Name", type: "string", sortable: false }]}
        rows={[{ id: "r1", values: { name: "A" } }]}
        scrollBody
        filterFacets={[statusFacet]}
        filterValues={{}}
        onFilterChange={() => {}}
        dateRangeFacets={[{ field: "createdAt", label: "When", from: "", to: "" }]}
        onDateRangeChange={() => {}}
        toolbarStart={<input aria-label="search" />}
        testId="t"
      />,
    );
    expect(screen.queryByTestId("facet-daterange-createdAt")).toBeNull();
    fireEvent.click(screen.getByTestId("t-filter-toggle"));
    expect(screen.getAllByTestId("t-filter-toggle")).toHaveLength(1);
    expect(screen.getByTestId("facet-daterange-createdAt")).toBeTruthy();
    expect(screen.getByRole("button", { name: /To do/ })).toBeTruthy();
  });

  test("from sm the facet stands in the toolbar and there is no filter icon", () => {
    setViewportWidth(1280);
    renderTable([statusFacet, otherFacet]);
    expect(screen.getByTestId("facet-__namedFilter")).toBeTruthy();
    expect(screen.queryByTestId("t-filter-toggle")).toBeNull();
  });
});

describe("metric narrowSub", () => {
  restoreViewportWidthAfterEach();

  test("below sm the narrow sub line replaces the regular one", () => {
    setViewportWidth(500);
    render(
      <DefaultMetric label="Rent" value="1" sub="0 of 2,850.00" narrowSub="of 2,850" testId="m" />,
    );
    expect(screen.getByTestId("m-sub").textContent).toBe("of 2,850");
  });

  test("from sm the regular sub line stays", () => {
    setViewportWidth(1280);
    render(
      <DefaultMetric label="Rent" value="1" sub="0 of 2,850.00" narrowSub="of 2,850" testId="m" />,
    );
    expect(screen.getByTestId("m-sub").textContent).toBe("0 of 2,850.00");
  });
});

describe("steps panel board look", () => {
  restoreViewportWidthAfterEach();

  test("further step actions are grey 12.5px, the info toggle exists only with a reason", () => {
    setViewportWidth(1280);
    render(
      <DefaultRecordSteps
        title="Steps"
        emptyLabel="none"
        reasonLabel="Why"
        items={[
          {
            id: "a",
            title: "With reason",
            reason: "Because",
            moreActions: <button type="button">Prepare</button>,
          },
          { id: "b", title: "Without reason" },
        ]}
        testId="s"
      />,
    );
    expect(screen.getByText("Prepare").parentElement?.className).toContain("text-[12.5px]");
    expect(screen.getByTestId("record-step-a").querySelector("[aria-expanded]")).not.toBeNull();
    expect(screen.getByTestId("record-step-b").querySelector("[aria-expanded]")).toBeNull();
  });

  test("below sm further step actions stay reachable in their own row under the detail", () => {
    setViewportWidth(500);
    render(
      <DefaultRecordSteps
        title="Steps"
        emptyLabel="none"
        reasonLabel="Why"
        items={[
          {
            id: "a",
            title: "Step",
            moreActions: <button type="button">Prepare</button>,
          },
        ]}
        testId="s"
      />,
    );
    const more = screen.getByTestId("record-step-a-more-actions");
    expect(within(more).getByText("Prepare")).toBeTruthy();
    expect(more.className).not.toContain("hidden");
  });
});

describe("named-filter chips on a phone", () => {
  restoreViewportWidthAfterEach();

  test("the chips with their counts wait in the filter panel, not lost", () => {
    setViewportWidth(500);
    render(
      <DataTable
        columns={[{ field: "name", label: "Name", type: "string", sortable: false }]}
        rows={[{ id: "r1", values: { name: "A" } }]}
        scrollBody
        filterFacets={[
          {
            field: "__namedFilter",
            label: "Status",
            options: [],
            showCounts: true,
            chips: [
              { id: "all", label: "All", values: [], count: 6 },
              { id: "open", label: "Open", values: ["open"], count: 3 },
            ],
          },
        ]}
        filterValues={{}}
        onFilterChange={() => {}}
        toolbarStart={<input aria-label="search" />}
        testId="t"
      />,
    );
    fireEvent.click(screen.getByTestId("t-filter-toggle"));
    expect(screen.getByRole("button", { name: /Open\s*3/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /All\s*6/ })).toBeTruthy();
  });
});
