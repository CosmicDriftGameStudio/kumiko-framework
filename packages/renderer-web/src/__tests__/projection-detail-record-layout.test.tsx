// projectionDetail record header + metrics band + tabs (fw record-screen-type).

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema, NavApi } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen, NavProvider } from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils";

const baseScreen: ProjectionDetailScreenDefinition = {
  id: "rent-detail",
  type: "projectionDetail",
  query: "rentals:query:rent:detail",
  idParam: "id",
  layout: {
    sections: [{ title: "Rent", fields: ["description"] }],
  },
};

const rowData = {
  description: "Loft 4B",
  tenantName: "Jamie Rivera",
  address: "12 Canal St",
  state: "active",
  balance: "120",
  overdueDays: "3",
};

function schemaFor(screen: ProjectionDetailScreenDefinition): FeatureSchema {
  return { featureName: "rentals", entities: {}, screens: [screen] };
}

function dispatcherReturning(
  data: Readonly<Record<string, unknown>>,
): Dispatcher & { readonly calls: { readonly type: string; readonly payload: unknown }[] } {
  const calls: { type: string; payload: unknown }[] = [];
  const query = (async (type: string, payload: unknown) => {
    calls.push({ type, payload });
    if (type === "rentals:query:rent:detail") return { isSuccess: true, data };
    return { isSuccess: true, data: { rows: [], nextCursor: null } };
  }) as unknown as Dispatcher["query"];
  const dispatcher = createMockDispatcher({ query });
  return Object.assign(dispatcher, { calls });
}

describe("KumikoScreen / projectionDetail — record header + metrics band", () => {
  test("renders header title/subtitle/status from the query row's named columns", async () => {
    const headerScreen: ProjectionDetailScreenDefinition = {
      ...baseScreen,
      header: { title: "tenantName", subtitle: "address", status: "state" },
    };
    const dispatcher = dispatcherReturning(rowData);

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={schemaFor(headerScreen)}
          qn="rentals:screen:rent-detail"
          entityId="rent-1"
        />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    expect(screen.getByTestId("kumiko-screen-projection-detail-title").textContent).toBe(
      "Jamie Rivera",
    );
    expect(screen.getByTestId("kumiko-screen-projection-detail-subtitle").textContent).toBe(
      "12 Canal St",
    );
    expect(screen.getByTestId("kumiko-screen-projection-detail-status").textContent).toBe("active");
  });

  test("renders the metrics band with fieldLabels-translated labels and query-row values", async () => {
    const metricsScreen: ProjectionDetailScreenDefinition = {
      ...baseScreen,
      metrics: ["balance", "overdueDays"],
      fieldLabels: {
        balance: "rentals.detail.metric.balance",
        overdueDays: "rentals.detail.metric.overdueDays",
      },
    };
    const dispatcher = dispatcherReturning(rowData);

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={schemaFor(metricsScreen)}
          qn="rentals:screen:rent-detail"
          entityId="rent-1"
        />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    expect(
      screen.getByTestId("kumiko-screen-projection-detail-metric-balance-label").textContent,
    ).toBe("rentals.detail.metric.balance");
    expect(
      screen.getByTestId("kumiko-screen-projection-detail-metric-balance-value").textContent,
    ).toBe("120");
    expect(
      screen.getByTestId("kumiko-screen-projection-detail-metric-overdueDays-value").textContent,
    ).toBe("3");
  });

  test("without header/metrics, neither renders — regression protection for existing screens", async () => {
    const dispatcher = dispatcherReturning(rowData);

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={schemaFor(baseScreen)}
          qn="rentals:screen:rent-detail"
          entityId="rent-1"
        />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    expect(screen.queryByTestId("kumiko-screen-projection-detail-title")).toBeNull();
    expect(screen.queryByTestId("kumiko-screen-projection-detail-metrics")).toBeNull();
  });
});

