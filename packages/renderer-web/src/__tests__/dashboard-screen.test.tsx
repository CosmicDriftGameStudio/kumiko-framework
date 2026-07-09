import { describe, expect, test } from "bun:test";
import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { ExtensionSectionProps, FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import {
  DashboardBodyProvider,
  DispatcherProvider,
  ExtensionSectionsProvider,
  KumikoScreen,
} from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { WebDashboardBody } from "../app/dashboard-body";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils";

const dashboardScreen: DashboardScreenDefinition = {
  id: "overview",
  type: "dashboard",
  panels: [
    {
      kind: "stat",
      id: "uptime",
      label: "status:dashboard:uptime",
      query: "status:query:monitor:uptime-stat",
      valueField: "value",
      subField: "sub",
      toneField: "tone",
    },
    {
      kind: "list",
      id: "latest",
      label: "status:dashboard:latest",
      query: "status:query:incident:latest",
      columns: [{ field: "name", label: "status:dashboard:col-name" }],
    },
  ],
};

const schema: FeatureSchema = {
  featureName: "status",
  entities: {},
  screens: [dashboardScreen],
};

function makeDispatcher(): Dispatcher {
  return createMockDispatcher({
    query: (async (type: string) => {
      if (type === "status:query:monitor:uptime-stat") {
        return {
          isSuccess: true,
          data: { value: "99,98 %", sub: "letzte 90 Tage", tone: "positive" },
        };
      }
      return {
        isSuccess: true,
        data: { rows: [{ id: "i1", name: "API-Ausfall" }], nextCursor: null },
      };
    }) as unknown as Dispatcher["query"],
  });
}

describe("KumikoScreen dashboard", () => {
  test("ohne registrierten Body → Placeholder-Banner", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={schema} qn="status:screen:overview" />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("kumiko-screen-dashboard-placeholder")).toBeTruthy();
  });

  test("WebDashboardBody rendert Stat- und List-Panels aus den Queries", async () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={schema} qn="status:screen:overview" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByText("99,98 %")).toBeTruthy());
    expect(screen.getByTestId("dashboard-overview")).toBeTruthy();
    // Stat-Panel: Label (Key-Fallback), Wert, Sub-Zeile aus dem Query-Record.
    expect(screen.getByText("status:dashboard:uptime")).toBeTruthy();
    expect(screen.getByText("letzte 90 Tage")).toBeTruthy();
    // List-Panel: Row aus der paged envelope.
    await waitFor(() => expect(screen.getByText("API-Ausfall")).toBeTruthy());
  });
});

const richScreen: DashboardScreenDefinition = {
  id: "rich",
  type: "dashboard",
  filter: {
    id: "region",
    label: "widgets:dashboard:filter-region",
    kind: "select",
    options: [
      { value: "eu", label: "widgets:dashboard:filter-region-eu" },
      { value: "us", label: "widgets:dashboard:filter-region-us" },
    ],
  },
  panels: [
    {
      kind: "stat",
      id: "kpi",
      label: "widgets:dashboard:kpi",
      query: "widgets:query:metrics:kpi",
      valueField: "value",
    },
    {
      kind: "stat-group",
      id: "net-worth",
      label: "widgets:dashboard:net-worth",
      stats: [
        {
          kind: "stat",
          id: "assets",
          label: "widgets:dashboard:assets",
          query: "widgets:query:metrics:assets",
          valueField: "value",
        },
      ],
    },
    {
      kind: "feed",
      id: "upcoming",
      label: "widgets:dashboard:upcoming",
      query: "widgets:query:metrics:upcoming",
    },
    {
      kind: "progress-list",
      id: "goal-progress",
      label: "widgets:dashboard:goal-progress",
      query: "widgets:query:metrics:goal-progress",
    },
    {
      kind: "custom",
      id: "custom-panel",
      component: { react: { __component: "rich-dashboard-custom" } },
    },
  ],
};

const richSchema: FeatureSchema = {
  featureName: "widgets",
  entities: {},
  screens: [richScreen],
};

describe("KumikoScreen dashboard — neue Panel-Kinds", () => {
  test("stat-group rendert Sektions-Titel + genestete Stat-Panels", async () => {
    const dispatcher = createMockDispatcher({
      query: (async (type: string) => {
        if (type === "widgets:query:metrics:assets") {
          return { isSuccess: true, data: { value: "120.000 €" } };
        }
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );
    expect(screen.getByText("widgets:dashboard:net-worth")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("120.000 €")).toBeTruthy());
  });

  test("feed-Panel rendert primary/trailing-Zeilen", async () => {
    const dispatcher = createMockDispatcher({
      query: (async (type: string) => {
        if (type === "widgets:query:metrics:upcoming") {
          return {
            isSuccess: true,
            data: { rows: [{ primary: "Zinsanpassung", trailing: "Aug 2026" }] },
          };
        }
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByText("Zinsanpassung")).toBeTruthy());
    expect(screen.getByText("Aug 2026")).toBeTruthy();
  });

  test("progress-list-Panel rendert Label/Wert + Fortschrittsbalken", async () => {
    const dispatcher = createMockDispatcher({
      query: (async (type: string) => {
        if (type === "widgets:query:metrics:goal-progress") {
          return {
            isSuccess: true,
            data: { rows: [{ label: "Baudarlehen", value: "42.000 € offen", fraction: 0.71 }] },
          };
        }
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByText("Baudarlehen")).toBeTruthy());
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("71");
  });

  test("custom-Panel: registrierte Komponente rendert mit screenId + filterParams", async () => {
    function CustomEcho({ screenId, filterParams }: ExtensionSectionProps): ReactNode {
      return (
        <div data-testid="custom-echo">
          {screenId}:{String(filterParams?.["region"] ?? "none")}
        </div>
      );
    }
    const dispatcher = createMockDispatcher();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <ExtensionSectionsProvider value={{ "rich-dashboard-custom": CustomEcho }}>
          <DashboardBodyProvider value={WebDashboardBody}>
            <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
          </DashboardBodyProvider>
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("custom-echo")).toBeTruthy());
    expect(screen.getByTestId("custom-echo").textContent).toBe("rich:none");
  });

  test("custom-Panel: unregistrierte Komponente rendert nichts, wirft nicht", async () => {
    const dispatcher = createMockDispatcher();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dashboard-panel-kpi")).toBeTruthy());
    expect(screen.queryByTestId("custom-echo")).toBeNull();
  });

  test("Filter-Wechsel refetcht Stat- UND Feed-Panel mit neuem Payload", async () => {
    const calls: { readonly type: string; readonly payload: unknown }[] = [];
    const dispatcher = createMockDispatcher({
      query: (async (type: string, payload: unknown) => {
        calls.push({ type, payload });
        const region = (payload as { readonly region?: string } | undefined)?.region;
        if (type === "widgets:query:metrics:kpi") {
          return { isSuccess: true, data: { value: region === "us" ? "38.120 $" : "92.753 €" } };
        }
        if (type === "widgets:query:metrics:upcoming") {
          return {
            isSuccess: true,
            data: {
              rows: [{ primary: region === "us" ? "US-Event" : "EU-Event" }],
            },
          };
        }
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["query"],
    });
    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByText("92.753 €")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("EU-Event")).toBeTruthy());

    await user.click(screen.getByTestId("combobox-dashboard-filter-region"));
    const usOption = await screen.findByText("widgets:dashboard:filter-region-us");
    await user.click(usOption);

    await waitFor(() => expect(screen.getByText("38.120 $")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("US-Event")).toBeTruthy());
  });
});
