// Phone variants of dashboard panels: hidden panels, limited list cards, one-line list, short text, stat columns.
import { describe, expect, test } from "bun:test";
import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { Dispatcher } from "../../headless/index.ts";
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
  render,
  restoreViewportWidthAfterEach,
  screen,
  setViewportWidth,
  waitFor,
} from "./test-utils.tsx";

const PHONE_WIDTH = 500;
const DESKTOP_WIDTH = 1280;

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false, features: [] });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

type Handler = () => unknown;

function renderDashboard(
  dashboard: DashboardScreenDefinition,
  handlers: Readonly<Record<string, Handler>>,
): void {
  const dispatcher = createMockDispatcher({
    query: (async (type: string) => {
      const handler = handlers[type];
      return handler === undefined ? { isSuccess: true, data: {} } : handler();
    }) as unknown as Dispatcher["query"],
  });
  const schema: FeatureSchema = { featureName: "demo", entities: {}, screens: [dashboard] };
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <AppFeaturesProvider features={[]}>
        <BrowserNav>
          <DispatcherProvider dispatcher={dispatcher}>
            <DashboardBodyProvider value={WebDashboardBody}>
              <KumikoScreen schema={schema} qn={`demo:screen:${dashboard.id}`} />
            </DashboardBodyProvider>
          </DispatcherProvider>
        </BrowserNav>
      </AppFeaturesProvider>
    </LocaleProvider>,
  );
}

const ok = (data: unknown) => ({ isSuccess: true, data });

const ROWS = Array.from({ length: 5 }, (_unused, index) => ({
  id: `t${index}`,
  title: `Task ${index}`,
  due: `Due ${index}`,
  tone: "warn",
}));

const listPanel = (narrow: Record<string, unknown>) =>
  ({
    kind: "list",
    id: "open",
    label: "Open tasks",
    query: "demo:query:task:list",
    rowToneField: "tone",
    showTotal: true,
    footerLink: { screen: "demo:screen:all", label: "Show all" },
    columns: [{ field: "title", hint: { detailField: "due", plainSentence: true } }],
    narrow,
  }) as unknown as DashboardScreenDefinition["panels"][number];

const dashboardOf = (...panels: DashboardScreenDefinition["panels"][number][]) =>
  ({ id: "home", type: "dashboard", panels }) as DashboardScreenDefinition;

const listAnswer = () => ok({ rows: ROWS, total: 11 });

describe("dashboard panels on a phone", () => {
  restoreViewportWidthAfterEach();

  test("hideOnNarrow drops the panel below sm only", async () => {
    const dashboard = dashboardOf({
      kind: "text",
      id: "tips",
      blocks: [{ kind: "paragraph", text: "Tip" }],
      hideOnNarrow: true,
    });
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(dashboard, {});
    await waitFor(() => expect(screen.getByTestId("dashboard-panel-tips")).toBeTruthy());
  });

  test("hideOnNarrow leaves nothing on a phone", async () => {
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(
      dashboardOf(
        {
          kind: "text",
          id: "tips",
          blocks: [{ kind: "paragraph", text: "Tip" }],
          hideOnNarrow: true,
        },
        { kind: "text", id: "kept", blocks: [{ kind: "paragraph", text: "Kept" }] },
      ),
      {},
    );
    await waitFor(() => expect(screen.getByTestId("dashboard-panel-kept")).toBeTruthy());
    expect(screen.queryByTestId("dashboard-panel-tips")).toBeNull();
  });

  test("narrow cards show the first rows with a count in subtitle and footer", async () => {
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(dashboardOf(listPanel({ layout: "cards", limit: 3 })), {
      "demo:query:task:list": listAnswer,
    });
    await waitFor(() => expect(screen.getAllByTestId("dashboard-list-card")).toHaveLength(3));
    expect(screen.getByText("3 of 11")).toBeTruthy();
    expect(screen.getByText(/8 more/)).toBeTruthy();
    expect(screen.getByText("Due 0")).toBeTruthy();
  });

  test("narrow without a layout defaults to cards", async () => {
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(dashboardOf(listPanel({ limit: 2 })), {
      "demo:query:task:list": listAnswer,
    });
    await waitFor(() => expect(screen.getAllByTestId("dashboard-list-card")).toHaveLength(2));
  });

  test("the same list stays a table on a wide screen", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(dashboardOf(listPanel({ layout: "cards", limit: 3 })), {
      "demo:query:task:list": listAnswer,
    });
    await waitFor(() => expect(screen.getByText("Task 4")).toBeTruthy());
    expect(screen.queryAllByTestId("dashboard-list-card")).toHaveLength(0);
  });

  test("the line layout collapses the list to one link with the remaining count", async () => {
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(dashboardOf(listPanel({ layout: "line" })), {
      "demo:query:task:list": listAnswer,
    });
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-panel-open").textContent).toContain("10 more"),
    );
    const line = screen.getByTestId("dashboard-panel-open");
    expect(line.textContent).toContain("Open tasks");
    expect(line.textContent).toContain("Task 0");
  });

  test("narrowBlocks from the query replace the blocks below sm", async () => {
    const dashboard = dashboardOf({
      kind: "text",
      id: "brief",
      query: "demo:query:brief",
      blocks: [{ kind: "paragraph", text: "static" }],
    });
    const answer = () =>
      ok({
        blocks: [{ kind: "paragraph", text: "Long briefing" }],
        narrowBlocks: [{ kind: "paragraph", text: "Short briefing" }],
      });
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(dashboard, { "demo:query:brief": answer });
    await waitFor(() => expect(screen.getByText("Short briefing")).toBeTruthy());
    expect(screen.queryByText("Long briefing")).toBeNull();
  });

  test("static narrowBlocks replace the static blocks below sm", async () => {
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(
      dashboardOf({
        kind: "text",
        id: "help",
        blocks: [{ kind: "paragraph", text: "Long help" }],
        narrowBlocks: [{ kind: "paragraph", text: "Short help" }],
      }),
      {},
    );
    await waitFor(() => expect(screen.getByText("Short help")).toBeTruthy());
    expect(screen.queryByText("Long help")).toBeNull();
  });
});

describe("stat-group columns", () => {
  test("columns sets the card grid from md up and one column below sm", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(
      dashboardOf({
        kind: "stat-group",
        id: "numbers",
        label: "Numbers",
        layout: "cards",
        columns: 3,
        stats: [{ kind: "stat", id: "a", label: "A", query: "demo:query:a", valueField: "total" }],
      } as unknown as DashboardScreenDefinition["panels"][number]),
      { "demo:query:a": () => ok({ total: 1 }) },
    );
    const panel = await screen.findByTestId("dashboard-panel-numbers");
    const grid = panel.querySelector("section");
    expect(grid?.className).toContain("md:grid-cols-3");
    expect(grid?.className).toContain("grid-cols-1");
  });
});
