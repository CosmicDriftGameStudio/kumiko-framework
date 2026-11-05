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
  cleanup,
  createMockDispatcher,
  fireEvent,
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
      fallbackBundles={[
        kumikoDefaultTranslations,
        {
          "en-US": {
            "demo.total": "{shown} urgent of {total}",
            "demo.total-short": "{shown}/{total}",
            "demo.more": "plus {count} further",
            "demo.more-short": "+{count}",
          },
        },
      ]}
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

describe("dashboard list texts and row link", () => {
  restoreViewportWidthAfterEach();

  const textList = (overrides: Record<string, unknown>) =>
    ({
      ...(listPanel({}) as unknown as Record<string, unknown>),
      ...overrides,
    }) as unknown as DashboardScreenDefinition["panels"][number];

  test("showTotal and moreText texts apply on a wide screen, the narrow variants below sm", async () => {
    const panel = textList({
      showTotal: { text: "demo.total", narrowText: "demo.total-short" },
      footerLink: {
        screen: "demo:screen:all",
        label: "Show all",
        moreText: "demo.more",
        narrowMoreText: "demo.more-short",
      },
      narrow: { layout: "cards", limit: 3 },
    });
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(dashboardOf(panel), { "demo:query:task:list": listAnswer });
    await waitFor(() => expect(screen.getByText("5 urgent of 11")).toBeTruthy());
    expect(screen.getByText(/plus 6 further/)).toBeTruthy();
  });

  test("the narrow showTotal and moreText replace the wide ones on a phone", async () => {
    const panel = textList({
      showTotal: { text: "demo.total", narrowText: "demo.total-short" },
      footerLink: {
        screen: "demo:screen:all",
        label: "Show all",
        moreText: "demo.more",
        narrowMoreText: "demo.more-short",
      },
      narrow: { layout: "cards", limit: 3 },
    });
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(dashboardOf(panel), { "demo:query:task:list": listAnswer });
    await waitFor(() => expect(screen.getByText("3/11")).toBeTruthy());
    expect(screen.getByText(/\+8/)).toBeTruthy();
  });

  test("narrow.field picks the column behind the label in the line layout", async () => {
    const panel = textList({
      columns: [{ field: "title" }, { field: "due" }],
      narrow: { layout: "line", field: "due" },
    });
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(dashboardOf(panel), { "demo:query:task:list": listAnswer });
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-panel-open").textContent).toContain("Due 0"),
    );
    expect(screen.getByTestId("dashboard-panel-open").textContent).not.toContain("Task 0");
  });

  test("narrow.field with a non-text value draws no text instead of [object Object]", async () => {
    const panel = textList({
      columns: [{ field: "title" }, { field: "nested" }],
      narrow: { layout: "line", field: "nested" },
    });
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(dashboardOf(panel), {
      "demo:query:task:list": () => ok({ rows: [{ id: "t0", title: "Task 0", nested: {} }] }),
    });
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-panel-open").textContent).toContain("Open tasks"),
    );
    expect(screen.getByTestId("dashboard-panel-open").textContent).not.toContain("object");
  });

  test("narrow.field on a number or datetime value is formatted like the cells", async () => {
    const panel = textList({
      columns: [{ field: "title" }, { field: "amount" }, { field: "due", display: "datetime" }],
      narrow: { layout: "line", field: "amount" },
    });
    setViewportWidth(PHONE_WIDTH);
    const answer = () =>
      ok({ rows: [{ id: "t0", title: "Task 0", amount: 1234.5, due: "2026-11-03T10:00:00Z" }] });
    renderDashboard(dashboardOf(panel), { "demo:query:task:list": answer });
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-panel-open").textContent).toContain("1,234.5"),
    );
    cleanup();
    renderDashboard(dashboardOf(textList({ ...panel, narrow: { layout: "line", field: "due" } })), {
      "demo:query:task:list": answer,
    });
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-panel-open").textContent).toMatch(/2026/),
    );
    expect(screen.getByTestId("dashboard-panel-open").textContent).not.toContain("T10:00");
  });

  const rowLinkRows = [
    { id: "t0", title: "Task 0", target: { entityId: "e0" } },
    { id: "t1", title: "Task 1", target: "not-an-object" },
  ];
  const rowLinkPanel = (narrow?: Record<string, unknown>) =>
    textList({
      columns: [{ field: "title" }],
      rowLink: { screen: "demo:screen:all", paramField: "target" },
      ...(narrow !== undefined && { narrow }),
    });

  test("a row link makes the row clickable and keeps the icon as a real link", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(dashboardOf(rowLinkPanel()), {
      "demo:query:task:list": () => ok({ rows: rowLinkRows }),
    });
    await waitFor(() => expect(screen.getByText("Task 0")).toBeTruthy());
    const iconLinks = screen.getAllByRole("link", { name: "Open" });
    expect(iconLinks).toHaveLength(2);
    const target = iconLinks[0]?.getAttribute("href");
    expect(target).toContain("e0");
    const row = screen.getByText("Task 0").closest("tr");
    expect(row?.className).toContain("cursor-pointer");
    fireEvent.click(screen.getByText("Task 0"));
    expect(window.location.href).toContain("e0");
  });

  test("a cards phone layout keeps the table row link on wide screens and draws none itself", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(dashboardOf(rowLinkPanel({ layout: "cards" })), {
      "demo:query:task:list": () => ok({ rows: rowLinkRows }),
    });
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Open" })).toHaveLength(2));
    cleanup();
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(dashboardOf(rowLinkPanel({ layout: "cards" })), {
      "demo:query:task:list": () => ok({ rows: rowLinkRows }),
    });
    await waitFor(() => expect(screen.getAllByTestId("dashboard-list-card")).toHaveLength(2));
    expect(screen.queryAllByRole("link", { name: "Open" })).toHaveLength(0);
  });
});

