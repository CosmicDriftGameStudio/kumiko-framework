import { describe, expect, test } from "bun:test";
import type { NamedListFilterRef } from "@cosmicdrift/kumiko-types/named-list-filters";
import userEvent from "@testing-library/user-event";
import {
  buildNamedFilterCountQueries,
  buildNamedFilterFacet,
} from "../../app/named-filter-facet.ts";
import { readNotice } from "../../app/projection-detail-guidance-data.ts";
import type { DataTableFacet } from "../../primitives.tsx";
import { SortOptionsSelect } from "../primitives/data-table/sort-options-select.tsx";
import { FacetFilter } from "../primitives/facet-filter.tsx";
import { defaultPrimitives } from "../primitives/index.tsx";
import { DefaultRecordSteps } from "../primitives/record-steps.tsx";
import { render, restoreViewportWidthAfterEach, screen, setViewportWidth } from "./test-utils.tsx";

const { DataTable, Banner } = defaultPrimitives;

const NAME_COLUMN = { field: "name", label: "Name", type: "string", sortable: false } as const;
const ONE_ROW = [{ id: "r1", values: { name: "Alpha" } }];

describe("facet trigger label (F3)", () => {
  const multiFacet: DataTableFacet = {
    field: "status",
    label: "Status",
    options: [{ value: "open", label: "Open" }],
  };

  test("a multi-select facet splits the grey label from the value and keeps textContent", () => {
    render(<FacetFilter facet={multiFacet} selected={[]} onChange={() => {}} />);
    const trigger = screen.getByTestId("facet-status");
    expect(trigger.textContent).toBe("Status: All");
    expect(trigger.querySelector("span")?.className).toContain("text-muted-foreground");
    expect(screen.getByTestId("facet-status-value").textContent).toBe("All");
  });

  test("a pill with nothing chosen names the facet only", () => {
    render(<FacetFilter facet={multiFacet} selected={[]} onChange={() => {}} pill />);
    expect(screen.getByTestId("facet-status").textContent).toBe("Status");
    expect(screen.queryByTestId("facet-status-value")).toBeNull();
  });

  test("a searchable facet gets the same split and the pill shape", () => {
    const searchFacet: DataTableFacet = { ...multiFacet, onSearchChange: () => {} };
    const { unmount } = render(
      <FacetFilter facet={searchFacet} selected={[]} onChange={() => {}} />,
    );
    expect(screen.getByTestId("facet-status-value").textContent).toBe("All");
    unmount();
    render(<FacetFilter facet={searchFacet} selected={[]} onChange={() => {}} pill />);
    const trigger = screen.getByTestId("facet-status");
    expect(trigger.textContent).toBe("Status");
    expect(trigger.classList.contains("rounded-full")).toBe(true);
  });

  test("the sort select splits prefix and active label into two spans", () => {
    render(
      <SortOptionsSelect
        options={[{ field: "due", dir: "desc", label: "Urgency" }]}
        sort={{ field: "due", dir: "desc" }}
        onSortChange={() => {}}
        testId="s"
      />,
    );
    expect(screen.getByTestId("s-label").textContent).toBe("Sorted by: Urgency");
    expect(screen.getByTestId("s-value").textContent).toBe("Urgency");
  });
});

describe("behind-filter on a list that does not fill its height (F4)", () => {
  restoreViewportWidthAfterEach();

  test("below sm the search and the filter toggle share the toolbar row, the search fills the rest", () => {
    setViewportWidth(500);
    render(
      <DataTable
        columns={[NAME_COLUMN]}
        rows={ONE_ROW}
        filterFacets={[
          {
            field: "__namedFilter",
            label: "To do",
            options: [],
            display: "select",
            chips: [{ id: "all", label: "All", values: [] }],
            narrowPlacement: "behind-filter",
          },
          { field: "kind", label: "Kind", options: [] },
        ]}
        filterValues={{}}
        onFilterChange={() => {}}
        toolbarStart={<input aria-label="search" />}
        testId="t"
      />,
    );
    const toggle = screen.getByTestId("t-filter-toggle");
    const searchWrapper = screen.getByLabelText("search").parentElement;
    expect(searchWrapper?.parentElement).toBe(toggle.parentElement);
    expect(searchWrapper?.className).toContain("max-sm:max-w-none");
    expect(screen.queryByTestId("facet-__namedFilter")).toBeNull();
    expect(screen.getByTestId("facet-kind")).toBeTruthy();
  });
});

