// A dashboard list rowLink with presentation "popup" opens the row's projectionDetail in a popup; the href stays the page.
import { describe, expect, test } from "bun:test";
import type {
  DashboardListPanel,
  DashboardScreenDefinition,
  ProjectionDetailScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { ReactNode } from "react";
import type { QueryResult } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import {
  AppFeaturesProvider,
  createStaticLocaleResolver,
  DashboardBodyProvider,
  DispatcherProvider,
  KumikoScreen,
  kumikoDefaultTranslations,
  LocaleProvider,
  NavProvider,
} from "../../index.ts";
import { WebDashboardBody } from "../app/dashboard-body.tsx";
import { useBrowserNavApi } from "../app/nav.tsx";
import {
  createMockDispatcher,
  fireEvent,
  render,
  restoreViewportWidthAfterEach,
  screen,
  setViewportWidth,
  waitFor,
} from "./test-utils.tsx";

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false, features: [] });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

const ok = (data: unknown): QueryResult => ({ isSuccess: true, data });

const taskDetail: ProjectionDetailScreenDefinition = {
  id: "task-detail",
  type: "projectionDetail",
  query: "demo:query:task:detail",
  idParam: "id",
  layout: { sections: [{ id: "main", title: "Main", fields: ["title"] }] },
};

const dashboard = (presentation: "page" | "popup"): DashboardScreenDefinition => {
  const panel: DashboardListPanel = {
    kind: "list",
    id: "open",
    label: "Open tasks",
    query: "demo:query:task:list",
    columns: [{ field: "title" }],
    rowLink: { screen: "task-detail", paramField: "target", presentation },
  };
  return { id: "home", type: "dashboard", panels: [panel] } satisfies DashboardScreenDefinition;
};

const ROWS = [{ id: "t0", title: "Task 0", target: { entityId: "e0" } }];

function renderPopupDashboard(presentation: "page" | "popup"): {
  readonly queries: string[];
  readonly detailIds: unknown[];
} {
  const queries: string[] = [];
  const detailIds: unknown[] = [];
  const dispatcher = createMockDispatcher({
    query: async (type: string, payload: unknown) => {
      queries.push(type);
      if (type === "demo:query:task:list") return ok({ rows: ROWS });
      if (type === "demo:query:task:detail") {
        detailIds.push(propertyOf(payload, "id"));
        return ok({ id: "e0", title: "Task 0 detail" });
      }
      return ok({});
    },
  });
  const home = dashboard(presentation);
  const schema: FeatureSchema = {
    featureName: "demo",
    entities: {},
    screens: [home, taskDetail],
  };
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <AppFeaturesProvider features={[schema]}>
        <BrowserNav>
          <DispatcherProvider dispatcher={dispatcher}>
            <DashboardBodyProvider value={WebDashboardBody}>
              <KumikoScreen schema={schema} qn="demo:screen:home" />
            </DashboardBodyProvider>
          </DispatcherProvider>
        </BrowserNav>
      </AppFeaturesProvider>
    </LocaleProvider>,
  );
  return { queries, detailIds };
}

describe("dashboard list row popup", () => {
  restoreViewportWidthAfterEach();

  test("a click on the row opens the detail in a popup instead of navigating", async () => {
    setViewportWidth(1280);
    const before = window.location.href;
    const { detailIds } = renderPopupDashboard("popup");
    await waitFor(() => screen.getByText("Task 0"));
    fireEvent.click(screen.getByText("Task 0"));
    await waitFor(() => screen.getByTestId("toolbar-drawer-open"));
    await waitFor(() => screen.getByText("Task 0 detail"));
    expect(detailIds).toContain("e0");
    expect(window.location.href).toBe(before);
  });

  test("the icon link keeps the page as its href", async () => {
    setViewportWidth(1280);
    renderPopupDashboard("popup");
    await waitFor(() => screen.getByText("Task 0"));
    const link = screen.getByRole("link", { name: "Open" });
    expect(link.getAttribute("href")).toContain("e0");
    expect(link.getAttribute("href")).toContain("task-detail");
  });

  test("closing the popup reloads the panel queries", async () => {
    setViewportWidth(1280);
    const { queries } = renderPopupDashboard("popup");
    await waitFor(() => screen.getByText("Task 0"));
    const listLoadsBefore = queries.filter((type) => type === "demo:query:task:list").length;
    fireEvent.click(screen.getByText("Task 0"));
    await waitFor(() => screen.getByText("Task 0 detail"));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("toolbar-drawer-open")).toBeNull());
    await waitFor(() =>
      expect(queries.filter((type) => type === "demo:query:task:list").length).toBeGreaterThan(
        listLoadsBefore,
      ),
    );
  });

  test("without presentation popup the row click navigates and no popup opens", async () => {
    setViewportWidth(1280);
    renderPopupDashboard("page");
    await waitFor(() => screen.getByText("Task 0"));
    fireEvent.click(screen.getByText("Task 0"));
    expect(window.location.href).toContain("e0");
    expect(screen.queryByTestId("toolbar-drawer-open")).toBeNull();
  });
});
