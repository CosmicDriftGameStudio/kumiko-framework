// ProjectionListBody had neither `filter` nor faceted filters —
// only EntityListBody did (see kumiko-screen.tsx's buildFilterPayload/
// buildFilterFacets doc). This proves both directions of the fix: entityList
// keeps its exact pre-refactor payload/facet behavior after the shared
// function extraction, and projectionList gains the same capability —
// screen.filter and screen.facets reach payload.filter/payload.filters,
// with boolean facets coerced from URL-state strings to real booleans.

import { describe, expect, test } from "bun:test";
import {
  type EntityDefinition,
  type EntityListScreenDefinition,
  type ProjectionListScreenDefinition,
  translationValueOtherText,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { act, render, waitFor } from "@testing-library/react";
import { type ComponentType, type ReactNode, useState } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { REFERENCE_COMBOBOX_LIMIT } from "../../hooks/reference-limits.ts";
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
  initialParams = {},
}: {
  readonly children: ReactNode;
  readonly initialParams?: Record<string, string>;
}): ReactNode {
  const [params, setParams] = useState<Record<string, string>>(initialParams);
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
  initialParams: Record<string, string> = {},
): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE", timeZone })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <StatefulNav initialParams={initialParams}>
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen schema={schema} qn={qn} />
          </PrimitivesProvider>
        </StatefulNav>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

function stubDispatcherByType(
  responses: Readonly<Record<string, { rows: readonly Record<string, unknown>[] }>>,
): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async (type: string, payload: unknown) => {
      queryCalls.push({ type, payload });
      const rows = responses[type]?.rows ?? [];
      return { isSuccess: true, data: { rows, nextCursor: null } };
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

describe("entityList facets — unchanged after the shared buildFilterFacets/buildFilterPayload extraction", () => {
  test("a filterable boolean field renders as a facet, and toggling it sends a coerced boolean in payload.filters", async () => {
    queryCalls = [];
    capturedProps = undefined;
    const entity: EntityDefinition = {
      fields: {
        active: { type: "boolean", filterable: true, required: false },
      },
    };
    const screen: EntityListScreenDefinition = {
      id: "unit-list",
      type: "entityList",
      entity: "unit",
      columns: ["active"],
    };
    const schema: FeatureSchema = {
      featureName: "units",
      entities: { unit: entity },
      screens: [screen],
    } as FeatureSchema;

    renderScreen(schema, "units:screen:unit-list");

    await waitFor(() => expect(capturedProps).toBeDefined());
    const props = getCapturedProps();
    if (props === undefined) throw new Error("DataTable was not rendered");
    expect(props.filterFacets).toHaveLength(1);
    expect(props.filterFacets?.[0]?.field).toBe("active");
    expect(props.filterFacets?.[0]?.options).toEqual([
      { value: "true", label: expect.any(String) },
      { value: "false", label: expect.any(String) },
    ]);

    const countBeforeToggle = queryCalls.length;
    await act(async () => {
      props.onFilterChange?.("active", ["true"]);
    });
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(countBeforeToggle));
    const lastPayload = queryCalls[queryCalls.length - 1]?.payload;
    expect(lastPayload).toMatchObject({
      filters: [{ field: "active", op: "in", value: [true] }],
    });
  });
});

