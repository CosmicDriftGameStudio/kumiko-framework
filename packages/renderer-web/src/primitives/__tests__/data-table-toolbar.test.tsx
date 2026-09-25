import { describe, expect, test } from "bun:test";
import { createStaticLocaleResolver, LocaleProvider } from "@cosmicdrift/kumiko-renderer";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { defaultPrimitives } from "../index";

const { DataTable, Button } = defaultPrimitives;

function renderWithLocale(
  ui: ReactElement,
  translations?: Readonly<Record<string, Readonly<Record<string, string>>>>,
) {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver()}
      fallbackBundles={translations !== undefined ? [translations] : []}
    >
      {ui}
    </LocaleProvider>,
  );
}

// coa-mapping-list / statement-upload-list on a 390px viewport: toolbarEnd's
// rightmost button got cut off because neither the toolbar container nor its
// toolbarEnd wrapper allowed wrapping. happy-dom doesn't compute real layout
// (no measured widths here), so this pins the classes that make wrapping
// possible instead: both containers carry flex-wrap, and toolbarEnd's
// buttons sit inside that wrapping container rather than one that would
// force them onto a single non-wrapping row.
describe("DataTable toolbar wraps instead of overflowing on narrow viewports", () => {
  test("toolbar container and toolbarEnd wrapper both allow wrapping", () => {
    render(
      <DataTable
        columns={[]}
        rows={[]}
        testId="tbl"
        toolbarStart={<div>search</div>}
        toolbarEnd={<Button testId="tbl-action">Action</Button>}
      />,
    );

    const toolbar = screen.getByTestId("tbl-toolbar");
    expect(toolbar.className).toContain("flex-wrap");

    const actionButton = screen.getByTestId("tbl-action");
    const toolbarEndWrapper = actionButton.parentElement;
    expect(toolbarEndWrapper).not.toBeNull();
    expect(toolbarEndWrapper?.className).toContain("flex-wrap");
    expect(toolbarEndWrapper?.parentElement).toBe(toolbar);
  });
});

// Facet-Reset used a hardcoded "Reset" label regardless of UI language —
// now goes through the translation function with "Reset" only as its
// fallback string.
describe("DataTable facet-reset label goes through translation", () => {
  const filterFacets = [
    { field: "status", label: "Status", options: [{ value: "draft", label: "Draft" }] },
  ];

  test("without a LocaleProvider, falls back to the literal 'Reset'", () => {
    render(
      <DataTable
        columns={[]}
        rows={[]}
        testId="tbl"
        filterFacets={filterFacets}
        filterValues={{ status: ["draft"] }}
        onFilterChange={() => {}}
        onFilterReset={() => {}}
      />,
    );
    expect(screen.getByTestId("facet-reset").textContent).toContain("Reset");
  });

  test("with a LocaleProvider bundle for the key, renders the translation instead of the hardcoded literal", () => {
    renderWithLocale(
      <DataTable
        columns={[]}
        rows={[]}
        testId="tbl"
        filterFacets={filterFacets}
        filterValues={{ status: ["draft"] }}
        onFilterChange={() => {}}
        onFilterReset={() => {}}
      />,
      { en: { "kumiko.list.filter.reset": "Clear filters" } },
    );
    expect(screen.getByTestId("facet-reset").textContent).toContain("Clear filters");
    expect(screen.getByTestId("facet-reset").textContent).not.toContain("Reset");
  });
});
