// entityList `facets` (chips, counts, extraOptions, hide) and `defaultFilters`.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { act, render, waitFor } from "@testing-library/react";
import { type ComponentType, type ReactNode, useState } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.js";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.js";
import { kumikoDefaultTranslations } from "../../i18n-defaults.js";
import { type CorePrimitives, type DataTableProps, PrimitivesProvider } from "../../primitives.js";
import type { FeatureSchema } from "../feature-schema.js";
import { KumikoScreen } from "../kumiko-screen.js";
import type { NavApi } from "../nav.js";
import { NavProvider } from "../nav.js";

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

// Stateful nav so setSearchParams (called by useListUrlState.setFilter)
// actually re-renders the tree — a plain mock object wouldn't trigger React,
// and toggling a facet would never reach a second query() call.
function StatefulNav({ children }: { readonly children: ReactNode }): ReactNode {
  const [params, setParams] = useState<Record<string, string>>({});
  const value: NavApi = {
    route: { screenId: "unused" },
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

function renderScreen(
  schema: FeatureSchema,
  qn: string,
  dispatcher: Dispatcher = stubDispatcher(),
  timeZone = "UTC",
): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE", timeZone })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <StatefulNav>
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen schema={schema} qn={qn} />
          </PrimitivesProvider>
        </StatefulNav>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

const statusEntity: EntityDefinition = {
  fields: {
    status: { type: "select", options: ["open", "done"], filterable: true, required: false },
  },
};

function statusSchema(
  extra: Pick<EntityListScreenDefinition, "facets" | "defaultFilters">,
): FeatureSchema {
  const screen: EntityListScreenDefinition = {
    id: "task-list",
    type: "entityList",
    entity: "task",
    columns: ["status"],
    ...extra,
  };
  return {
    featureName: "tasks",
    entities: { task: statusEntity },
    screens: [screen],
  } as FeatureSchema;
}

async function capturedFacets(): Promise<DataTableProps> {
  await waitFor(() => expect(capturedProps).toBeDefined());
  const props = getCapturedProps();
  if (props === undefined) throw new Error("DataTable was not rendered");
  return props;
}

function filtersOf(payload: unknown): unknown {
  return (payload as { filters?: unknown }).filters;
}

describe("entityList facets config", () => {
  test("chips display: options become chips with extraOptions placed by position, no dropdown options needed", async () => {
    queryCalls = [];
    capturedProps = undefined;
    renderScreen(
      statusSchema({
        facets: {
          status: {
            display: "chips",
            extraOptions: [
              { id: "all", label: "All", values: [] },
              { id: "active", label: "Active", values: ["open"], position: "end" },
            ],
          },
        },
      }),
      "tasks:screen:task-list",
    );
    const props = await capturedFacets();
    const chips = props.filterFacets?.[0]?.chips;
    expect(chips?.map((chip) => [chip.id, chip.values])).toEqual([
      ["all", []],
      ["open", ["open"]],
      ["done", ["done"]],
      ["active", ["open"]],
    ]);
  });

  test("showCounts: each chip's count comes from a limit-1 totalCount query with that chip's filter", async () => {
    queryCalls = [];
    capturedProps = undefined;
    const dispatcher = {
      ...stubDispatcher(),
      query: (async (type: string, payload: unknown) => {
        queryCalls.push({ type, payload });
        const filters = filtersOf(payload) as { value: string[] }[] | undefined;
        const total = filters?.[0]?.value[0] === "open" ? 7 : 3;
        return { isSuccess: true, data: { rows: [], nextCursor: null, total } };
      }) as unknown as Dispatcher["query"],
    };
    renderScreen(
      statusSchema({ facets: { status: { display: "chips", showCounts: true } } }),
      "tasks:screen:task-list",
      dispatcher,
    );
    await waitFor(() => {
      const chips = getCapturedProps()?.filterFacets?.[0]?.chips;
      expect(chips?.map((chip) => chip.count)).toEqual([7, 3]);
    });
    const countCalls = queryCalls.filter(
      (call) => (call.payload as { limit?: number }).limit === 1,
    );
    expect(countCalls.length).toBeGreaterThanOrEqual(2);
    expect(countCalls[0]?.payload).toMatchObject({ totalCount: true });
  });

  test("a facet set to false is not shown", async () => {
    queryCalls = [];
    capturedProps = undefined;
    renderScreen(statusSchema({ facets: { status: false } }), "tasks:screen:task-list");
    const props = await capturedFacets();
    expect(props.filterFacets ?? []).toHaveLength(0);
  });
});

describe("entityList defaultFilters", () => {
  test("the default filter is in the first query, and picking 'no filter' is not overridden by the default again", async () => {
    queryCalls = [];
    capturedProps = undefined;
    renderScreen(statusSchema({ defaultFilters: { status: ["open"] } }), "tasks:screen:task-list");
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));
    expect(filtersOf(queryCalls[0]?.payload)).toEqual([
      { field: "status", op: "in", value: ["open"] },
    ]);

    const props = await capturedFacets();
    const before = queryCalls.length;
    await act(async () => {
      props.onFilterChange?.("status", []);
    });
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(before));
    expect(filtersOf(queryCalls[queryCalls.length - 1]?.payload)).toBeUndefined();
  });

  test("a boolean default applies as a coerced boolean filter", async () => {
    queryCalls = [];
    const entity: EntityDefinition = {
      fields: { active: { type: "boolean", filterable: true, required: false } },
    };
    const screen: EntityListScreenDefinition = {
      id: "unit-list",
      type: "entityList",
      entity: "unit",
      columns: ["active"],
      defaultFilters: { active: true },
    };
    renderScreen(
      { featureName: "units", entities: { unit: entity }, screens: [screen] } as FeatureSchema,
      "units:screen:unit-list",
    );
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));
    expect(filtersOf(queryCalls[0]?.payload)).toEqual([
      { field: "active", op: "in", value: [true] },
    ]);
  });
});
