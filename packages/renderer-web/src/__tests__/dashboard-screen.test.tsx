import { describe, expect, test } from "bun:test";
import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import {
  DashboardBodyProvider,
  DispatcherProvider,
  KumikoScreen,
} from "@cosmicdrift/kumiko-renderer";
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
