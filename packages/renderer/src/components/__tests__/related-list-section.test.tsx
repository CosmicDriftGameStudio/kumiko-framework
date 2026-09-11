import { describe, expect, spyOn, test } from "bun:test";
import type { RowAction } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher, EditRelatedListSectionViewModel } from "@cosmicdrift/kumiko-headless";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { type NavApi, NavProvider } from "../../app/nav";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type CorePrimitives,
  type DataTableProps,
  type InputProps,
  PrimitivesProvider,
  type SectionProps,
} from "../../primitives";
import { RelatedListSection } from "../related-list-section";

const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;
const noop = () => {};

const testSection: ComponentType<SectionProps> = ({ testId, children }) => (
  <div data-testid={testId}>{children}</div>
);

// A minimal DataTable stub: renders one button per row per row-action,
// wired straight to the action's onTrigger — enough to prove
// RelatedListSection wires rowActions through to a real dispatch, without
// needing the production DataTable's sorting/paging/kebab-menu chrome.
// The isVisible filter mirrors the production DataTable's own row-action
// filter (renderer-web primitives/index.tsx) so per-row gating is exercised
// here rather than assumed.
const testDataTable: ComponentType<DataTableProps> = ({ rows, rowActions }) => (
  <table>
    <tbody>
      {rows.map((row) => (
        <tr key={row.id} data-testid={`row-${row.id}`}>
          <td>
            {(rowActions ?? [])
              .filter((action) => action.isVisible === undefined || action.isVisible(row))
              .map((action) => (
                <button
                  key={action.id}
                  type="button"
                  data-testid={`action-${action.id}-${row.id}`}
                  onClick={() => void action.onTrigger(row)}
                >
                  {action.label}
                </button>
              ))}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const testInput = (props: InputProps) =>
  props.kind === "text" ? (
    <input
      data-testid={props.id}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ) : null;

function testPrimitives(): CorePrimitives {
  return {
    Button: noop,
    Banner: ({ children, testId }: { children?: ReactNode; testId?: string }) => (
      <div data-testid={testId}>{children}</div>
    ),
    Field: passChildren,
    Input: testInput,
    DataTable: testDataTable,
    Form: noop,
    Section: testSection,
    Card: passChildren,
    Grid: passChildren,
    GridCell: passChildren,
    Text: noop,
    Heading: noop,
    Dialog: noop,
    Modal: noop,
    Lightbox: noop,
    ConfigSourceBadge: noop,
    ConfigCascadeView: noop,
    Link: noop,
  } as unknown as CorePrimitives;
}

function stubDispatcher(
  rows: readonly Record<string, unknown>[] = [{ id: "r1", name: "Alice" }],
  nextCursor: string | null = null,
): {
  dispatcher: Dispatcher;
  writes: Array<{ type: string; payload: unknown }>;
  queryCount: () => number;
} {
  const writes: Array<{ type: string; payload: unknown }> = [];
  let queryCalls = 0;
  const dispatcher: Dispatcher = {
    write: (async (type, payload) => {
      writes.push({ type, payload });
      return { isSuccess: true, data: null };
    }) as Dispatcher["write"],
    query: (async () => {
      queryCalls += 1;
      return { isSuccess: true, data: { rows, nextCursor } };
    }) as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
  return { dispatcher, writes, queryCount: () => queryCalls };
}

function stubNav(): {
  nav: NavApi;
  navigations: unknown[];
  searchParams: Array<Record<string, string | null>>;
} {
  const navigations: unknown[] = [];
  const searchParams: Array<Record<string, string | null>> = [];
  const nav: NavApi = {
    route: undefined,
    navigate: (target: unknown) => {
      navigations.push(target);
    },
    replace: noop,
    hrefFor: () => "#",
    searchParams: {},
    setSearchParams: (params: Record<string, string | null>) => {
      searchParams.push(params);
    },
  } as unknown as NavApi;
  return { nav, navigations, searchParams };
}

const rowActions: readonly RowAction[] = [
  {
    id: "resend",
    label: "actions.resend",
    handler: "orders:write:resend",
    payload: { pick: ["id"] },
  },
];

const historySection: EditRelatedListSectionViewModel = {
  kind: "relatedList",
  title: "History",
  query: "orders:query:notifications:list",
  columns: [{ field: "name" }],
  rowActions,
};

function renderRelatedList(
  dispatcher: Dispatcher,
  section: EditRelatedListSectionViewModel = historySection,
  nav: NavApi = stubNav().nav,
) {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <PrimitivesProvider value={testPrimitives()}>
          <NavProvider value={nav}>
            <RelatedListSection section={section} parentId="order-1" featureName="orders" />
          </NavProvider>
        </PrimitivesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("RelatedListSection — tabs-mode card chrome (fw#2722)", () => {
  test("hideTitle (tabs mode) renders the list without a Section wrapper and marks the table chromeless + scrollBody", async () => {
    const { dispatcher } = stubDispatcher();
    let capturedChromeless: boolean | undefined;
    let capturedScrollBody: boolean | undefined;
    const capturingDataTable: ComponentType<DataTableProps> = (props) => {
      capturedChromeless = props.chromeless;
      capturedScrollBody = props.scrollBody;
      return testDataTable(props);
    };
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en-US" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={dispatcher}>
          <PrimitivesProvider value={{ ...testPrimitives(), DataTable: capturingDataTable }}>
            <NavProvider value={stubNav().nav}>
              <RelatedListSection
                section={historySection}
                parentId="order-1"
                featureName="orders"
                hideTitle
              />
            </NavProvider>
          </PrimitivesProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => expect(rtlScreen.getByTestId("row-r1")).toBeTruthy());
    expect(rtlScreen.queryByTestId(`related-list-${historySection.title}`)).toBeNull();
    expect(capturedChromeless).toBe(true);
    expect(capturedScrollBody).toBe(true);
  });

  test("without hideTitle (stacked mode), the same section keeps its Section wrapper and an un-chromeless, unbounded-height table", async () => {
    const { dispatcher } = stubDispatcher();
    let capturedChromeless: boolean | undefined;
    let capturedScrollBody: boolean | undefined;
    const capturingDataTable: ComponentType<DataTableProps> = (props) => {
      capturedChromeless = props.chromeless;
      capturedScrollBody = props.scrollBody;
      return testDataTable(props);
    };
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en-US" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={dispatcher}>
          <PrimitivesProvider value={{ ...testPrimitives(), DataTable: capturingDataTable }}>
            <NavProvider value={stubNav().nav}>
              <RelatedListSection
                section={historySection}
                parentId="order-1"
                featureName="orders"
              />
            </NavProvider>
          </PrimitivesProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => expect(rtlScreen.getByTestId("row-r1")).toBeTruthy());
    expect(rtlScreen.getByTestId(`related-list-${historySection.title}`)).toBeTruthy();
    expect(capturedChromeless).toBeUndefined();
    expect(capturedScrollBody).toBeUndefined();
  });
});

describe("RelatedListSection — rowActions", () => {
  test("clicking a row action dispatches through the configured write-handler with the extracted payload, then refetches", async () => {
    const { dispatcher, writes, queryCount } = stubDispatcher();
    renderRelatedList(dispatcher);

    await waitFor(() => expect(rtlScreen.getByTestId("row-r1")).toBeTruthy());
    rtlScreen.getByTestId("action-resend-r1").click();

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ type: "orders:write:resend", payload: { id: "r1" } });
    await waitFor(() => expect(queryCount()).toBe(2));
  });

  test("a navigate row action targets its screen and carries the clicked row's own values as search params", async () => {
    const { dispatcher } = stubDispatcher([{ id: "item-7", name: "Rent 2024", amount: 1200 }]);
    const { nav, navigations, searchParams } = stubNav();
    renderRelatedList(
      dispatcher,
      {
        kind: "relatedList",
        title: "Positions",
        query: "lease:query:items:list",
        columns: [{ field: "name" }],
        rowActions: [
          {
            kind: "navigate",
            id: "adjust-rent",
            label: "actions.adjustRent",
            screen: "adjust-rent-form",
            params: { map: { itemId: "id", currentAmount: "amount" } },
          },
        ],
      },
      nav,
    );

    await waitFor(() => expect(rtlScreen.getByTestId("row-item-7")).toBeTruthy());
    rtlScreen.getByTestId("action-adjust-rent-item-7").click();

    await waitFor(() => expect(navigations).toHaveLength(1));
    expect(navigations[0]).toEqual({ screenId: "adjust-rent-form" });
    expect(searchParams).toEqual([{ itemId: "item-7", currentAmount: "1200" }]);
  });

  test("a row action with a visible condition renders only on the rows that satisfy it", async () => {
    const { dispatcher } = stubDispatcher([
      { id: "active-1", name: "Running", status: "active" },
      { id: "ended-1", name: "Closed", status: "ended" },
    ]);
    renderRelatedList(dispatcher, {
      kind: "relatedList",
      title: "Positions",
      query: "lease:query:items:list",
      columns: [{ field: "name" }],
      rowActions: [
        {
          id: "end-item",
          label: "actions.endItem",
          handler: "lease:write:end-item",
          payload: { pick: ["id"] },
          visible: { field: "status", eq: "active" },
        },
      ],
    });

    await waitFor(() => expect(rtlScreen.getByTestId("row-ended-1")).toBeTruthy());
    expect(rtlScreen.getByTestId("action-end-item-active-1")).toBeTruthy();
    expect(rtlScreen.queryByTestId("action-end-item-ended-1")).toBeNull();
  });
});

// RelatedListSection never renders the Drawer itself (require-cycle with
// kumiko-screen.tsx, which owns the shared Drawer state) — it only forwards
// a drawer-kind rowAction to the injected `onOpenDrawer` callback. This
// pins that hand-off, not the Drawer UI itself (covered by kumiko-screen's
// own tests).
describe("RelatedListSection — rowActions drawer-kind (fw#2710)", () => {
  test("clicking a drawer rowAction calls onOpenDrawer with the action and the row's extracted values", async () => {
    const { dispatcher } = stubDispatcher([{ id: "item-7", name: "Rent 2024", amount: 1200 }]);
    const openDrawerCalls: unknown[][] = [];
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en-US" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={dispatcher}>
          <PrimitivesProvider value={testPrimitives()}>
            <NavProvider value={stubNav().nav}>
              <RelatedListSection
                section={{
                  kind: "relatedList",
                  title: "Positions",
                  query: "lease:query:items:list",
                  columns: [{ field: "name" }],
                  rowActions: [
                    {
                      kind: "drawer",
                      id: "adjust-rent",
                      label: "actions.adjustRent",
                      screen: "adjust-rent-form",
                      params: { map: { itemId: "id", currentAmount: "amount" } },
                    },
                  ],
                }}
                parentId="order-1"
                featureName="orders"
                onOpenDrawer={(action, initialValues) =>
                  openDrawerCalls.push([action, initialValues])
                }
              />
            </NavProvider>
          </PrimitivesProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => expect(rtlScreen.getByTestId("row-item-7")).toBeTruthy());
    rtlScreen.getByTestId("action-adjust-rent-item-7").click();

    await waitFor(() => expect(openDrawerCalls).toHaveLength(1));
    const call = openDrawerCalls[0];
    if (call === undefined) throw new Error("expected onOpenDrawer to have been called");
    expect((call[0] as { readonly id: string }).id).toBe("adjust-rent");
    expect(call[1]).toEqual({ itemId: "item-7", currentAmount: 1200 });
  });

  test("a drawer rowAction is dropped (not rendered) when no onOpenDrawer is wired", async () => {
    const { dispatcher } = stubDispatcher([{ id: "item-7", name: "Rent 2024", amount: 1200 }]);
    renderRelatedList(dispatcher, {
      kind: "relatedList",
      title: "Positions",
      query: "lease:query:items:list",
      columns: [{ field: "name" }],
      rowActions: [
        {
          kind: "drawer",
          id: "adjust-rent",
          label: "actions.adjustRent",
          screen: "adjust-rent-form",
        },
      ],
    });

    await waitFor(() => expect(rtlScreen.getByTestId("row-item-7")).toBeTruthy());
    expect(rtlScreen.queryByTestId("action-adjust-rent-item-7")).toBeNull();
  });

  test("a dropped drawer rowAction without onOpenDrawer logs a dev warning naming the action id (fw#2733)", async () => {
    const { dispatcher } = stubDispatcher([{ id: "item-7", name: "Rent 2024", amount: 1200 }]);
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      renderRelatedList(dispatcher, {
        kind: "relatedList",
        title: "Positions",
        query: "lease:query:items:list",
        columns: [{ field: "name" }],
        rowActions: [
          {
            kind: "drawer",
            id: "adjust-rent-warn-only-2733",
            label: "actions.adjustRent",
            screen: "adjust-rent-form",
          },
        ],
      });

      await waitFor(() => expect(rtlScreen.getByTestId("row-item-7")).toBeTruthy());
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain("adjust-rent-warn-only-2733");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("a drawer rowAction with onOpenDrawer wired renders without a dev warning (fw#2733)", async () => {
    const { dispatcher } = stubDispatcher([{ id: "item-7", name: "Rent 2024", amount: 1200 }]);
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(
        <LocaleProvider
          resolver={createStaticLocaleResolver({ locale: "en-US" })}
          fallbackBundles={[kumikoDefaultTranslations]}
        >
          <DispatcherProvider dispatcher={dispatcher}>
            <PrimitivesProvider value={testPrimitives()}>
              <NavProvider value={stubNav().nav}>
                <RelatedListSection
                  section={{
                    kind: "relatedList",
                    title: "Positions",
                    query: "lease:query:items:list",
                    columns: [{ field: "name" }],
                    rowActions: [
                      {
                        kind: "drawer",
                        id: "adjust-rent-warn-wired-2733",
                        label: "actions.adjustRent",
                        screen: "adjust-rent-form",
                      },
                    ],
                  }}
                  parentId="order-1"
                  featureName="orders"
                  onOpenDrawer={noop}
                />
              </NavProvider>
            </PrimitivesProvider>
          </DispatcherProvider>
        </LocaleProvider>,
      );

      await waitFor(() => expect(rtlScreen.getByTestId("row-item-7")).toBeTruthy());
      expect(rtlScreen.getByTestId("action-adjust-rent-warn-wired-2733-item-7")).toBeTruthy();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

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

describe("RelatedListSection — sorting (fw#2722)", () => {
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
                featureName="orders"
              />
            </NavProvider>
          </PrimitivesProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => expect(rtlScreen.getByTestId("row-r1")).toBeTruthy());
    expect(renderedRowOrder()).toEqual(["r2", "r3", "r1"]);
  });

  test("toggling sort via onSortChange re-orders rows without a refetch", async () => {
    const { dispatcher, queryCount } = stubDispatcher(unsortedRows);
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
                }}
                parentId="order-1"
                featureName="orders"
              />
            </NavProvider>
          </PrimitivesProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => expect(rtlScreen.getByTestId("row-r1")).toBeTruthy());
    expect(renderedRowOrder()).toEqual(["r1", "r2", "r3"]);

    fireEvent.click(rtlScreen.getByTestId("sort-amount-desc"));

    await waitFor(() => expect(renderedRowOrder()).toEqual(["r1", "r3", "r2"]));
    expect(queryCount()).toBe(1);
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
                featureName="orders"
              />
            </NavProvider>
          </PrimitivesProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => expect(rtlScreen.getByTestId("row-r1")).toBeTruthy());
    expect(renderedRowOrder()).toEqual(["r1", "r2", "r3"]);
  });
});

