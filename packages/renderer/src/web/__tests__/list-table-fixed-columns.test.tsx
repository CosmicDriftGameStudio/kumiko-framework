import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { type NavApi, NavProvider } from "../../app/nav.tsx";
import { useListTable } from "../../hooks/use-list-table.ts";
import { DataTable } from "./_primitives-helpers.tsx";
import { render, screen } from "./test-utils.tsx";

const nav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "/",
  searchParams: {},
  setSearchParams: () => {},
};

const columns = [
  { field: "name", label: "Name", type: "string" as const, sortable: false },
  { field: "intent", label: "Intent", type: "string" as const, sortable: false },
];
const schemaColumns = [{ field: "name" }, { field: "intent", hidden: true }];
const rows = [{ id: "r1", values: { name: "Ada", intent: "buy" } }];

function ListWithoutColumnPicker(): ReactNode {
  const { props } = useListTable({
    storeKey: "fixed-columns",
    table: {},
    schemaColumns,
  });
  return <DataTable columns={columns} rows={rows} testId="t" {...props} />;
}

describe("a list without columnPicker and a hidden column", () => {
  test("the hidden column stays out of the table and no view menu opens", () => {
    render(
      <NavProvider value={nav}>
        <ListWithoutColumnPicker />
      </NavProvider>,
    );
    expect(screen.getByTestId("cell-r1-name")).toBeTruthy();
    expect(screen.queryByTestId("cell-r1-intent")).toBeNull();
    expect(screen.queryByText("buy")).toBeNull();
    expect(screen.queryByTestId("list-view-menu")).toBeNull();
  });
});
