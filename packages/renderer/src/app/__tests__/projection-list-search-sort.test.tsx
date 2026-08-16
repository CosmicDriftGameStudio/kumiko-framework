// fw#2165: ProjectionListBody used to fetch with a hardcoded empty payload —
// search/sort/pagination were rendered but had no effect. This renders the
// real path (KumikoScreen → ProjectionListScreen → ProjectionListBody →
// RenderList) under a stub dispatcher that records every query() call, and a
// stateful NavProvider so setSearchParams actually re-renders — proving the
// URL-state → payload wiring for the two capabilities buildAppSchema derives
// per-screen (searchable, sortable).

import { describe, expect, test } from "bun:test";
import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { act, render, waitFor } from "@testing-library/react";
import { type ComponentType, type ReactNode, useState } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import { type CorePrimitives, type DataTableProps, PrimitivesProvider } from "../../primitives";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import type { NavApi } from "../nav";
import { NavProvider } from "../nav";

let capturedProps: DataTableProps | undefined;
const captureDataTable: ComponentType<DataTableProps> = (props) => {
  capturedProps = props;
  return null;
};
// Indirection defeats TS narrowing `capturedProps` to `undefined` at read
// sites — the compiler can't see that `captureDataTable` (a React render
// callback) reassigns it between the reset and the read.
const getCapturedProps = (): DataTableProps | undefined => capturedProps;
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: passChildren,
  Field: passChildren,
  Input: noop,
  DataTable: captureDataTable,
  Form: passChildren,
  Section: passChildren,
  Card: passChildren,
  Grid: passChildren,
  GridCell: passChildren,
  Text: passChildren,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

let queryCalls: Array<{ readonly type: string; readonly payload: unknown }> = [];

function stubDispatcher(): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async (type: string, payload: unknown) => {
      queryCalls.push({ type, payload });
      return { isSuccess: true, data: { rows: [], nextCursor: null } };
    }) as unknown as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

function buildSchema(screen: ProjectionListScreenDefinition): FeatureSchema {
  return {
    featureName: "ledger",
    entities: {},
    screens: [screen],
  } as FeatureSchema;
}

// Stateful nav so setSearchParams (called by useListUrlState) actually
// re-renders the tree — a plain mock object wouldn't trigger React.
function StatefulNav({
  initialParams,
  children,
}: {
  readonly initialParams: Record<string, string>;
  readonly children: ReactNode;
}): ReactNode {
  const [params, setParams] = useState<Record<string, string>>(initialParams);
  const value: NavApi = {
    route: { screenId: "ledger:screen:schedule-list" },
    navigate: () => {},
    replace: () => {},
    hrefFor: () => "",
    searchParams: params,
    setSearchParams: (updates) => {
      setParams((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(updates)) {
          if (v === null) delete next[k];
          else next[k] = v;
        }
        return next;
      });
    },
  };
  return <NavProvider value={value}>{children}</NavProvider>;
}

function renderProjectionList(
  screen: ProjectionListScreenDefinition,
  initialParams: Record<string, string> = {},
): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <StatefulNav initialParams={initialParams}>
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen schema={buildSchema(screen)} qn="ledger:screen:schedule-list" />
          </PrimitivesProvider>
        </StatefulNav>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("ProjectionListBody — search/sort capability wiring (fw#2165)", () => {
  test("search-capable screen: a URL search term lands in the query payload", async () => {
    queryCalls = [];
    renderProjectionList(
      {
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
        searchable: true,
      },
      { "schedule-list.q": "acme" },
    );

    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));
    expect(queryCalls[0]?.payload).toMatchObject({ search: "acme" });
  });

  test("non-search-capable screen: the same URL search term is NOT sent (schema doesn't accept it)", async () => {
    queryCalls = [];
    renderProjectionList(
      {
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
        searchable: false,
      },
      { "schedule-list.q": "acme" },
    );

    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));
    expect(queryCalls[0]?.payload).not.toHaveProperty("search");
  });

  test("sort-capable screen: the column is rendered sortable, and a header click updates state and payload", async () => {
    queryCalls = [];
    capturedProps = undefined;
    renderProjectionList({
      id: "schedule-list",
      type: "projectionList",
      query: "ledger:query:schedule:list",
      columns: ["description"],
      sortable: true,
      defaultSort: { field: "description", dir: "asc" },
    });

    await waitFor(() => expect(capturedProps).toBeDefined());
    const sortableProps = getCapturedProps();
    if (sortableProps === undefined) throw new Error("DataTable was not rendered");
    // Column-click affordance is only wired when the query schema accepts
    // sort — DefaultDataTable gates the header click on col.sortable.
    expect(sortableProps.columns.find((c) => c.field === "description")?.sortable).toBe(true);

    const countBeforeClick = queryCalls.length;
    await act(async () => {
      capturedProps?.onSortChange?.({ field: "description", dir: "desc" });
    });

    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(countBeforeClick));
    const lastPayload = queryCalls[queryCalls.length - 1]?.payload;
    expect(lastPayload).toMatchObject({ sort: "description", sortDirection: "desc" });
  });

  test("non-sort-capable screen: the column is rendered NOT sortable", async () => {
    capturedProps = undefined;
    renderProjectionList({
      id: "schedule-list",
      type: "projectionList",
      query: "ledger:query:schedule:list",
      columns: ["description"],
    });

    await waitFor(() => expect(capturedProps).toBeDefined());
    const notSortableProps = getCapturedProps();
    if (notSortableProps === undefined) throw new Error("DataTable was not rendered");
    expect(notSortableProps.columns.find((c) => c.field === "description")?.sortable).toBe(false);
  });
});
