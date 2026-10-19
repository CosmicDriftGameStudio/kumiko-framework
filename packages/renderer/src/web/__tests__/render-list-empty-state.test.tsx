import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { fireEvent } from "@testing-library/react";
import { RenderList } from "../../index.ts";
import { PageHeaderSlotProvider } from "../layout/page-header-slot.tsx";
import { ShellHeader } from "../layout/shell-header.tsx";
import { render, renderWithSidebar } from "./test-utils.tsx";

const entity = {
  fields: { name: { type: "text", sortable: true } },
} as unknown as EntityDefinition;

const screen: EntityListScreenDefinition = {
  id: "order-list",
  type: "entityList",
  entity: "order",
  columns: ["name"],
};

function renderEmptyList(props: Partial<Parameters<typeof RenderList>[0]>) {
  return render(
    <RenderList screen={screen} entity={entity} rows={[]} featureName="shop" {...props} />,
  );
}

describe("RenderList — empty state", () => {
  test("the default box offers the create button", () => {
    const { getByText, getByTestId } = renderEmptyList({ onCreate: () => {} });
    expect(getByText("No entries yet.")).toBeDefined();
    expect(getByText("Create the first one to get started.")).toBeDefined();
    expect(getByTestId("render-list-empty-create")).toBeDefined();
  });

  test("an authored empty state replaces title and hint but keeps the create button", () => {
    const { getByText, queryByText, getByTestId } = renderEmptyList({
      onCreate: () => {},
      emptyContent: { title: "No leases open", description: "Leases appear after activation." },
    });
    expect(getByText("No leases open")).toBeDefined();
    expect(getByText("Leases appear after activation.")).toBeDefined();
    expect(queryByText("Create the first one to get started.")).toBeNull();
    expect(getByTestId("render-list-empty-create")).toBeDefined();
  });

  test("the authored action button triggers its handler", () => {
    const onPress = mock(() => {});
    const { getByTestId } = renderEmptyList({
      emptyContent: {
        title: "No leases open",
        action: { id: "import", label: "Import leases", onPress },
      },
    });
    fireEvent.click(getByTestId("render-edit-action-import"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("a narrowed list says nothing matches instead of inviting to create", () => {
    const { getByText, queryByText, queryByTestId } = renderEmptyList({
      onCreate: () => {},
      narrowed: true,
      emptyContent: { title: "No leases open" },
    });
    expect(getByText("No entries match the current search or filters.")).toBeDefined();
    expect(queryByText("No leases open")).toBeNull();
    expect(queryByTestId("render-list-empty-create")).toBeNull();
  });

  test("the description sits in its own row below the toolbar", () => {
    const { getByTestId, container } = renderEmptyList({
      searchable: true,
      description: "Open leases of the current month",
    });
    expect(getByTestId("render-list-table-description").textContent).toBe(
      "Open leases of the current month",
    );
    expect(container.querySelector("#render-list-search")).not.toBeNull();
    const toolbar = getByTestId("render-list-table-toolbar");
    expect(toolbar.contains(getByTestId("render-list-table-description"))).toBe(false);
  });

  test("with create in the page header the empty state shows no second create button", () => {
    const { getByTestId, getByText, queryByTestId } = renderWithSidebar(
      <PageHeaderSlotProvider>
        <ShellHeader schema={{ features: [] }} />
        <RenderList
          screen={screen}
          entity={entity}
          rows={[]}
          featureName="shop"
          onCreate={() => {}}
        />
      </PageHeaderSlotProvider>,
    );
    expect(getByTestId("render-list-create")).toBeDefined();
    expect(getByText("No entries yet.")).toBeDefined();
    expect(queryByTestId("render-list-empty-create")).toBeNull();
  });

  test("the description always carries the standard bottom spacing and form typography", () => {
    const { getByTestId } = renderEmptyList({ description: "Open leases" });
    const cls = getByTestId("render-list-table-description").className;
    expect(cls).toContain("pb-2");
    expect(cls).toContain("text-sm");
  });
});
