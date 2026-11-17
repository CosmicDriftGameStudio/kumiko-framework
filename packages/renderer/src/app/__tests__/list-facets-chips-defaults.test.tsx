// entityList `facets` (chips, counts, extraOptions, hide) and `defaultFilters`.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { act, render, waitFor } from "@testing-library/react";
import { type ComponentType, type ReactNode, useState } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import {type DataTableProps, PrimitivesProvider } from "../../primitives.tsx";
import type { FeatureSchema } from "../feature-schema.ts";
import { KumikoScreen } from "../kumiko-screen.tsx";
import type { NavApi } from "../nav.tsx";
import { NavProvider } from "../nav.tsx";
import { createMockDispatcher, createStubPrimitives } from "../../testing.ts";

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

const testPrimitives = createStubPrimitives({
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
});

let queryCalls: Array<{ readonly type: string; readonly payload: unknown }> = [];

function stubDispatcher(): Dispatcher {
  return createMockDispatcher({
    write: async () => ({ isSuccess: true, data: {} }),
    query: async (type: string, payload: unknown) => {
      queryCalls.push({ type, payload });
      return { isSuccess: true, data: { rows: [], nextCursor: null } };
    },
    batch: async () => ({ isSuccess: true, results: [] }),
  });
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
  name: "status",
  fields: {
    status: { type: "select", options: ["open", "done"], filterable: true, required: false },
  },
};

function statusSchema(
  extra: Pick<EntityListScreenDefinition, "facets" | "defaultFilters">,
  entity: EntityDefinition = statusEntity,
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
    entities: { task: entity },
    screens: [screen],
  } as FeatureSchema;
}

async function capturedFacets(): Promise<DataTableProps> {
  await waitFor(() => expect(capturedProps).toBeDefined());
  const props = getCapturedProps();
  if (props === undefined) throw new Error("DataTable was not rendered");
  return props;
}

function aggregateOf(payload: unknown): { groupBy?: string; measures?: unknown } | undefined {
  return (payload as { aggregate?: { groupBy?: string; measures?: unknown } }).aggregate;
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

  test("showCounts: one grouped count query per facet field answers every chip", async () => {
    queryCalls = [];
    capturedProps = undefined;
    const dispatcher = createMockDispatcher({
      query: async (type: string, payload: unknown) => {
        queryCalls.push({ type, payload });
        if (aggregateOf(payload)?.groupBy === "status") {
          return {
            isSuccess: true,
            data: {
              groups: [
                { key: "open", count: 7, measures: [] },
                { key: "done", count: 3, measures: [] },
              ],
            },
          };
        }
        return { isSuccess: true, data: { rows: [], nextCursor: null } };
      },
    });
    renderScreen(
      statusSchema({
        facets: {
          status: {
            display: "chips",
            showCounts: true,
            extraOptions: [
              { id: "all", label: "All", values: [] },
              { id: "active", label: "Active", values: ["open", "done"], position: "end" },
            ],
          },
        },
      }),
      "tasks:screen:task-list",
      dispatcher,
    );
    await waitFor(() => {
      const chips = getCapturedProps()?.filterFacets?.[0]?.chips;
      expect(chips?.map((chip) => chip.count)).toEqual([10, 7, 3, 10]);
    });
    const groupCalls = queryCalls.filter(
      (call) => aggregateOf(call.payload)?.groupBy === "status",
    );
    expect(groupCalls.length).toBeGreaterThan(0);
    for (const call of groupCalls) {
      expect(aggregateOf(call.payload)).toEqual({ groupBy: "status", measures: [] });
      expect((call.payload as { limit?: number }).limit).toBeUndefined();
    }
    expect(
      queryCalls.some((call) => (call.payload as { limit?: number }).limit === 1),
    ).toBe(false);
  });

  test("the counted facet's own selection is left out, the other facets stay", async () => {
    queryCalls = [];
    capturedProps = undefined;
    const entity: EntityDefinition = {
      name: "entity",
      fields: {
        status: { type: "select", options: ["open", "done"], filterable: true, required: false },
        priority: { type: "select", options: ["high", "low"], filterable: true, required: false },
      },
    };
    renderScreen(
      statusSchema(
        {
          facets: { status: { display: "chips", showCounts: true } },
          defaultFilters: { status: ["open"], priority: ["high"] },
        },
        entity,
      ),
      "tasks:screen:task-list",
    );
    await waitFor(() => {
      expect(
        queryCalls.some((call) => aggregateOf(call.payload)?.groupBy === "status"),
      ).toBe(true);
    });
    const groupCall = queryCalls.find((call) => aggregateOf(call.payload)?.groupBy === "status");
    expect(filtersOf(groupCall?.payload)).toEqual([
      { field: "priority", op: "in", value: ["high"] },
    ]);
  });

  test("a truncated grouped answer leaves the chips without a count", async () => {
    queryCalls = [];
    capturedProps = undefined;
    const dispatcher = createMockDispatcher({
      query: async (type: string, payload: unknown) => {
        queryCalls.push({ type, payload });
        if (aggregateOf(payload)?.groupBy === "status") {
          return {
            isSuccess: true,
            data: { groups: [{ key: "open", count: 7, measures: [] }], truncated: true },
          };
        }
        return { isSuccess: true, data: { rows: [], nextCursor: null } };
      },
    });
    renderScreen(
      statusSchema({ facets: { status: { display: "chips", showCounts: true } } }),
      "tasks:screen:task-list",
      dispatcher,
    );
    await waitFor(() => {
      expect(
        queryCalls.some((call) => aggregateOf(call.payload)?.groupBy === "status"),
      ).toBe(true);
    });
    const chips = getCapturedProps()?.filterFacets?.[0]?.chips;
    expect(chips?.map((chip) => chip.count)).toEqual([undefined, undefined]);
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
      name: "entity",
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
