import { describe, expect, test } from "bun:test";
import {
  createDateField,
  createEntity,
  createReferenceField,
} from "@cosmicdrift/kumiko-framework/engine";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { AppFeaturesProvider } from "../../app/app-features-context.tsx";
import type { FeatureSchema } from "../../app/feature-schema.ts";
import { type NavApi, NavProvider } from "../../app/nav.tsx";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher, EditRelatedListSectionViewModel } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import {
  type CorePrimitives,
  type DataTableProps,
  PrimitivesProvider,
  type SectionProps,
} from "../../primitives.tsx";
import { createMockDispatcher, createStubPrimitives } from "../../testing.ts";
import { RelatedListSection } from "../related-list-section.tsx";

const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testSection: ComponentType<SectionProps> = ({ testId, children }) => (
  <div data-testid={testId}>{children}</div>
);

function testPrimitives(): CorePrimitives {
  return createStubPrimitives({
    Field: passChildren,
    Section: testSection,
    Card: passChildren,
    Grid: passChildren,
    GridCell: passChildren,
  });
}

function stubDispatcher(rows: readonly Record<string, unknown>[]): {
  dispatcher: Dispatcher;
  queryPayloads: () => readonly unknown[];
} {
  const payloads: unknown[] = [];
  const dispatcher: Dispatcher = createMockDispatcher({
    query: async (_type, payload) => {
      payloads.push(payload);
      return { isSuccess: true, data: { rows, nextCursor: null } };
    },
  });
  return { dispatcher, queryPayloads: () => payloads };
}

function stubNav(): { nav: NavApi } {
  const nav: NavApi = {
    route: undefined,
    navigate: () => {},
    replace: () => {},
    hrefFor: () => "#",
    searchParams: {},
    setSearchParams: () => {},
  };
  return { nav };
}

// A DataTable stub that renders one row per query row (DOM order == passed
// `rows` order, so a re-sort is observable as a re-ordered row list) plus a
// button that calls `onSortChange` the same way a real SortableHeader click
// would — enough to prove RelatedListSection actually re-orders rows, not
// just that a header is clickable.
const orderedDataTable: ComponentType<DataTableProps> = ({ rows, onSortChange }) => (
  <div>
    <table>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} data-testid={`row-${row.id}`} />
        ))}
      </tbody>
    </table>
    {onSortChange !== undefined && (
      <button
        type="button"
        data-testid="sort-amount-desc"
        onClick={() => onSortChange({ field: "amount", dir: "desc" })}
      >
        sort
      </button>
    )}
  </div>
);

function renderedRowOrder(): string[] {
  return rtlScreen
    .getAllByTestId(/^row-/)
    .map((el) => el.getAttribute("data-testid")?.replace("row-", "") ?? "");
}

