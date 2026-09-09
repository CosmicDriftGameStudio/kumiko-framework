import { describe, expect, test } from "bun:test";
import type { RowAction } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher, EditRelatedListSectionViewModel } from "@cosmicdrift/kumiko-headless";
import { render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { type NavApi, NavProvider } from "../../app/nav";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type CorePrimitives,
  type DataTableProps,
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

function testPrimitives(): CorePrimitives {
  return {
    Button: noop,
    Banner: ({ children, testId }: { children?: ReactNode; testId?: string }) => (
      <div data-testid={testId}>{children}</div>
    ),
    Field: passChildren,
    Input: noop,
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

function stubDispatcher(rows: readonly Record<string, unknown>[] = [{ id: "r1", name: "Alice" }]): {
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
      return { isSuccess: true, data: { rows, nextCursor: null } };
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
