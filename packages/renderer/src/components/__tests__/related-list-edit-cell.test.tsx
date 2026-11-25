// A relatedList column with `edit` shows a select where `when` holds; a choice writes through the
// column's handler and reloads the list and the host once.

import { describe, expect, test } from "bun:test";
import { createEntity, createSelectField } from "@cosmicdrift/kumiko-framework/engine";
import { act, fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { AppFeaturesProvider } from "../../app/app-features-context.tsx";
import type { FeatureSchema } from "../../app/feature-schema.ts";
import { type NavApi, NavProvider } from "../../app/nav.tsx";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { EditRelatedListSectionViewModel } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import { type DataTableProps, PrimitivesProvider } from "../../primitives.tsx";
import { createMockDispatcher, createStubPrimitives } from "../../testing.ts";
import { RelatedListSection } from "../related-list-section.tsx";

const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const nav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "#",
  searchParams: {},
  setSearchParams: () => {},
};

// Draws the editor the section hands over as a native select, like the web table does.
const editorTable: ComponentType<DataTableProps> = ({ rows, columns, cellEditor }) => (
  <table>
    <tbody>
      {rows.map((row) => {
        const editor = cellEditor?.(row, columns[0]?.field ?? "status");
        return (
          <tr key={row.id} data-testid={`row-${row.id}`}>
            <td>
              {editor === undefined ? (
                <span data-testid={`value-${row.id}`}>{String(row.values["status"])}</span>
              ) : (
                <select
                  data-testid={`editor-${row.id}`}
                  data-required={String(editor.required)}
                  value={editor.value ?? ""}
                  onChange={(e) => editor.onChange(e.target.value)}
                >
                  {editor.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
);

const itemEntity = createEntity({
  name: "item",
  table: "read_test_edit_cell_items",
  fields: { status: createSelectField({ options: ["open", "done"] as const }) },
});

const schema: FeatureSchema = {
  featureName: "orders",
  entities: { item: itemEntity },
  screens: [],
};

const section: EditRelatedListSectionViewModel = {
  kind: "relatedList",
  title: "Items",
  query: "orders:query:item:list",
  entity: "item",
  columns: [
    {
      field: "status",
      edit: { handler: "orders:write:item:update", when: { field: "locked", eq: false } },
    },
  ],
};

function setup(sectionUnderTest: EditRelatedListSectionViewModel = section) {
  const writes: Array<{ type: string; payload: unknown }> = [];
  let listQueries = 0;
  let hostReloads = 0;
  const dispatcher = createMockDispatcher({
    write: async (type, payload) => {
      writes.push({ type, payload });
      return { isSuccess: true, data: null };
    },
    query: async () => {
      listQueries += 1;
      return {
        isSuccess: true,
        data: {
          rows: [
            { id: "r1", status: "open", locked: false },
            { id: "r2", status: "open", locked: true },
          ],
          nextCursor: null,
        },
      };
    },
    batch: async () => ({ isSuccess: true, results: [] }),
  });
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <PrimitivesProvider
          value={createStubPrimitives({
            Banner: passChildren,
            Section: passChildren,
            Card: passChildren,
            DataTable: editorTable,
          })}
        >
          <NavProvider value={nav}>
            <AppFeaturesProvider features={[schema]}>
              <RelatedListSection
                section={sectionUnderTest}
                parentId="order-1"
                record={{ id: "order-1" }}
                featureName="orders"
                onAfterWrite={() => {
                  hostReloads += 1;
                }}
              />
            </AppFeaturesProvider>
          </NavProvider>
        </PrimitivesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
  return { writes, listQueries: () => listQueries, hostReloads: () => hostReloads };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("RelatedListSection edit column", () => {
  test("the select appears only where `when` holds", async () => {
    setup();
    await waitFor(() => rtlScreen.getByTestId("row-r1"));
    expect(rtlScreen.getByTestId("editor-r1")).toBeTruthy();
    expect(rtlScreen.queryByTestId("editor-r2")).toBeNull();
    expect(rtlScreen.getByTestId("value-r2").textContent).toBe("open");
  });

  test("a choice writes { id, field } through the handler, then reloads list and host once", async () => {
    const run = setup();
    await waitFor(() => rtlScreen.getByTestId("editor-r1"));
    expect(run.listQueries()).toBe(1);

    fireEvent.change(rtlScreen.getByTestId("editor-r1"), { target: { value: "done" } });

    await waitFor(() => expect(run.writes).toHaveLength(1));
    expect(run.writes[0]).toEqual({
      type: "orders:write:item:update",
      payload: { id: "r1", status: "done" },
    });
    await settle();
    expect(run.hostReloads()).toBe(1);
    expect(run.listQueries()).toBe(2);
  });
  test("edit.field makes the column's cell the dropdown of another select field", async () => {
    const run = setup({
      ...section,
      columns: [
        {
          field: "outcome",
          edit: { field: "status", handler: "orders:write:item:update", required: true },
        },
      ],
    });
    await waitFor(() => rtlScreen.getByTestId("editor-r1"));
    const select = rtlScreen.getByTestId("editor-r1") as HTMLSelectElement;
    expect(select.value).toBe("open");
    expect(select.getAttribute("data-required")).toBe("true");

    fireEvent.change(select, { target: { value: "done" } });

    await waitFor(() => expect(run.writes).toHaveLength(1));
    expect(run.writes[0]?.payload).toEqual({ id: "r1", status: "done" });
  });
});