describe("RelatedListSection — truncation banner (fw#2722 review)", () => {
  test("nextCursor !== null renders a truncation banner", async () => {
    const { dispatcher } = stubDispatcher([{ id: "r1", name: "Alice" }], "cursor-abc");
    renderRelatedList(dispatcher);

    await waitFor(() => expect(rtlScreen.getByTestId("row-r1")).toBeTruthy());
    const banner = rtlScreen.getByTestId("related-list-truncated");
    expect(banner).toBeTruthy();
    // Proves {count} actually interpolates (single-brace, the renderer's own
    // i18n.tsx interpolate() syntax) rather than rendering as literal braces.
    expect(banner.textContent).toContain("Showing the first 1 entries.");
  });

  test("nextCursor === null renders no truncation banner", async () => {
    const { dispatcher } = stubDispatcher([{ id: "r1", name: "Alice" }], null);
    renderRelatedList(dispatcher);

    await waitFor(() => expect(rtlScreen.getByTestId("row-r1")).toBeTruthy());
    expect(rtlScreen.queryByTestId("related-list-truncated")).toBeNull();
  });

  test("the banner shows regardless of an active sort — an unsorted truncated list is equally misleading", async () => {
    const { dispatcher } = stubDispatcher(
      [
        { id: "r1", name: "Charlie", amount: 300 },
        { id: "r2", name: "Alice", amount: 100 },
      ],
      "cursor-abc",
    );
    renderRelatedList(dispatcher, {
      kind: "relatedList",
      title: "Positions",
      query: "lease:query:items:list",
      columns: [{ field: "amount", sortable: true }],
      defaultSort: { field: "amount", dir: "asc" },
    });

    await waitFor(() => expect(rtlScreen.getByTestId("row-r1")).toBeTruthy());
    expect(rtlScreen.getByTestId("related-list-truncated")).toBeTruthy();
  });
});