describe("named filter hideEmpty (F5)", () => {
  const refs: readonly NamedListFilterRef[] = [
    { id: "todo", label: "To do" },
    { id: "done", label: "Done" },
  ];
  const translate = (key: string): string => key;

  test("buildNamedFilterFacet passes hideEmpty on and asks for the counts without showCounts", () => {
    const options = { display: "select", hideEmpty: true } as const;
    const facet = buildNamedFilterFacet(refs, translate, undefined, options, {
      "__namedFilter:todo": 2,
    });
    expect(facet?.hideEmpty).toBe(true);
    expect(facet?.showCounts).toBeUndefined();
    expect(buildNamedFilterCountQueries(refs, undefined, options, () => ({}))).toHaveLength(3);
  });

  const facet: DataTableFacet = {
    field: "__namedFilter",
    label: "Filter",
    options: [],
    display: "select",
    showCounts: true,
    hideEmpty: true,
    chips: [
      { id: "all", label: "All", values: [], count: 0 },
      { id: "todo", label: "To do", values: ["todo"], count: 2 },
      { id: "done", label: "Done", values: ["done"], count: 0 },
    ],
  };

  test("the select menu leaves out an entry at 0 but keeps All", async () => {
    render(<FacetFilter facet={facet} selected={[]} onChange={() => {}} />);
    await userEvent.setup().click(screen.getByTestId("facet-__namedFilter"));
    expect(await screen.findByTestId("facet-__namedFilter-todo")).toBeTruthy();
    expect(screen.getByTestId("facet-__namedFilter-all")).toBeTruthy();
    expect(screen.queryByTestId("facet-__namedFilter-done")).toBeNull();
  });

  test("the active entry stays at 0 and every counter stays grey, also on the checked entry", async () => {
    render(<FacetFilter facet={facet} selected={["done"]} onChange={() => {}} />);
    await userEvent.setup().click(screen.getByTestId("facet-__namedFilter"));
    const checked = await screen.findByTestId("facet-__namedFilter-done");
    expect(checked.getAttribute("aria-checked")).toBe("true");
    const counter = checked.querySelector(".tabular-nums");
    expect(counter?.textContent).toBe("0");
    expect(counter?.className).toContain("text-muted-foreground");
  });
});

describe("empty list inside a card frame (F6)", () => {
  restoreViewportWidthAfterEach();

  test("from sm the header row stays and the empty state sits in the same card without its own border", () => {
    setViewportWidth(1280);
    render(<DataTable columns={[NAME_COLUMN]} rows={[]} frame="card" testId="t" />);
    const frame = screen.getByTestId("t-frame");
    expect(frame.querySelector("th")?.textContent).toContain("Name");
    const empty = screen.getByTestId("t-empty");
    expect(frame.contains(empty)).toBe(true);
    expect(empty.className).not.toContain("border-border-row");
  });

  test("below sm and without a frame the empty state stays a plain block", () => {
    setViewportWidth(500);
    const { unmount } = render(
      <DataTable columns={[NAME_COLUMN]} rows={[]} frame="card" testId="t" />,
    );
    expect(document.querySelector("th")).toBeNull();
    expect(screen.getByTestId("t-empty")).toBeTruthy();
    unmount();
    setViewportWidth(1280);
    render(<DataTable columns={[NAME_COLUMN]} rows={[]} testId="plain" />);
    expect(document.querySelector("th")).toBeNull();
    expect(screen.getByTestId("plain-empty").className).toContain("border-border-row");
  });
});

