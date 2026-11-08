// Dashboard board options: main/side columns, text panel icon, primary button column, stat-group child on a phone.
import { describe, expect, test } from "bun:test";
import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import {
  AppFeaturesProvider,
  DashboardBodyProvider,
  DispatcherProvider,
  type ExtensionSectionProps,
  ExtensionSectionsProvider,
  KumikoScreen,
  NavProvider,
} from "../../index.ts";
import { WebDashboardBody } from "../app/dashboard-body.tsx";
import { useBrowserNavApi } from "../app/nav.tsx";
import { LINK_BUTTON_CLASS, LINK_BUTTON_PRIMARY_CLASS } from "../primitives/data-table-cell.tsx";
import {
  createMockDispatcher,
  render,
  restoreViewportWidthAfterEach,
  screen,
  setViewportWidth,
  waitFor,
  within,
} from "./test-utils.tsx";

const PHONE_WIDTH = 500;
const DESKTOP_WIDTH = 1280;

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false, features: [] });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

function PanelIcon(_props: ExtensionSectionProps): ReactNode {
  return <svg data-testid="panel-icon" />;
}

function renderDashboard(
  dashboard: DashboardScreenDefinition,
  handlers: Readonly<Record<string, () => unknown>> = {},
): void {
  const dispatcher = createMockDispatcher({
    query: (async (type: string) => {
      const handler = handlers[type];
      return handler === undefined ? { isSuccess: true, data: {} } : handler();
    }) as unknown as Dispatcher["query"],
  });
  const schema: FeatureSchema = { featureName: "demo", entities: {}, screens: [dashboard] };
  render(
    <AppFeaturesProvider features={[]}>
      <BrowserNav>
        <DispatcherProvider dispatcher={dispatcher}>
          <ExtensionSectionsProvider value={{ "panel-icon": PanelIcon }}>
            <DashboardBodyProvider value={WebDashboardBody}>
              <KumikoScreen schema={schema} qn={`demo:screen:${dashboard.id}`} />
            </DashboardBodyProvider>
          </ExtensionSectionsProvider>
        </DispatcherProvider>
      </BrowserNav>
    </AppFeaturesProvider>,
  );
}

const ok = (data: unknown) => ({ isSuccess: true, data });

const textPanel = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: "text",
  id,
  blocks: [{ kind: "paragraph", text: `Text ${id}` }],
  ...extra,
});

describe("dashboard layout main-side", () => {
  restoreViewportWidthAfterEach();

  const dashboard = {
    id: "board",
    type: "dashboard",
    layout: "main-side",
    panels: [
      textPanel("a"),
      textPanel("s1", { column: "side" }),
      textPanel("b"),
      textPanel("s2", { column: "side", narrowOrder: 1 }),
    ],
  } as unknown as DashboardScreenDefinition;

  test("desktop stacks main panels in the left column and side panels in the right one", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(dashboard);
    const main = await screen.findByTestId("dashboard-column-main");
    const side = screen.getByTestId("dashboard-column-side");
    expect(within(main).getByTestId("dashboard-panel-a")).toBeTruthy();
    expect(within(main).getByTestId("dashboard-panel-b")).toBeTruthy();
    expect(within(main).queryByTestId("dashboard-panel-s1")).toBeNull();
    expect(within(side).getByTestId("dashboard-panel-s1")).toBeTruthy();
    expect(within(side).getByTestId("dashboard-panel-s2")).toBeTruthy();
  });

  test("desktop puts top panels above both columns, in declared order", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard({
      ...dashboard,
      panels: [
        textPanel("t1", { column: "top" }),
        textPanel("a"),
        textPanel("t2", { column: "top" }),
      ],
    } as unknown as DashboardScreenDefinition);
    const top = await screen.findByTestId("dashboard-column-top");
    const main = screen.getByTestId("dashboard-column-main");
    const side = screen.getByTestId("dashboard-column-side");
    const topIds = within(top)
      .getAllByTestId(/^dashboard-panel-/)
      .map((element) => element.getAttribute("data-testid"));
    expect(topIds).toEqual(["dashboard-panel-t1", "dashboard-panel-t2"]);
    expect(within(main).queryByTestId("dashboard-panel-t1")).toBeNull();
    expect(within(side).queryByTestId("dashboard-panel-t1")).toBeNull();
    expect(within(main).getByTestId("dashboard-panel-a")).toBeTruthy();
  });

  test("without top panels there is no top container", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(dashboard);
    await screen.findByTestId("dashboard-column-main");
    expect(screen.queryByTestId("dashboard-column-top")).toBeNull();
  });

  test("a phone shows one column in narrowOrder", async () => {
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(dashboard);
    await waitFor(() => expect(screen.getByTestId("dashboard-panel-a")).toBeTruthy());
    expect(screen.queryByTestId("dashboard-column-side")).toBeNull();
    const ids = screen
      .getAllByTestId(/^dashboard-panel-/)
      .map((element) => element.getAttribute("data-testid"));
    expect(ids).toEqual([
      "dashboard-panel-a",
      "dashboard-panel-s1",
      "dashboard-panel-b",
      "dashboard-panel-s2",
    ]);
  });
});