// A DataTable stub that renders the toolbarStart slot (carries the search
// Input) and filterFacets as one button per option, wired straight to
// onFilterChange/onFilterReset — enough to prove RelatedListSection resolves
// facets and wires search through RenderList, without the production
// DataTable's own facet-dropdown chrome.
const searchFacetDataTable: ComponentType<DataTableProps> = ({
  rows,
  toolbarStart,
  filterFacets,
  onFilterChange,
  onFilterReset,
}) => (
  <div>
    {toolbarStart}
    {(filterFacets ?? []).map((facet) => (
      <div key={facet.field}>
        {facet.options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            data-testid={`facet-${facet.field}-${opt.value}`}
            onClick={() => onFilterChange?.(facet.field, [opt.value])}
          >
            {opt.label}
          </button>
        ))}
      </div>
    ))}
    {onFilterReset !== undefined && (
      <button type="button" data-testid="filter-reset" onClick={onFilterReset}>
        Reset
      </button>
    )}
    <table>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} data-testid={`row-${row.id}`} />
        ))}
      </tbody>
    </table>
  </div>
);

// A dispatcher stub that genuinely filters a fixed row set by the received
// payload — `search` as a case-insensitive substring on `name`, `filters`
// entries (`{ field, op: "in", value }`) as membership on that field —
// instead of returning canned rows, so a test can tell a real payload from a
// stale one. Every payload it sees is recorded for the "last payload"
// assertions below.
function filteringDispatcher(rows: readonly Record<string, unknown>[]): {
  dispatcher: Dispatcher;
  payloads: Record<string, unknown>[];
} {
  const payloads: Record<string, unknown>[] = [];
  const dispatcher: Dispatcher = {
    write: (async () => ({ isSuccess: true, data: null })) as Dispatcher["write"],
    query: (async (_type: string, payload: unknown) => {
      const p = payload as {
        search?: string;
        filters?: readonly { field: string; op: "in"; value: readonly unknown[] }[];
      };
      payloads.push(p);
      let result = rows;
      if (p.search !== undefined && p.search !== "") {
        const term = p.search.toLowerCase();
        result = result.filter((r) =>
          String(r["name"] ?? "")
            .toLowerCase()
            .includes(term),
        );
      }
      for (const f of p.filters ?? []) {
        result = result.filter((r) => f.value.includes(r[f.field]));
      }
      return { isSuccess: true, data: { rows: result, nextCursor: null } };
    }) as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
  return { dispatcher, payloads };
}

function renderWithDataTable(
  dispatcher: Dispatcher,
  section: EditRelatedListSectionViewModel,
  DataTable: ComponentType<DataTableProps>,
  hideTitle?: boolean,
) {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <PrimitivesProvider value={{ ...testPrimitives(), DataTable }}>
          <NavProvider value={stubNav().nav}>
            <RelatedListSection
              section={section}
              parentId="order-1"
              featureName="orders"
              {...(hideTitle === true && { hideTitle: true })}
            />
          </NavProvider>
        </PrimitivesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("RelatedListSection — search + facets (fw#2740)", () => {
  const nameRows = [
    { id: "r1", name: "Alice" },
    { id: "r2", name: "Bob" },
  ];

  test("searchable: true — typing (after the 300ms debounce) sends payload.search and narrows the rendered rows", async () => {
    const { dispatcher, payloads } = filteringDispatcher(nameRows);
    renderWithDataTable(
      dispatcher,
      {
        kind: "relatedList",
        title: "Contacts",
        query: "lease:query:contacts:list",
        columns: [{ field: "name" }],
        searchable: true,
      },
      searchFacetDataTable,
    );

    await waitFor(() => expect(rtlScreen.getByTestId("row-r1")).toBeTruthy());
    expect(rtlScreen.getByTestId("row-r2")).toBeTruthy();

    fireEvent.change(rtlScreen.getByTestId("render-list-search"), {
      target: { value: "ali" },
    });

    await waitFor(
      () => {
        const last = payloads[payloads.length - 1];
        expect(last?.["search"]).toBe("ali");
      },
      { timeout: 2000 },
    );
    await waitFor(() => expect(rtlScreen.getByTestId("row-r1")).toBeTruthy());
    expect(rtlScreen.queryByTestId("row-r2")).toBeNull();
  });

  test("without searchable, RenderList shows no search input and no payload ever carries a search key", async () => {
    const { dispatcher, payloads } = filteringDispatcher(nameRows);
    renderWithDataTable(
      dispatcher,
      {
        kind: "relatedList",
        title: "Contacts",
        query: "lease:query:contacts:list",
        columns: [{ field: "name" }],
      },
      searchFacetDataTable,
    );

    await waitFor(() => expect(rtlScreen.getByTestId("row-r1")).toBeTruthy());
    expect(rtlScreen.queryByTestId("render-list-search")).toBeNull();
    for (const p of payloads) {
      expect("search" in p).toBe(false);
    }
  });

  test("tabs mode (hideTitle): the search box still renders and narrows the rows", async () => {
    const { dispatcher, payloads } = filteringDispatcher(nameRows);
    renderWithDataTable(
      dispatcher,
      {
        kind: "relatedList",
        title: "Contacts",
        query: "lease:query:contacts:list",
        columns: [{ field: "name" }],
        searchable: true,
      },
      searchFacetDataTable,
      true,
    );

    await waitFor(() => expect(rtlScreen.getByTestId("row-r1")).toBeTruthy());
    expect(rtlScreen.getByTestId("row-r2")).toBeTruthy();
    expect(rtlScreen.getByTestId("render-list-search")).toBeTruthy();

    fireEvent.change(rtlScreen.getByTestId("render-list-search"), {
      target: { value: "ali" },
    });

    await waitFor(
      () => {
        const last = payloads[payloads.length - 1];
        expect(last?.["search"]).toBe("ali");
      },
      { timeout: 2000 },
    );
    await waitFor(() => expect(rtlScreen.getByTestId("row-r1")).toBeTruthy());
    expect(rtlScreen.queryByTestId("row-r2")).toBeNull();
  });

  const statusSection: EditRelatedListSectionViewModel = {
    kind: "relatedList",
    title: "Positions",
    query: "lease:query:items:list",
    columns: [{ field: "name" }, { field: "status" }],
    facets: [
      {
        field: "status",
        type: "select",
        label: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "ended", label: "Ended" },
        ],
      },
    ],
  };
  const statusRows = [
    { id: "active-1", name: "Running", status: "active" },
    { id: "ended-1", name: "Closed", status: "ended" },
  ];

  test("select facet: clicking an option filters payload.filters and rows, resetting clears both", async () => {
    const { dispatcher, payloads } = filteringDispatcher(statusRows);
    renderWithDataTable(dispatcher, statusSection, searchFacetDataTable);

    await waitFor(() => expect(rtlScreen.getByTestId("row-active-1")).toBeTruthy());
    expect(rtlScreen.getByTestId("row-ended-1")).toBeTruthy();

    fireEvent.click(rtlScreen.getByTestId("facet-status-active"));

    await waitFor(() => expect(rtlScreen.queryByTestId("row-ended-1")).toBeNull());
    expect(rtlScreen.getByTestId("row-active-1")).toBeTruthy();
    expect(payloads[payloads.length - 1]?.["filters"]).toEqual([
      { field: "status", op: "in", value: ["active"] },
    ]);

    fireEvent.click(rtlScreen.getByTestId("filter-reset"));

    await waitFor(() => expect(rtlScreen.getByTestId("row-ended-1")).toBeTruthy());
    expect(rtlScreen.getByTestId("row-active-1")).toBeTruthy();
    expect(payloads[payloads.length - 1]?.["filters"]).toBeUndefined();
  });

  test("boolean facet: selecting a value sends a real boolean in payload.filters and narrows rows accordingly", async () => {
    const paidRows = [
      { id: "paid-1", name: "Invoice A", paid: true },
      { id: "unpaid-1", name: "Invoice B", paid: false },
    ];
    const { dispatcher, payloads } = filteringDispatcher(paidRows);
    renderWithDataTable(
      dispatcher,
      {
        kind: "relatedList",
        title: "Invoices",
        query: "lease:query:invoices:list",
        columns: [{ field: "name" }, { field: "paid" }],
        facets: [
          {
            field: "paid",
            type: "boolean",
            label: "Paid",
            trueLabel: "Yes",
            falseLabel: "No",
          },
        ],
      },
      searchFacetDataTable,
    );

    await waitFor(() => expect(rtlScreen.getByTestId("row-paid-1")).toBeTruthy());
    expect(rtlScreen.getByTestId("row-unpaid-1")).toBeTruthy();

    fireEvent.click(rtlScreen.getByTestId("facet-paid-true"));

    await waitFor(() => expect(rtlScreen.queryByTestId("row-unpaid-1")).toBeNull());
    expect(rtlScreen.getByTestId("row-paid-1")).toBeTruthy();
    expect(payloads[payloads.length - 1]?.["filters"]).toEqual([
      { field: "paid", op: "in", value: [true] },
    ]);
  });
});