describe("RelatedListSection — sorting", () => {
  const unsortedRows = [
    { id: "r1", name: "Charlie", amount: 300 },
    { id: "r2", name: "Alice", amount: 100 },
    { id: "r3", name: "Bob", amount: 200 },
  ];

  test("defaultSort sorts the already-loaded rows client-side, independent of query response order", async () => {
    const { dispatcher } = stubDispatcher(unsortedRows);
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en-US" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={dispatcher}>
          <PrimitivesProvider value={{ ...testPrimitives(), DataTable: orderedDataTable }}>
            <NavProvider value={stubNav().nav}>
              <RelatedListSection
                section={{
                  kind: "relatedList",
                  title: "Positions",
                  query: "lease:query:items:list",
                  columns: [{ field: "amount", sortable: true }],
                  defaultSort: { field: "amount", dir: "asc" },
                }}
                parentId="order-1"
                record={{ id: "order-1" }}
                featureName="orders"
              />
            </NavProvider>
          </PrimitivesProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => rtlScreen.getByTestId("row-r1"));
    expect(renderedRowOrder()).toEqual(["r2", "r3", "r1"]);
  });

  test("toggling sort on a column the query sorts reloads with the sort in the payload and keeps the server order", async () => {
    const { dispatcher, queryPayloads } = stubDispatcher(unsortedRows);
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en-US" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={dispatcher}>
          <PrimitivesProvider value={{ ...testPrimitives(), DataTable: orderedDataTable }}>
            <NavProvider value={stubNav().nav}>
              <RelatedListSection
                section={{
                  kind: "relatedList",
                  title: "Positions",
                  query: "lease:query:items:list",
                  columns: [{ field: "amount", sortable: true }],
                  serverSortFields: ["amount"],
                }}
                parentId="order-1"
                record={{ id: "order-1" }}
                featureName="orders"
              />
            </NavProvider>
          </PrimitivesProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => rtlScreen.getByTestId("row-r1"));
    expect(queryPayloads()).toHaveLength(1);
    expect(queryPayloads()[0]).not.toHaveProperty("sort");

    fireEvent.click(rtlScreen.getByTestId("sort-amount-desc"));

    await waitFor(() =>
      expect(queryPayloads().at(-1)).toMatchObject({ sort: "amount", sortDirection: "desc" }),
    );
    // The stub answers every page in one fixed order; the server's order is final.
    expect(renderedRowOrder()).toEqual(["r1", "r2", "r3"]);
  });

  test("a defaultSort the query handles is sent with the first load", async () => {
    const { dispatcher, queryPayloads } = stubDispatcher(unsortedRows);
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en-US" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={dispatcher}>
          <PrimitivesProvider value={{ ...testPrimitives(), DataTable: orderedDataTable }}>
            <NavProvider value={stubNav().nav}>
              <RelatedListSection
                section={{
                  kind: "relatedList",
                  title: "Positions",
                  query: "lease:query:items:list",
                  columns: [{ field: "amount", sortable: true }],
                  defaultSort: { field: "amount", dir: "asc" },
                  serverSortFields: ["amount", "insertedAt"],
                  pageSize: 2,
                }}
                parentId="order-1"
                record={{ id: "order-1" }}
                featureName="orders"
              />
            </NavProvider>
          </PrimitivesProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => rtlScreen.getByTestId("row-r1"));
    expect(queryPayloads()[0]).toMatchObject({ limit: 2, sort: "amount", sortDirection: "asc" });
    expect(renderedRowOrder()).toEqual(["r1", "r2", "r3"]);
  });

  test("without a sort, a query that sorts by insertedAt is asked for creation order", async () => {
    const { dispatcher, queryPayloads } = stubDispatcher(unsortedRows);
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en-US" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={dispatcher}>
          <PrimitivesProvider value={{ ...testPrimitives(), DataTable: orderedDataTable }}>
            <NavProvider value={stubNav().nav}>
              <RelatedListSection
                section={{
                  kind: "relatedList",
                  title: "Positions",
                  query: "lease:query:items:list",
                  columns: [{ field: "amount", sortable: true }],
                  serverSortFields: ["amount", "insertedAt"],
                }}
                parentId="order-1"
                record={{ id: "order-1" }}
                featureName="orders"
              />
            </NavProvider>
          </PrimitivesProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => rtlScreen.getByTestId("row-r1"));
    expect(queryPayloads()[0]).toMatchObject({ sort: "insertedAt", sortDirection: "asc" });
  });

  test("a section without defaultSort renders rows in the original query order (unchanged behavior)", async () => {
    const { dispatcher } = stubDispatcher(unsortedRows);
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en-US" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={dispatcher}>
          <PrimitivesProvider value={{ ...testPrimitives(), DataTable: orderedDataTable }}>
            <NavProvider value={stubNav().nav}>
              <RelatedListSection
                section={{
                  kind: "relatedList",
                  title: "Positions",
                  query: "lease:query:items:list",
                  columns: [{ field: "amount" }],
                }}
                parentId="order-1"
                record={{ id: "order-1" }}
                featureName="orders"
              />
            </NavProvider>
          </PrimitivesProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => rtlScreen.getByTestId("row-r1"));
    expect(renderedRowOrder()).toEqual(["r1", "r2", "r3"]);
  });

  // One sort button per sortable column and direction, wired to onSortChange like a header click.
  const sortButtonsDataTable: ComponentType<DataTableProps> = ({ rows, columns, onSortChange }) => (
    <div>
      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-testid={`row-${row.id}`} />
          ))}
        </tbody>
      </table>
      {columns.flatMap((col) =>
        (col.sortable ? (["asc", "desc"] as const) : []).map((dir) => (
          <button
            key={`${col.field}-${dir}`}
            type="button"
            data-testid={`sort-${col.field}-${dir}`}
            onClick={() => onSortChange?.({ field: col.field, dir })}
          >
            sort
          </button>
        )),
      )}
    </div>
  );

  function renderSortedRelatedList(
    rows: readonly Record<string, unknown>[],
    section: Pick<
      EditRelatedListSectionViewModel,
      "columns" | "defaultSort" | "entity" | "serverSortFields"
    >,
    features: readonly FeatureSchema[] = [],
  ): void {
    const { dispatcher } = stubDispatcher(rows);
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "de-DE" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={dispatcher}>
          <AppFeaturesProvider features={features}>
            <PrimitivesProvider value={{ ...testPrimitives(), DataTable: sortButtonsDataTable }}>
              <NavProvider value={stubNav().nav}>
                <RelatedListSection
                  section={{
                    kind: "relatedList",
                    title: "Angebote",
                    query: "lease:query:items:list",
                    ...section,
                  }}
                  parentId="order-1"
                  record={{ id: "order-1" }}
                  featureName="lease"
                />
              </NavProvider>
            </PrimitivesProvider>
          </AppFeaturesProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );
  }

  // Money rows reach the client rehydrated, as { amount (minor units), currency }.
  const offerRows = [
    { id: "r1", amount: { amount: 120000, currency: "EUR" } },
    { id: "r2", amount: { amount: 98000, currency: "EUR" } },
    { id: "r3", amount: { amount: 150000, currency: "EUR" } },
  ];

  test("defaultSort asc on a money column orders by amount", async () => {
    renderSortedRelatedList(offerRows, {
      columns: [{ field: "amount", sortable: true, valueType: "money" }],
      defaultSort: { field: "amount", dir: "asc" },
    });

    await waitFor(() => rtlScreen.getByTestId("row-r1"));
    expect(renderedRowOrder()).toEqual(["r2", "r1", "r3"]);
  });

  test("a descending header click on a money column orders by amount", async () => {
    renderSortedRelatedList(offerRows, {
      columns: [{ field: "amount", sortable: true, valueType: "money" }],
    });

    await waitFor(() => rtlScreen.getByTestId("row-r1"));
    fireEvent.click(rtlScreen.getByTestId("sort-amount-desc"));
    await waitFor(() => expect(renderedRowOrder()).toEqual(["r3", "r1", "r2"]));
  });

  test("mixed currencies order by amount alone, like the server's column sort", async () => {
    renderSortedRelatedList(
      [
        { id: "r1", amount: { amount: 500, currency: "USD" } },
        { id: "r2", amount: { amount: 300, currency: "EUR" } },
        { id: "r3", amount: { amount: 400, currency: "USD" } },
      ],
      {
        columns: [{ field: "amount", sortable: true, valueType: "money" }],
        defaultSort: { field: "amount", dir: "asc" },
      },
    );

    await waitFor(() => rtlScreen.getByTestId("row-r1"));
    expect(renderedRowOrder()).toEqual(["r2", "r3", "r1"]);
  });

  test("a locatedTimestamp column orders by the instant, not by the local wall clock", async () => {
    renderSortedRelatedList(
      [
        {
          id: "r1",
          pickup: {
            at: "2026-03-01T09:00:00",
            tz: "America/New_York",
            utc: "2026-03-01T14:00:00Z",
          },
        },
        {
          id: "r2",
          pickup: { at: "2026-03-01T10:00:00", tz: "Europe/Berlin", utc: "2026-03-01T09:00:00Z" },
        },
      ],
      {
        columns: [{ field: "pickup", sortable: true }],
        defaultSort: { field: "pickup", dir: "asc" },
      },
    );

    await waitFor(() => rtlScreen.getByTestId("row-r1"));
    expect(renderedRowOrder()).toEqual(["r2", "r1"]);
  });

  test("timestamps within one second order by their fraction, whatever its digit count", async () => {
    renderSortedRelatedList(
      [
        { id: "r1", createdAt: "2026-03-01T10:00:00.5Z" },
        { id: "r2", createdAt: "2026-03-01T10:00:00Z" },
        { id: "r3", createdAt: "2026-03-01T10:00:00.25Z" },
      ],
      {
        columns: [{ field: "createdAt", sortable: true }],
        defaultSort: { field: "createdAt", dir: "asc" },
      },
    );

    await waitFor(() => rtlScreen.getByTestId("row-r1"));
    expect(renderedRowOrder()).toEqual(["r2", "r3", "r1"]);
  });

  test("empty values sit where the server list puts them: last ascending, first descending", async () => {
    renderSortedRelatedList(
      [
        { id: "r1", amount: { amount: 200, currency: "EUR" } },
        { id: "r2" },
        { id: "r3", amount: { amount: 100, currency: "EUR" } },
      ],
      {
        columns: [{ field: "amount", sortable: true, valueType: "money" }],
        defaultSort: { field: "amount", dir: "asc" },
      },
    );

    await waitFor(() => rtlScreen.getByTestId("row-r1"));
    expect(renderedRowOrder()).toEqual(["r3", "r1", "r2"]);
    fireEvent.click(rtlScreen.getByTestId("sort-amount-desc"));
    await waitFor(() => expect(renderedRowOrder()).toEqual(["r2", "r1", "r3"]));
  });

  test("a field's declared sortNulls places empty values like the server list", async () => {
    const schema: FeatureSchema = {
      featureName: "lease",
      entities: {
        item: createEntity({
          name: "item",
          table: "Items",
          fields: { dueDate: createDateField({ sortNulls: "first" }) },
        }),
      },
      screens: [],
    };
    renderSortedRelatedList(
      [
        { id: "r1", dueDate: "2026-02-01" },
        { id: "r2", dueDate: null },
        { id: "r3", dueDate: "2026-01-01" },
      ],
      {
        entity: "lease:item",
        columns: [{ field: "dueDate", sortable: true }],
        defaultSort: { field: "dueDate", dir: "asc" },
      },
      [schema],
    );

    await waitFor(() => rtlScreen.getByTestId("row-r1"));
    expect(renderedRowOrder()).toEqual(["r2", "r3", "r1"]);
  });

  test("rows with the same sort value keep the server list's tie order, by id", async () => {
    renderSortedRelatedList(
      [
        { id: "id-c", amount: { amount: 100, currency: "EUR" } },
        { id: "id-a", amount: { amount: 100, currency: "EUR" } },
        { id: "id-b", amount: { amount: 50, currency: "EUR" } },
      ],
      {
        columns: [{ field: "amount", sortable: true, valueType: "money" }],
        defaultSort: { field: "amount", dir: "asc" },
      },
    );

    await waitFor(() => rtlScreen.getByTestId("row-id-a"));
    expect(renderedRowOrder()).toEqual(["id-b", "id-a", "id-c"]);
    fireEvent.click(rtlScreen.getByTestId("sort-amount-desc"));
    await waitFor(() => expect(renderedRowOrder()).toEqual(["id-a", "id-c", "id-b"]));
  });

  test("a boolean column orders false before true, like Postgres", async () => {
    renderSortedRelatedList(
      [
        { id: "r1", active: true },
        { id: "r2", active: false },
      ],
      {
        columns: [{ field: "active", sortable: true }],
        defaultSort: { field: "active", dir: "asc" },
      },
    );

    await waitFor(() => rtlScreen.getByTestId("row-r1"));
    expect(renderedRowOrder()).toEqual(["r2", "r1"]);
  });

  test("a reference column the query cannot sort by its label offers no sort, so nothing orders by uuid", async () => {
    const schema: FeatureSchema = {
      featureName: "lease",
      entities: {
        item: createEntity({
          name: "item",
          table: "Items",
          fields: {
            contactId: createReferenceField({
              entity: "contact",
              personal: false,
              reason: "test_fixture",
            }),
            dueDate: createDateField(),
          },
        }),
      },
      screens: [],
    };
    renderSortedRelatedList(
      [
        { id: "r1", contactId: "c9", dueDate: "2026-02-01" },
        { id: "r2", contactId: "c1", dueDate: "2026-01-01" },
      ],
      {
        entity: "lease:item",
        columns: [
          { field: "contactId", sortable: true },
          { field: "dueDate", sortable: true },
        ],
        defaultSort: { field: "contactId", dir: "asc" },
        serverSortFields: [],
      },
      [schema],
    );

    await waitFor(() => rtlScreen.getByTestId("row-r1"));
    expect(rtlScreen.queryByTestId("sort-contactId-asc")).toBeNull();
    expect(renderedRowOrder()).toEqual(["r1", "r2"]);
    fireEvent.click(rtlScreen.getByTestId("sort-dueDate-asc"));
    await waitFor(() => expect(renderedRowOrder()).toEqual(["r2", "r1"]));
  });
});
