// projectionDetail record header + metrics band + tabs (fw record-screen-type).

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema, NavApi } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen, NavProvider } from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import {
  createMockDispatcher,
  render,
  renderWithPrimitivesOverride,
  screen,
  waitFor,
} from "./test-utils";

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

describe("KumikoScreen / projectionDetail — metric tiles render through the Metric primitive", () => {
  const metricsScreen: ProjectionDetailScreenDefinition = {
    ...baseScreen,
    metrics: ["balance"],
  };

  test("goes through the Metric primitive, not naked Text, when one is registered", async () => {
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
    // Only the Metric primitive assigns a testid to the tile itself — the
    // naked-Text fallback below only labels the -label/-value nodes. This
    // is red against the pre-fix code (naked Text, no tile testid).
    expect(screen.getByTestId("kumiko-screen-projection-detail-metric-balance")).toBeTruthy();
    expect(
      screen.getByTestId("kumiko-screen-projection-detail-metric-balance-value").textContent,
    ).toBe("120");
  });

  test("falls back to plain label/value Text when no Metric primitive is registered", async () => {
    const dispatcher = dispatcherReturning(rowData);

    renderWithPrimitivesOverride(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={schemaFor(metricsScreen)}
          qn="rentals:screen:rent-detail"
          entityId="rent-1"
        />
      </DispatcherProvider>,
      { Metric: undefined },
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    expect(
      screen.getByTestId("kumiko-screen-projection-detail-metric-balance-value").textContent,
    ).toBe("120");
    expect(screen.queryByTestId("kumiko-screen-projection-detail-metric-balance")).toBeNull();
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

  // Reactive nav stub — navWithTab's searchParams is fixed at mount, so it
  // can't exercise a real "click a tab, watch the active section change"
  // flow. Only used by the tab-switch test below.
  function StatefulTabNav({ children }: { readonly children: ReactNode }): ReactNode {
    const [tab, setTab] = useState<string | undefined>(undefined);
    const navApi: NavApi = {
      route: undefined,
      navigate: () => {},
      replace: () => {},
      hrefFor: () => "",
      searchParams: tab !== undefined ? { tab } : {},
      setSearchParams: (updates) => {
        const next = updates["tab"];
        setTab(next === null || next === undefined ? undefined : next);
      },
    };
    return <NavProvider value={navApi}>{children}</NavProvider>;
  }

  test("switching tabs does not remount the body or refire the detail query", async () => {
    const dispatcher = dispatcherReturning(rowData);
    const user = userEvent.setup();

    render(
      <StatefulTabNav>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={schemaFor(tabsScreen)}
            qn="rentals:screen:rent-detail"
            entityId="rent-1"
          />
        </DispatcherProvider>
      </StatefulTabNav>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    const detailCallsBefore = dispatcher.calls.filter(
      (c) => c.type === "rentals:query:rent:detail",
    ).length;
    expect(detailCallsBefore).toBe(1);

    const trigger = await waitFor(() =>
      screen.getByTestId("kumiko-screen-projection-detail-tabs-payments"),
    );
    await user.click(trigger);
    await waitFor(() =>
      expect(dispatcher.calls.some((c) => c.type === "rentals:query:rent:payments")).toBe(true),
    );

    // A `key` on the record identifier alone (fw#2518 fix) must not also
    // depend on the active tab — folding tab into the key would remount the
    // body on every tab click and refire this query. The pre-fix "fires
    // exactly one query" test above only checks first render and would not
    // have caught that regression.
    const detailCallsAfter = dispatcher.calls.filter(
      (c) => c.type === "rentals:query:rent:detail",
    ).length;
    expect(detailCallsAfter).toBe(detailCallsBefore);
  });

  test("tabs mode suppresses the form's own redundant title, not just section titles", async () => {
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
    // hideSectionTitles used to only blank out each Section's own title —
    // RenderEdit's own Form-level title (screen id/i18n fallback) rendered
    // unconditionally regardless, duplicating the active tab's label
    // whenever the two happened to read the same ("Mietvertrag" above the
    // table, matching the already-visible tab). This asserts the Form-level
    // title is gone too, not just the section ones.
    expect(screen.queryByTestId("render-edit-form-title")).toBeNull();
  });

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
    // Contrast for the tabs-mode "form title suppressed" test above — outside
    // tabs mode (hideSectionTitles unset) the form's own title still renders.
    expect(screen.getByTestId("render-edit-form-title")).toBeTruthy();
  });
});

describe("KumikoScreen / projectionDetail — switching records remounts the body (fw#2518)", () => {
  test("record A's fields are gone from the DOM after switching to record B", async () => {
    const dataById: Record<string, Readonly<Record<string, unknown>>> = {
      "rent-1": { description: "Loft 4B" },
      "rent-2": { description: "Warehouse 9" },
    };
    const query = (async (type: string, payload: unknown) => {
      if (type === "rentals:query:rent:detail") {
        const id = (payload as { id?: string }).id ?? "";
        return { isSuccess: true, data: dataById[id] ?? {} };
      }
      return { isSuccess: true, data: { rows: [], nextCursor: null } };
    }) as unknown as Dispatcher["query"];
    const dispatcher = createMockDispatcher({ query });

    const { rerender } = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={schemaFor(baseScreen)}
          qn="rentals:screen:rent-detail"
          entityId="rent-1"
        />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByText("Loft 4B"));

    rerender(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={schemaFor(baseScreen)}
          qn="rentals:screen:rent-detail"
          entityId="rent-2"
        />
      </DispatcherProvider>,
    );

    // Without the key fix, React keeps the old ProjectionDetailBody instance
    // mounted and briefly renders record A's fields until the new query
    // resolves. Asserting only the ABSENCE of "Loft 4B" would pass on flaky
    // timing even without the fix, so this also waits for record B's own
    // value to confirm the remount actually completed.
    await waitFor(() => screen.getByText("Warehouse 9"));
    expect(screen.queryByText("Loft 4B")).toBeNull();
  });
});
