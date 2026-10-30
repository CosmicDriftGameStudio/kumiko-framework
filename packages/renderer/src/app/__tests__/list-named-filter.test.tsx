// entityList `namedFilters`: URL key `<screenId>.filter` drives the list payload, facet counts and the removable chip.

import { afterEach, describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { type ComponentType, type ReactNode, useState } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { listResetUpdates } from "../../hooks/list-reset.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import { type CorePrimitives, type DataTableProps, PrimitivesProvider } from "../../primitives.tsx";
import type { FeatureSchema } from "../feature-schema.ts";
import { KumikoScreen } from "../kumiko-screen.tsx";
import type { NavApi } from "../nav.tsx";
import { NavProvider } from "../nav.tsx";

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
function StatefulNav({
  children,
  initial,
}: {
  readonly children: ReactNode;
  readonly initial: Record<string, string>;
}): ReactNode {
  const [params, setParams] = useState<Record<string, string>>(initial);
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

function renderScreen(schema: FeatureSchema, qn: string, urlParams: Record<string, string>): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE", timeZone: "UTC" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <StatefulNav initial={urlParams}>
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

const QN = "tasks:screen:task-list";

function taskSchema(
  extra: Pick<EntityListScreenDefinition, "facets" | "defaultFilters" | "namedFilters">,
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

const OVERDUE = [{ id: "overdue", label: "Überfällig" }];

afterEach(cleanup);

function reset(): void {
  queryCalls = [];
  capturedProps = undefined;
}

async function capturedTable(): Promise<DataTableProps> {
  await waitFor(() => expect(capturedProps).toBeDefined());
  const props = getCapturedProps();
  if (props === undefined) throw new Error("DataTable was not rendered");
  return props;
}

function namedFilterOf(payload: unknown): unknown {
  return (payload as { namedFilter?: unknown }).namedFilter;
}

describe("entityList namedFilters", () => {
  test("the URL key reaches the list payload and every facet count query", async () => {
    reset();
    renderScreen(
      taskSchema({
        namedFilters: OVERDUE,
        facets: { status: { display: "chips", showCounts: true } },
      }),
      QN,
      { "task-list.filter": "overdue" },
    );
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(2));
    expect(queryCalls.every((call) => namedFilterOf(call.payload) === "overdue")).toBe(true);
    expect(queryCalls.some((call) => (call.payload as { limit?: number }).limit === 1)).toBe(true);
  });

  test("without the URL key no namedFilter is sent", async () => {
    reset();
    renderScreen(taskSchema({ namedFilters: OVERDUE }), QN, {});
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));
    expect(namedFilterOf(queryCalls[0]?.payload)).toBeUndefined();
  });

  test("a screen without declared namedFilters ignores the URL key", async () => {
    reset();
    renderScreen(taskSchema({}), QN, { "task-list.filter": "overdue" });
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));
    expect(namedFilterOf(queryCalls[0]?.payload)).toBeUndefined();
  });

  test("the active filter shows as a chip and pressing it removes the filter", async () => {
    reset();
    renderScreen(taskSchema({ namedFilters: OVERDUE }), QN, { "task-list.filter": "overdue" });
    const props = await capturedTable();
    const facet = props.filterFacets?.find((f) => f.field === "__namedFilter");
    expect(facet?.chips?.map((chip) => chip.id)).toEqual(["overdue"]);
    expect(props.filterValues?.["__namedFilter"]).toEqual(["overdue"]);

    const before = queryCalls.length;
    await act(async () => {
      props.onFilterChange?.("__namedFilter", ["overdue"]);
    });
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(before));
    expect(namedFilterOf(queryCalls[queryCalls.length - 1]?.payload)).toBeUndefined();
    expect(JSON.stringify(queryCalls)).not.toContain("__namedFilter");
  });

  test("defaultFilters are not applied while a named filter is active", async () => {
    reset();
    renderScreen(taskSchema({ namedFilters: OVERDUE, defaultFilters: { status: ["open"] } }), QN, {
      "task-list.filter": "overdue",
    });
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));
    expect(queryCalls[0]?.payload).not.toHaveProperty("filters");
  });

  test("the .filter key does not collide with a field facet key and resets with the list", () => {
    const params = { "task-list.filter": "overdue", "task-list.f.status": "open" };
    expect(listResetUpdates(params, "task-list")).toEqual({
      "task-list.filter": null,
      "task-list.f.status": null,
    });
  });
});

describe("projectionList namedFilters", () => {
  const projectionSchema = (): FeatureSchema =>
    ({
      featureName: "leases",
      entities: {},
      screens: [
        {
          id: "lease-list",
          type: "projectionList",
          query: "leases:query:lease:list",
          columns: ["name"],
          namedFilters: OVERDUE,
        },
      ],
    }) as FeatureSchema;

  test("the URL key reaches the list query and the chip removes it", async () => {
    reset();
    renderScreen(projectionSchema(), "leases:screen:lease-list", {
      "lease-list.filter": "overdue",
    });
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));
    expect(queryCalls.every((call) => namedFilterOf(call.payload) === "overdue")).toBe(true);

    const props = await capturedTable();
    expect(props.filterFacets?.find((f) => f.field === "__namedFilter")?.chips).toHaveLength(1);
    const before = queryCalls.length;
    await act(async () => {
      props.onFilterChange?.("__namedFilter", ["overdue"]);
    });
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(before));
    expect(namedFilterOf(queryCalls[queryCalls.length - 1]?.payload)).toBeUndefined();
  });
});