describe("projectionList filter + facets", () => {
  test("screen.filter is sent verbatim in the query payload", async () => {
    queryCalls = [];
    const screen: ProjectionListScreenDefinition = {
      id: "member-list",
      type: "projectionList",
      query: "ledger:query:member:list",
      columns: ["status"],
      filter: { field: "tier", op: "eq", value: "gold" },
    };
    const schema: FeatureSchema = {
      featureName: "ledger",
      entities: {},
      screens: [screen],
    } as FeatureSchema;

    renderScreen(schema, "ledger:screen:member-list");

    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));
    expect(queryCalls[0]?.payload).toMatchObject({
      filter: { field: "tier", op: "eq", value: "gold" },
    });
  });

  test("a boolean facet renders with the screen's explicit labels, and toggling it sends a coerced boolean in payload.filters", async () => {
    queryCalls = [];
    capturedProps = undefined;
    const screen: ProjectionListScreenDefinition = {
      id: "member-list",
      type: "projectionList",
      query: "ledger:query:member:list",
      columns: ["active"],
      facets: [
        {
          field: "active",
          type: "boolean",
          label: "Active",
          trueLabel: "Active",
          falseLabel: "Inactive",
        },
      ],
    };
    const schema: FeatureSchema = {
      featureName: "ledger",
      entities: {},
      screens: [screen],
    } as FeatureSchema;

    renderScreen(schema, "ledger:screen:member-list");

    await waitFor(() => expect(capturedProps).toBeDefined());
    const props = getCapturedProps();
    if (props === undefined) throw new Error("DataTable was not rendered");
    expect(props.filterFacets).toEqual([
      {
        field: "active",
        label: "Active",
        options: [
          { value: "true", label: "Active" },
          { value: "false", label: "Inactive" },
        ],
      },
    ]);

    const countBeforeToggle = queryCalls.length;
    await act(async () => {
      props.onFilterChange?.("active", ["true"]);
    });
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(countBeforeToggle));
    const lastPayload = queryCalls[queryCalls.length - 1]?.payload;
    expect(lastPayload).toMatchObject({
      filters: [{ field: "active", op: "in", value: [true] }],
    });
  });

  // Labels without a translation key must pass through unchanged —
  // otherwise shipping translate() alone regresses Members filters to raw keys
  // when locale packs are missing.
  test("projection facet labels without a translation key pass through unchanged", async () => {
    queryCalls = [];
    capturedProps = undefined;
    const screen: ProjectionListScreenDefinition = {
      id: "member-list",
      type: "projectionList",
      query: "ledger:query:member:list",
      columns: ["tier", "active"],
      facets: [
        {
          field: "tier",
          type: "select",
          label: "ledger.member.tier",
          options: [
            { value: "gold", label: "ledger.member.tier.gold" },
            { value: "silver", label: "ledger.member.tier.silver" },
          ],
        },
        {
          field: "active",
          type: "boolean",
          label: "ledger.member.active",
          trueLabel: "ledger.member.active.true",
          falseLabel: "ledger.member.active.false",
        },
      ],
    };
    const schema: FeatureSchema = {
      featureName: "ledger",
      entities: {},
      screens: [screen],
    } as FeatureSchema;

    renderScreen(schema, "ledger:screen:member-list");

    await waitFor(() => expect(capturedProps).toBeDefined());
    const props = getCapturedProps();
    if (props === undefined) throw new Error("DataTable was not rendered");
    expect(props.filterFacets).toEqual([
      {
        field: "tier",
        label: "ledger.member.tier",
        options: [
          { value: "gold", label: "ledger.member.tier.gold" },
          { value: "silver", label: "ledger.member.tier.silver" },
        ],
      },
      {
        field: "active",
        label: "ledger.member.active",
        options: [
          { value: "true", label: "ledger.member.active.true" },
          { value: "false", label: "ledger.member.active.false" },
        ],
      },
    ]);
  });

  test("projection facet labels resolve when a translation key exists", async () => {
    queryCalls = [];
    capturedProps = undefined;
    const screen: ProjectionListScreenDefinition = {
      id: "member-list",
      type: "projectionList",
      query: "ledger:query:member:list",
      columns: ["tier"],
      facets: [
        {
          field: "tier",
          type: "select",
          label: "kumiko.actions.save",
          options: [{ value: "gold", label: "kumiko.actions.cancel" }],
        },
      ],
    };
    const schema: FeatureSchema = {
      featureName: "ledger",
      entities: {},
      screens: [screen],
    } as FeatureSchema;

    renderScreen(schema, "ledger:screen:member-list");

    await waitFor(() => expect(capturedProps).toBeDefined());
    const props = getCapturedProps();
    if (props === undefined) throw new Error("DataTable was not rendered");
    const facet = props.filterFacets?.[0];
    // The harness renders de-DE, but only the `en` default bundle ships in the
    // framework (de lives in a locale package), so de-DE resolves through it.
    const en = kumikoDefaultTranslations["en"];
    if (en === undefined) throw new Error("missing en default translations");
    const save = en["kumiko.actions.save"];
    const cancel = en["kumiko.actions.cancel"];
    expect(facet?.label).toBe(save === undefined ? undefined : translationValueOtherText(save));
    expect(facet?.options?.[0]?.label).toBe(
      cancel === undefined ? undefined : translationValueOtherText(cancel),
    );
  });

  test("a reference facet loads its options from the referenced entity's list query, and selecting one sends an id filter", async () => {
    queryCalls = [];
    capturedProps = undefined;
    const dispatcher = stubDispatcherByType({
      "ledger:query:member:list": { rows: [] },
      "ledger:query:tenant:list": {
        rows: [
          { id: "t1", name: "Acme" },
          { id: "t2", name: "Globex" },
        ],
      },
    });
    const screen: ProjectionListScreenDefinition = {
      id: "member-list",
      type: "projectionList",
      query: "ledger:query:member:list",
      columns: ["tenantId"],
      facets: [
        {
          field: "tenantId",
          type: "reference",
          label: "Tenant",
          entity: "tenant",
          labelField: "name",
        },
      ],
    };
    const schema: FeatureSchema = {
      featureName: "ledger",
      entities: {},
      screens: [screen],
    } as FeatureSchema;

    renderScreen(schema, "ledger:screen:member-list", dispatcher);

    await waitFor(() =>
      expect(queryCalls.some((c) => c.type === "ledger:query:tenant:list")).toBe(true),
    );
    await waitFor(() => expect(getCapturedProps()?.filterFacets?.[0]?.options).toHaveLength(2));
    const props = getCapturedProps();
    if (props === undefined) throw new Error("DataTable was not rendered");
    expect(props.filterFacets).toEqual([
      {
        field: "tenantId",
        label: "Tenant",
        options: [
          { value: "t1", label: "Acme" },
          { value: "t2", label: "Globex" },
        ],
        onSearchChange: expect.any(Function),
        searching: false,
      },
    ]);

    const countBeforeSelect = queryCalls.length;
    await act(async () => {
      props.onFilterChange?.("tenantId", ["t1"]);
    });
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(countBeforeSelect));
    const lastPayload = queryCalls[queryCalls.length - 1]?.payload;
    expect(lastPayload).toMatchObject({
      filters: [{ field: "tenantId", op: "in", value: ["t1"] }],
    });
  });

  describe("reference facet beyond the first option page", () => {
    const TENANT_COUNT = 300;
    const tenants = Array.from({ length: TENANT_COUNT }, (_, i) => ({
      id: `t${i + 1}`,
      name: `Tenant ${i + 1}`,
    }));
    const memberScreen: ProjectionListScreenDefinition = {
      id: "member-list",
      type: "projectionList",
      query: "ledger:query:member:list",
      columns: ["tenantId"],
      facets: [
        {
          field: "tenantId",
          type: "reference",
          label: "Tenant",
          entity: "tenant",
          labelField: "name",
        },
      ],
    };
    const schema = {
      featureName: "ledger",
      entities: {},
      screens: [memberScreen],
    } as FeatureSchema;

    // Mirrors an entity list handler: `search` narrows by name, an `id in` filter by id, `limit` caps the page.
    function answerTenantList(payload: unknown): { rows: Array<Record<string, unknown>> } {
      const { search, limit, filters } = payload as {
        readonly search?: string;
        readonly limit: number;
        readonly filters?: readonly { field: string; op: string; value: readonly string[] }[];
      };
      const idFilter = filters?.find((filter) => filter.field === "id" && filter.op === "in");
      const matching = tenants.filter(
        (row) =>
          (search === undefined || row.name.includes(search)) &&
          (idFilter === undefined || idFilter.value.includes(row.id)),
      );
      return { rows: matching.slice(0, limit) };
    }

    function tenantDispatcher(): Dispatcher {
      return {
        ...stubDispatcher(),
        query: (async (type: string, payload: unknown) => {
          queryCalls.push({ type, payload });
          return {
            isSuccess: true,
            data: type === "ledger:query:tenant:list" ? answerTenantList(payload) : { rows: [] },
          };
        }) as unknown as Dispatcher["query"],
      };
    }

    test("searching finds a row beyond the first page and selecting it filters the list", async () => {
      queryCalls = [];
      capturedProps = undefined;
      renderScreen(schema, "ledger:screen:member-list", tenantDispatcher());
      await waitFor(() =>
        expect(getCapturedProps()?.filterFacets?.[0]?.options).toHaveLength(
          REFERENCE_COMBOBOX_LIMIT,
        ),
      );
      const firstFacet = getCapturedProps()?.filterFacets?.[0];
      expect(firstFacet?.options.some((option) => option.value === "t250")).toBe(false);

      await act(async () => {
        firstFacet?.onSearchChange?.("Tenant 250");
      });
      await waitFor(() =>
        expect(getCapturedProps()?.filterFacets?.[0]?.options).toEqual([
          { value: "t250", label: "Tenant 250" },
        ]),
      );

      await act(async () => {
        getCapturedProps()?.onFilterChange?.("tenantId", ["t250"]);
      });
      await waitFor(() =>
        expect(queryCalls[queryCalls.length - 1]?.payload).toMatchObject({
          filters: [{ field: "tenantId", op: "in", value: ["t250"] }],
        }),
      );
    });

    test("a value chosen from the URL keeps its label although it is not on the first page", async () => {
      queryCalls = [];
      capturedProps = undefined;
      renderScreen(schema, "ledger:screen:member-list", tenantDispatcher(), "UTC", {
        "member-list.f.tenantId": "t250",
      });
      await waitFor(() =>
        expect(getCapturedProps()?.filterFacets?.[0]?.options).toContainEqual({
          value: "t250",
          label: "Tenant 250",
        }),
      );
      expect(getCapturedProps()?.filterFacets?.[0]?.options).toHaveLength(
        REFERENCE_COMBOBOX_LIMIT + 1,
      );
    });
  });

  test("a reference facet on a field with an optionsQuery asks that handler for options and chosen rows", async () => {
    queryCalls = [];
    capturedProps = undefined;
    const optionsRows = [
      { id: "a1", label: "Alpha GmbH" },
      { id: "b2", label: "Beta AG" },
    ];
    const dispatcher: Dispatcher = {
      ...stubDispatcher(),
      query: (async (type: string, payload: unknown) => {
        queryCalls.push({ type, payload });
        if (type !== "ledger:query:tenant-options") {
          return { isSuccess: true, data: { rows: [] } };
        }
        const { search, ids } = payload as { search?: string; ids?: readonly string[] };
        const rows = optionsRows.filter(
          (row) =>
            (search === undefined || row.label.includes(search)) &&
            (ids === undefined || ids.includes(row.id)),
        );
        return { isSuccess: true, data: { rows } };
      }) as unknown as Dispatcher["query"],
    };
    const entity: EntityDefinition = {
      fields: {
        tenantId: {
          type: "reference",
          entity: "tenant",
          labelField: "name",
          optionsQuery: "ledger:query:tenant-options",
          filterable: true,
          required: false,
        },
      },
    } as unknown as EntityDefinition;
    const screen: EntityListScreenDefinition = {
      id: "member-list",
      type: "entityList",
      entity: "member",
      columns: ["tenantId"],
    };
    const schema = {
      featureName: "ledger",
      entities: { member: entity },
      screens: [screen],
    } as unknown as FeatureSchema;

    renderScreen(schema, "ledger:screen:member-list", dispatcher, "UTC", {
      "member-list.f.tenantId": "b2",
    });
    await waitFor(() =>
      expect(getCapturedProps()?.filterFacets?.[0]?.options).toEqual([
        { value: "a1", label: "Alpha GmbH" },
        { value: "b2", label: "Beta AG" },
      ]),
    );
    expect(queryCalls.some((call) => call.type === "ledger:query:tenant:list")).toBe(false);

    await act(async () => {
      getCapturedProps()?.filterFacets?.[0]?.onSearchChange?.("Beta");
    });
    await waitFor(() =>
      expect(getCapturedProps()?.filterFacets?.[0]?.options).toEqual([
        { value: "b2", label: "Beta AG" },
      ]),
    );
  });
});

