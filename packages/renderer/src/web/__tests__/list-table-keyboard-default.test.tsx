import { describe, expect, test } from "bun:test";
import type { ListTableOptions } from "@cosmicdrift/kumiko-types/screen";
import type { ReactNode } from "react";
import { type NavApi, NavProvider } from "../../app/nav.tsx";
import { useListTable } from "../../hooks/use-list-table.ts";
import { DataTable } from "./_primitives-helpers.tsx";
import { render } from "./test-utils.tsx";

const nav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "/",
  searchParams: {},
  setSearchParams: () => {},
};

const columns = [{ field: "name", label: "Name", type: "string" as const, sortable: false }];
const schemaColumns = [{ field: "name" }];
const rows = [
  { id: "r1", values: { name: "Ada" } },
  { id: "r2", values: { name: "Grace" } },
];

function List({
  table,
  storeKey,
}: {
  readonly table: ListTableOptions | undefined;
  readonly storeKey: string;
}): ReactNode {
  const { props } = useListTable({ storeKey, table, schemaColumns });
  return <DataTable columns={columns} rows={rows} testId="t" {...props} />;
}

describe("keyboard row navigation default in list screens", () => {
  test("a list screen without a table block navigates rows by keyboard", () => {
    const { container } = render(
      <NavProvider value={nav}>
        <List table={undefined} storeKey="kb-default" />
      </NavProvider>,
    );
    const keyboardRows = container.querySelectorAll("[data-keyboard-row]");
    expect(keyboardRows.length).toBe(2);
    expect(keyboardRows[0]?.getAttribute("tabindex")).toBe("0");
    expect(keyboardRows[1]?.getAttribute("tabindex")).toBe("-1");
  });

  test("keyboardNavigation: false turns the row tab stop off", () => {
    const { container } = render(
      <NavProvider value={nav}>
        <List table={{ keyboardNavigation: false }} storeKey="kb-off" />
      </NavProvider>,
    );
    expect(container.querySelectorAll("[data-keyboard-row]").length).toBe(0);
    expect(container.querySelectorAll("tr[tabindex]").length).toBe(0);
  });
});
