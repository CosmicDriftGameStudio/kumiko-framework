// A chromeless screen panel owns the section head (title + description) and the embedded
// form's submit row sits left under the fields; a screen-only dashboard has no "Stand" stamp.

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
import { defaultPrimitives, EmbeddedFormProvider } from "../primitives/index.tsx";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const detailScreen: ProjectionDetailScreenDefinition = {
  id: "site-detail",
  type: "projectionDetail",
  query: "sites:query:site:detail",
  description: "sites.detail.description",
  layout: { sections: [{ title: "Site", fields: ["region"] }] },
};

function dashboardWith(
  panels: DashboardScreenDefinition["panels"],
  id = "board",
): DashboardScreenDefinition {
  return { id, type: "dashboard", panels };
}

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

function renderBoard(board: DashboardScreenDefinition): void {
  const schema: FeatureSchema = {
    featureName: "sites",
    entities: {},
    screens: [detailScreen, board],
  };
  const query = (async (type: string) =>
    type === "sites:query:site:detail"
      ? { isSuccess: true, data: { id: "site-1", region: "EU-North" } }
      : { isSuccess: true, data: { value: "1" } }) as unknown as Dispatcher["query"];
  render(
    <BrowserNav>
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <AppFeaturesProvider features={[schema]}>
          <DashboardBodyProvider value={WebDashboardBody}>
            <KumikoScreen
              schema={schema}
              qn={`sites:screen:${board.id}`}
              translate={(key) => (key === "sites.detail.description" ? "About this site" : key)}
            />
          </DashboardBodyProvider>
        </AppFeaturesProvider>
      </DispatcherProvider>
    </BrowserNav>,
  );
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("chromeless screen panel head", () => {
  test("shows the embedded screen's title and description as the section head", async () => {
    window.history.replaceState(null, "", "/?siteId=site-1");
    renderBoard(
      dashboardWith([{ kind: "screen", id: "site", screen: "site-detail", chromeless: true }]),
    );
    await waitFor(() => expect(screen.getByTestId("dashboard-panel-site-title")).toBeTruthy());
    expect(screen.getByTestId("dashboard-panel-site-title").textContent).toBe("site-detail");
    expect(screen.getByTestId("dashboard-panel-site-description").textContent).toBe(
      "About this site",
    );
  });
});

describe("updated-at stamp", () => {
  test("a dashboard of only screen panels shows no stamp", async () => {
    window.history.replaceState(null, "", "/?siteId=site-1");
    renderBoard(
      dashboardWith([{ kind: "screen", id: "site", screen: "site-detail", chromeless: true }]),
    );
    await waitFor(() => expect(screen.getByTestId("dashboard-panel-site-title")).toBeTruthy());
    expect(screen.queryByTestId("dashboard-board-updated-at")).toBeNull();
  });

  test("a dashboard with a data panel keeps the stamp", async () => {
    renderBoard(
      dashboardWith([
        {
          kind: "stat",
          id: "count",
          label: "sites.count",
          query: "sites:query:count",
          valueField: "value",
        },
      ]),
    );
    await waitFor(() => expect(screen.getByTestId("dashboard-board-updated-at")).toBeTruthy());
  });
});

describe("embedded form submit row", () => {
  test("sits left under the fields without a divider", () => {
    const { Form } = defaultPrimitives;
    render(
      <EmbeddedFormProvider>
        <Form onSubmit={() => {}} testId="f" actions={<button type="submit">Send</button>}>
          <span>field</span>
        </Form>
      </EmbeddedFormProvider>,
    );
    const row = screen.getByTestId("f-footer");
    expect(row.className).not.toContain("border-t");
    expect(row.className).not.toContain("justify-end");
  });
});