describe("hint narrowField (F7)", () => {
  restoreViewportWidthAfterEach();

  const hintColumn = {
    field: "next",
    label: "Next",
    type: "text",
    sortable: false,
    hint: { emptyLabel: "Nothing open", reasonLabel: "Why?", narrowField: "nextShort" },
  } as const;
  const rowWith = (nextShort: string) => [
    { id: "r1", values: { next: "Send the reminder letter today", nextShort } },
  ];

  test("the card shows the short sentence, the table keeps the column value", () => {
    setViewportWidth(500);
    const { unmount } = render(
      <DataTable columns={[hintColumn]} rows={rowWith("Remind")} testId="c" />,
    );
    expect(screen.getByText("Remind")).toBeTruthy();
    expect(screen.queryByText("Send the reminder letter today")).toBeNull();
    unmount();
    setViewportWidth(1280);
    render(<DataTable columns={[hintColumn]} rows={rowWith("Remind")} testId="t" />);
    expect(screen.getByText("Send the reminder letter today")).toBeTruthy();
    expect(screen.queryByText("Remind")).toBeNull();
  });

  test("an empty short sentence falls back to the column value on the card", () => {
    setViewportWidth(500);
    render(<DataTable columns={[hintColumn]} rows={rowWith("")} testId="c" />);
    expect(screen.getByText("Send the reminder letter today")).toBeTruthy();
  });
});

describe("step narrowTitle (F8)", () => {
  restoreViewportWidthAfterEach();

  function renderStep(): void {
    render(
      <DefaultRecordSteps
        title="Steps"
        emptyLabel="none"
        reasonLabel="Why"
        items={[{ id: "a", title: "Send the first reminder", narrowTitle: "Remind" }]}
        testId="s"
      />,
    );
  }

  test("below sm the short title replaces the title", () => {
    setViewportWidth(500);
    renderStep();
    expect(screen.getByText("Remind")).toBeTruthy();
    expect(screen.queryByText("Send the first reminder")).toBeNull();
  });

  test("from sm the full title shows", () => {
    setViewportWidth(1280);
    renderStep();
    expect(screen.getByText("Send the first reminder")).toBeTruthy();
    expect(screen.queryByText("Remind")).toBeNull();
  });
});

describe("banner narrowTitle and narrowText (F9)", () => {
  restoreViewportWidthAfterEach();

  function renderBanner(): void {
    render(
      <Banner
        variant="warning"
        inline
        title="Payment overdue since 3 March"
        narrowTitle="Overdue"
        narrowText="Pay now"
        parts={[{ text: "Structured rest" }]}
        testId="b"
      >
        The tenant has not paid the rent for March.
      </Banner>,
    );
  }

  test("below sm the short title and short text replace both, the text stays visible", () => {
    setViewportWidth(500);
    renderBanner();
    const banner = screen.getByTestId("b");
    expect(banner.textContent).toContain("Overdue");
    expect(banner.textContent).toContain("Pay now");
    expect(banner.textContent).not.toContain("Payment overdue");
    expect(banner.textContent).not.toContain("The tenant");
    expect(banner.textContent).not.toContain("Structured rest");
    expect(screen.getByText("Pay now").className).not.toContain("max-sm:hidden");
  });

  test("from sm title and text are unchanged", () => {
    setViewportWidth(1280);
    renderBanner();
    const banner = screen.getByTestId("b");
    expect(banner.textContent).toContain("Payment overdue since 3 March");
    expect(banner.textContent).toContain("The tenant has not paid");
    expect(banner.textContent).toContain("Structured rest");
    expect(banner.textContent).not.toContain("Overdue");
  });

  test("a notice passes its short forms on and ignores malformed ones", () => {
    expect(readNotice({ title: "Full", narrowTitle: "Short", narrowText: "Brief" })).toMatchObject({
      narrowTitle: "Short",
      narrowText: "Brief",
    });
    const malformed = readNotice({ title: "Full", narrowTitle: 4, narrowText: "" });
    expect(malformed?.narrowTitle).toBeUndefined();
    expect(malformed?.narrowText).toBeUndefined();
  });
});
