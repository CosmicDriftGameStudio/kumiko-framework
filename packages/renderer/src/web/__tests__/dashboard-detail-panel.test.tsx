// A projectionDetail embedded as a dashboard screen panel reads its record id from the
// dashboard's record binding (URL search param), runs inline and does not portal its header.

import { afterEach, describe, expect, test } from "bun:test";
import type {
  DashboardScreenDefinition,
  ProjectionDetailScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import {
  AppFeaturesProvider,
  DashboardBodyProvider,
  DispatcherProvider,
  KumikoScreen,
  NavProvider,
} from "../../index.ts";
import { WebDashboardBody } from "../app/dashboard-body.tsx";
import { useBrowserNavApi } from "../app/nav.tsx";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const DETAIL_QUERY = "sites:query:site:detail";

const detailScreen: ProjectionDetailScreenDefinition = {
  id: "site-detail",
  type: "projectionDetail",
  query: DETAIL_QUERY,
  recordTitleField: "name",
  layout: { sections: [{ title: "Site", fields: ["region"] }] },
};

const dashboard: DashboardScreenDefinition = {
  id: "site-board",
  type: "dashboard",
  showUpdatedAt: false,
  record: { param: "siteId", payloadKey: "id" },
  panels: [{ kind: "screen", id: "site", screen: "site-detail" }],
};

const schema: FeatureSchema = {
  featureName: "sites",
  entities: {},
  screens: [detailScreen, dashboard],
};

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("dashboard screen panel / projectionDetail", () => {
  test("runs the detail query with the dashboard's record id and renders its fields and header inline", async () => {
    window.history.replaceState(null, "", "/site-board?siteId=site-1");
    const payloads: unknown[] = [];
    const query = (async (_type: string, payload: unknown) => {
      payloads.push(payload);
      return { isSuccess: true, data: { id: "site-1", name: "Berlin Hub", region: "EU-North" } };
    }) as unknown as Dispatcher["query"];

    render(
      <BrowserNav>
        <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
          <AppFeaturesProvider features={[schema]}>
            <DashboardBodyProvider value={WebDashboardBody}>
              <KumikoScreen schema={schema} qn="sites:screen:site-board" />
            </DashboardBodyProvider>
          </AppFeaturesProvider>
        </DispatcherProvider>
      </BrowserNav>,
    );

    await waitFor(() => expect(screen.getByText("EU-North")).toBeTruthy());
    expect(payloads).toContainEqual({ id: "site-1" });
    const tile = screen.getByTestId("dashboard-panel-site");
    expect(tile.textContent).toContain("EU-North");
    expect(tile.textContent).toContain("Berlin Hub");
  });
});