describe("dashboard board gaps (round 6)", () => {
  restoreViewportWidthAfterEach();

  const panelOf = (overrides: Record<string, unknown>) =>
    ({
      ...(listPanel({}) as unknown as Record<string, unknown>),
      ...overrides,
    }) as unknown as DashboardScreenDefinition["panels"][number];

  test("the panel head puts title and description on one line from sm", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(dashboardOf(panelOf({ subtitle: "demo.more" })), {
      "demo:query:task:list": listAnswer,
    });
    const title = await screen.findByText("Open tasks");
    expect(title.parentElement?.className).toContain("sm:flex-row");
  });

  test("a titled stat strip bundles its boxes on the left instead of spreading them", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(
      dashboardOf({
        kind: "stat-group",
        id: "numbers",
        label: "Numbers",
        layout: "strip",
        stats: [{ kind: "stat", id: "a", label: "A", query: "demo:query:a", valueField: "total" }],
      } as unknown as DashboardScreenDefinition["panels"][number]),
      { "demo:query:a": () => ok({ total: 1 }) },
    );
    const panel = await screen.findByTestId("dashboard-panel-numbers");
    const container = panel.querySelector(".items-stretch");
    if (container === null) throw new Error("stat strip container missing");
    const containerClasses = container.className.split(" ");
    expect(containerClasses).toContain("gap-3");
    for (const spread of ["grow", "flex-1", "justify-between", "sm:grow", "sm:flex-1"]) {
      expect(containerClasses).not.toContain(spread);
      expect(panel.className.split(" ")).not.toContain(spread);
    }
    expect(container.children.length).toBeGreaterThan(0);
    for (const box of Array.from(container.children)) {
      expect(box.className.split(" ")).not.toContain("sm:flex-1");
      expect(box.className.split(" ")).not.toContain("flex-1");
    }
  });

  test("a leading badge column renders inline before the title, in the same cell", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(
      dashboardOf(
        panelOf({
          columns: [
            { field: "tone", display: "badge" },
            { field: "title", hint: { detailField: "due", plainSentence: true } },
          ],
        }),
      ),
      { "demo:query:task:list": listAnswer },
    );
    await waitFor(() => expect(screen.getAllByText("Task 0").length).toBeGreaterThan(0));
    const cell = screen.getByText("Task 0").closest("td");
    expect(cell?.textContent).toContain("warn");
    expect(cell?.textContent).toContain("Due 0");
  });

  test("rowToneMarker dot draws a tone dot instead of the bar", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(dashboardOf(panelOf({ rowToneMarker: "dot" })), {
      "demo:query:task:list": listAnswer,
    });
    await waitFor(() => expect(screen.getAllByTestId("dashboard-list-tone-dot")).toHaveLength(5));
  });

  test("rowLink.screenField takes the target screen and params from the row", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(
      dashboardOf(
        panelOf({
          columns: [{ field: "title" }],
          rowLink: { screenField: "targetScreen", paramsField: "target" },
        }),
      ),
      {
        "demo:query:task:list": () =>
          ok({
            rows: [
              {
                id: "t0",
                title: "Task 0",
                targetScreen: "demo:screen:all",
                target: { entityId: "e0" },
              },
              { id: "t1", title: "Task 1", target: { entityId: "e1" } },
            ],
          }),
      },
    );
    await waitFor(() => expect(screen.getByText("Task 0")).toBeTruthy());
    expect(screen.getAllByRole("link", { name: "Open" })).toHaveLength(1);
    fireEvent.click(screen.getByText("Task 0"));
    expect(window.location.href).toContain("e0");
  });

  test("narrow.titleField replaces the card title below sm", async () => {
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(dashboardOf(panelOf({ narrow: { layout: "cards", titleField: "short" } })), {
      "demo:query:task:list": () =>
        ok({
          rows: [
            { id: "t0", title: "A very long desktop sentence", short: "Short title", due: "Due 0" },
          ],
        }),
    });
    await waitFor(() => expect(screen.getByText("Short title")).toBeTruthy());
    expect(screen.queryByText("A very long desktop sentence")).toBeNull();
  });

  test("narrowOnly footer link serves the line below sm and is not drawn on wide screens", async () => {
    const panel = panelOf({
      columns: [{ field: "title" }],
      footerLink: { screen: "demo:screen:all", label: "Show all", narrowOnly: true },
      narrow: { layout: "line", field: "extra", moreText: "demo.more" },
    });
    const rows = [
      { id: "t0", title: "Task 0", extra: "Not a column" },
      { id: "t1", title: "Task 1", extra: "x" },
    ];
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(dashboardOf(panel), { "demo:query:task:list": () => ok({ rows }) });
    await waitFor(() => expect(screen.getByText("Task 0")).toBeTruthy());
    expect(screen.queryByText("Show all")).toBeNull();
    cleanup();
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(dashboardOf(panel), { "demo:query:task:list": () => ok({ rows }) });
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-panel-open").textContent).toContain("Not a column"),
    );
    expect(screen.getByTestId("dashboard-panel-open").textContent).toContain("plus 1 further");
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

describe("stat-group narrow tone", () => {
  restoreViewportWidthAfterEach();

  test("narrow.tone tints the titled strip", async () => {
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(
      dashboardOf({
        kind: "stat-group",
        id: "inbox",
        label: "Inbox",
        layout: "strip",
        narrow: { tone: "accent" },
        stats: [{ kind: "stat", id: "a", label: "A", query: "demo:query:a", valueField: "total" }],
      } as unknown as DashboardScreenDefinition["panels"][number]),
      { "demo:query:a": () => ok({ total: 2 }) },
    );
    await screen.findByText("Inbox");
    await waitFor(() =>
      expect(
        document.body.querySelector("[data-narrow-tone]")?.getAttribute("data-narrow-tone"),
      ).toBe("accent"),
    );
  });
});

describe("dashboard list reason box and badge dot", () => {
  restoreViewportWidthAfterEach();

  const reasonPanel = (columns: readonly Record<string, unknown>[]) =>
    ({
      kind: "list",
      id: "open",
      label: "Open tasks",
      query: "demo:query:task:list",
      columns,
    }) as unknown as DashboardScreenDefinition["panels"][number];
  const hintColumn = {
    field: "title",
    hint: {
      reasonField: "why",
      reasonOpenField: "whyOpen",
      reasonTitleField: "whyTitle",
      reasonLabel: "Why",
    },
  };
  const reasonRows = () =>
    ok({
      rows: [
        { id: "r1", title: "Remind", why: "Overdue 14 days.", whyOpen: true, whyTitle: "Rule 10" },
      ],
      total: 1,
    });

  test("the box is open from sm, closes and reopens with the (i), and is never doubled", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDashboard(dashboardOf(reasonPanel([hintColumn])), { "demo:query:task:list": reasonRows });
    await screen.findByText(/Overdue 14 days\./);
    expect(screen.getByText("Rule 10")).toBeTruthy();
    const toggle = document.body.querySelector("[data-hint-reason-toggle]") as HTMLElement;
    fireEvent.click(toggle);
    expect(screen.queryByText(/Overdue 14 days\./)).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getAllByText(/Overdue 14 days\./)).toHaveLength(1);
  });

  test("below sm the box starts closed and the (i) opens it", async () => {
    setViewportWidth(PHONE_WIDTH);
    renderDashboard(dashboardOf(reasonPanel([hintColumn])), { "demo:query:task:list": reasonRows });
    await waitFor(() =>
      expect(document.body.querySelector("[data-hint-reason-toggle]")).not.toBeNull(),
    );
    expect(screen.queryByText(/Overdue 14 days\./)).toBeNull();
    fireEvent.click(document.body.querySelector("[data-hint-reason-toggle]") as HTMLElement);
    expect(screen.getAllByText(/Overdue 14 days\./)).toHaveLength(1);
  });

  test("badgeDot: false draws the badge without its dot", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    const badges = (badgeDot: boolean) =>
      reasonPanel([
        { field: "title" },
        { field: "state", display: "badge", ...(badgeDot ? {} : { badgeDot: false }) },
      ]);
    const rows = () => ok({ rows: [{ id: "r1", title: "Remind", state: "7 open" }], total: 1 });
    renderDashboard(dashboardOf(badges(false)), { "demo:query:task:list": rows });
    await screen.findByText("7 open");
    expect(document.body.querySelector("[data-status-dot]")).toBeNull();
  });
});