describe("KumikoScreen / projectionDetail — layout.mode: 'tabs'", () => {
  const tabsScreen: ProjectionDetailScreenDefinition = {
    ...baseScreen,
    layout: {
      mode: "tabs",
      sections: [
        { id: "overview", title: "Overview", fields: ["description"] },
        {
          id: "payments",
          kind: "relatedList",
          title: "Payments",
          query: "rentals:query:rent:payments",
          columns: [{ field: "amount", label: "Amount" }],
        },
        {
          id: "invoices",
          kind: "relatedList",
          title: "Invoices",
          query: "rentals:query:rent:invoices",
          columns: [{ field: "amount", label: "Amount" }],
        },
      ],
    },
  };

  function navWithTab(tab: string | undefined): {
    readonly navApi: NavApi;
    readonly setSearchParamsCalls: Readonly<Record<string, string | null>>[];
  } {
    const setSearchParamsCalls: Readonly<Record<string, string | null>>[] = [];
    return {
      navApi: {
        route: undefined,
        navigate: () => {},
        replace: () => {},
        hrefFor: () => "",
        searchParams: tab !== undefined ? { tab } : {},
        setSearchParams: (updates) => setSearchParamsCalls.push(updates),
      },
      setSearchParamsCalls,
    };
  }

  test("fires exactly one query on first render — the inactive tabs' relatedList queries never fire", async () => {
    const dispatcher = dispatcherReturning(rowData);
    const { navApi } = navWithTab(undefined);

    render(
      <NavProvider value={navApi}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={schemaFor(tabsScreen)}
            qn="rentals:screen:rent-detail"
            entityId="rent-1"
          />
        </DispatcherProvider>
      </NavProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    expect(dispatcher.calls).toHaveLength(1);
    expect(dispatcher.calls[0]?.type).toBe("rentals:query:rent:detail");
  });

  test("?tab= selects the matching section — its content renders, the others don't", async () => {
    const dispatcher = dispatcherReturning(rowData);
    const { navApi } = navWithTab("payments");

    render(
      <NavProvider value={navApi}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={schemaFor(tabsScreen)}
            qn="rentals:screen:rent-detail"
            entityId="rent-1"
          />
        </DispatcherProvider>
      </NavProvider>,
    );

    await waitFor(() =>
      expect(dispatcher.calls.some((c) => c.type === "rentals:query:rent:payments")).toBe(true),
    );
    expect(dispatcher.calls.some((c) => c.type === "rentals:query:rent:invoices")).toBe(false);
    expect(screen.queryByTestId("field-description")).toBeNull();
  });

  test("an unknown ?tab= value falls back to the first section", async () => {
    const dispatcher = dispatcherReturning(rowData);
    const { navApi } = navWithTab("does-not-exist");

    render(
      <NavProvider value={navApi}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={schemaFor(tabsScreen)}
            qn="rentals:screen:rent-detail"
            entityId="rent-1"
          />
        </DispatcherProvider>
      </NavProvider>,
    );

    await waitFor(() => screen.getByTestId("field-description"));
    expect(dispatcher.calls).toHaveLength(1);
  });

  test("clicking a tab calls nav.setSearchParams with the tab's id", async () => {
    const dispatcher = dispatcherReturning(rowData);
    const { navApi, setSearchParamsCalls } = navWithTab(undefined);
    const user = userEvent.setup();

    render(
      <NavProvider value={navApi}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={schemaFor(tabsScreen)}
            qn="rentals:screen:rent-detail"
            entityId="rent-1"
          />
        </DispatcherProvider>
      </NavProvider>,
    );

    const trigger = await waitFor(() =>
      screen.getByTestId("kumiko-screen-projection-detail-tabs-payments"),
    );
    await user.click(trigger);

    expect(setSearchParamsCalls).toContainEqual({ tab: "payments" });
  });
});

// Only guard against a solon-shaped screen (relatedList-heavy) silently regressing.
describe("KumikoScreen / projectionDetail — unchanged for a solon-shaped screen", () => {
  const solonShapedScreen: ProjectionDetailScreenDefinition = {
    ...baseScreen,
    layout: {
      sections: [
        { title: "Rent", fields: ["description"] },
        {
          kind: "relatedList",
          title: "Payments",
          query: "rentals:query:rent:payments",
          columns: [{ field: "amount", label: "Amount" }],
        },
        {
          kind: "relatedList",
          title: "Invoices",
          query: "rentals:query:rent:invoices",
          columns: [{ field: "amount", label: "Amount" }],
        },
      ],
    },
  };

  test("all sections render stacked, no tabs, all relatedList queries fire", async () => {
    const dispatcher = dispatcherReturning(rowData);

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={schemaFor(solonShapedScreen)}
          qn="rentals:screen:rent-detail"
          entityId="rent-1"
        />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("field-description"));
    await waitFor(() =>
      expect(dispatcher.calls.some((c) => c.type === "rentals:query:rent:payments")).toBe(true),
    );
    await waitFor(() =>
      expect(dispatcher.calls.some((c) => c.type === "rentals:query:rent:invoices")).toBe(true),
    );
    expect(screen.queryByTestId("kumiko-screen-projection-detail-tabs")).toBeNull();
  });
});