describe("dashboard panel looks", () => {
  restoreViewportWidthAfterEach();

  test("a text panel icon stands before the text", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard({
      id: "board",
      type: "dashboard",
      panels: [textPanel("note", { icon: { react: { __component: "panel-icon" } } })],
    } as unknown as DashboardScreenDefinition);
    const panel = await screen.findByTestId("dashboard-panel-note");
    const icon = within(panel).getByTestId("panel-icon");
    const text = within(panel).getByText("Text note");
    expect(icon.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("a button column with variant primary draws the filled button", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    const column = (field: string, variant?: "primary") => ({
      field,
      label: field,
      display: "button",
      linkScreenField: "screen",
      ...(variant !== undefined && { variant }),
    });
    renderDashboard(
      {
        id: "board",
        type: "dashboard",
        panels: [
          {
            kind: "list",
            id: "todo",
            label: "Todo",
            query: "demo:query:todo:list",
            columns: [column("plain"), column("main", "primary")],
          },
        ],
      } as unknown as DashboardScreenDefinition,
      {
        "demo:query:todo:list": () =>
          ok({
            rows: [{ id: "t1", plain: "Remind", main: "Send", screen: "invoice-detail" }],
            nextCursor: null,
          }),
      },
    );
    const primary = await screen.findByRole("link", { name: "Send" });
    const outline = screen.getByRole("link", { name: "Remind" });
    for (const token of LINK_BUTTON_PRIMARY_CLASS.split(" ")) {
      expect(primary.className).toContain(token);
    }
    expect(outline.className).toContain(LINK_BUTTON_CLASS.split(" ")[0] ?? "");
    expect(outline.className).not.toBe(primary.className);
  });
});

describe("stat-group child with hideOnNarrow", () => {
  restoreViewportWidthAfterEach();

  const group = {
    kind: "stat-group",
    id: "inbox",
    label: "Inbox",
    layout: "strip",
    stats: [
      { kind: "stat", id: "open", label: "Open", query: "demo:query:kpi:any", valueField: "value" },
      {
        kind: "stat",
        id: "done",
        label: "Done",
        query: "demo:query:kpi:any",
        valueField: "value",
        hideOnNarrow: true,
      },
    ],
  };
  const handlers = { "demo:query:kpi:any": () => ok({ value: "7" }) };

  test("the phone strip leaves the child out, the desktop keeps it", async () => {
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(
      { id: "board", type: "dashboard", panels: [group] } as unknown as DashboardScreenDefinition,
      handlers,
    );
    await waitFor(() => expect(screen.getByTestId("dashboard-panel-open")).toBeTruthy());
    expect(screen.queryByTestId("dashboard-panel-done")).toBeNull();
  });

  test("a desktop shows every child", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(
      { id: "board", type: "dashboard", panels: [group] } as unknown as DashboardScreenDefinition,
      handlers,
    );
    await waitFor(() => expect(screen.getByTestId("dashboard-panel-done")).toBeTruthy());
    expect(screen.getByTestId("dashboard-panel-open")).toBeTruthy();
  });
});