// A dateRange facet is the first facet that does NOT travel in
// payload.filters — its two bounds go out as the top-level params the screen
// declares. A screen may declare it as its only facet, so the wiring must not
// hang off the option-facet path.
describe("projectionList dateRange facet", () => {
  const dateRangeScreen: ProjectionListScreenDefinition = {
    id: "event-list",
    type: "projectionList",
    query: "ledger:query:event:list",
    columns: ["createdAt"],
    facets: [
      {
        field: "createdAt",
        type: "dateRange",
        label: "When",
        params: { from: "from", to: "to" },
      },
    ],
  };
  const schema: FeatureSchema = {
    featureName: "ledger",
    entities: {},
    screens: [dateRangeScreen],
  } as FeatureSchema;

  test("reaches the DataTable as a dateRange facet, not as a filter dropdown", async () => {
    queryCalls = [];
    capturedProps = undefined;
    renderScreen(schema, "ledger:screen:event-list");

    await waitFor(() => expect(capturedProps).toBeDefined());
    const props = getCapturedProps();
    if (props === undefined) throw new Error("DataTable was not rendered");
    expect(props.dateRangeFacets).toEqual([
      { field: "createdAt", label: "When", from: "", to: "" },
    ]);
    expect(props.filterFacets).toBeUndefined();
    // Reset still has to be reachable on a dateRange-only screen.
    expect(props.onFilterReset).toBeDefined();
    expect(queryCalls[0]?.payload).not.toHaveProperty("from");
  });

  test("picking a bound sends it as the declared query param, in the viewer's zone", async () => {
    queryCalls = [];
    capturedProps = undefined;
    renderScreen(schema, "ledger:screen:event-list", stubDispatcher(), "Europe/Vienna");

    await waitFor(() => expect(capturedProps).toBeDefined());
    const before = queryCalls.length;
    await act(async () => {
      getCapturedProps()?.onDateRangeChange?.("createdAt", "to", "2020-06-14");
    });
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(before));
    const payload = queryCalls[queryCalls.length - 1]?.payload;
    // Open interval: only the bound the user picked travels.
    expect(payload).toMatchObject({ to: "2020-06-14T21:59:59.999999999Z" });
    expect(payload).not.toHaveProperty("from");
    expect(payload).not.toHaveProperty("filters");
    expect(getCapturedProps()?.dateRangeFacets).toEqual([
      { field: "createdAt", label: "When", from: "", to: "2020-06-14" },
    ]);
  });

  test("a `from` past the current `to` is clamped before it can reach the handler's refine", async () => {
    queryCalls = [];
    capturedProps = undefined;
    renderScreen(schema, "ledger:screen:event-list", stubDispatcher(), "Europe/Vienna");

    await waitFor(() => expect(capturedProps).toBeDefined());
    await act(async () => {
      getCapturedProps()?.onDateRangeChange?.("createdAt", "to", "2020-06-14");
    });
    await act(async () => {
      getCapturedProps()?.onDateRangeChange?.("createdAt", "from", "2020-06-20");
    });
    await waitFor(() =>
      expect(getCapturedProps()?.dateRangeFacets).toEqual([
        { field: "createdAt", label: "When", from: "2020-06-20", to: "2020-06-20" },
      ]),
    );
    const payload = queryCalls[queryCalls.length - 1]?.payload as Record<string, string>;
    const from = payload["from"];
    const to = payload["to"];
    expect(from).toBeString();
    expect(to).toBeString();
    expect((from ?? "") <= (to ?? "")).toBe(true);
  });
});
