import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { EMPTY_VALUE_PLACEHOLDER, type QueryResult } from "../../headless/index.ts";
import { isRecord } from "../../headless/is-record.ts";
import type { FeatureSchema } from "../../index.ts";
import {
  AppFeaturesProvider,
  createStaticLocaleResolver,
  DashboardBodyProvider,
  DispatcherProvider,
  type ExtensionSectionProps,
  ExtensionSectionsProvider,
  KumikoScreen,
  kumikoDefaultTranslations,
  LocaleProvider,
  NavProvider,
  type TranslationsByLocale,
} from "../../index.ts";
import { WebDashboardBody } from "../app/dashboard-body.tsx";
import { useBrowserNavApi } from "../app/nav.tsx";
import { PageHeaderSlotProvider } from "../layout/page-header-slot.tsx";
import { ShellHeader } from "../layout/shell-header.tsx";
import { LINK_BUTTON_CLASS } from "../primitives/data-table-cell.tsx";
import {
  act,
  createMockDispatcher,
  fireEvent,
  render,
  renderWithSidebar,
  screen,
  waitFor,
  within,
} from "./test-utils.tsx";

type Handler = (payload: Readonly<Record<string, unknown>>) => QueryResult | Promise<QueryResult>;

const FEATURE = "demo";

function BrowserNav({
  children,
  features,
}: {
  readonly children: ReactNode;
  readonly features?: readonly FeatureSchema[] | undefined;
}): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false, ...(features && { features }) });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

function renderDashboard(
  dashboard: DashboardScreenDefinition,
  handlers: Readonly<Record<string, Handler>>,
  options: {
    readonly locale?: string;
    readonly appFeatures?: readonly FeatureSchema[];
    /** Renders below the app shell page-header slot like the real app. */
    readonly shell?: boolean;
    readonly translations?: TranslationsByLocale;
    readonly extensionSections?: Readonly<
      Record<string, (props: ExtensionSectionProps) => ReactNode>
    >;
  } = {},
): { readonly calls: { readonly type: string; readonly payload: Record<string, unknown> }[] } {
  const calls: { readonly type: string; readonly payload: Record<string, unknown> }[] = [];
  const dispatcher = createMockDispatcher({
    query: async (type: string, rawPayload: unknown) => {
      const payload = isRecord(rawPayload) ? rawPayload : {};
      calls.push({ type, payload });
      const handler = handlers[type];
      if (handler === undefined) return { isSuccess: true, data: {} };
      const result = await handler(payload);
      return result;
    },
  });
  const schema: FeatureSchema = { featureName: FEATURE, entities: {}, screens: [dashboard] };
  const screenNode = (
    <AppFeaturesProvider features={options.appFeatures ?? []}>
      <BrowserNav features={options.appFeatures}>
        <DispatcherProvider dispatcher={dispatcher}>
          <ExtensionSectionsProvider value={options.extensionSections ?? {}}>
            <DashboardBodyProvider value={WebDashboardBody}>
              {options.shell === true ? (
                <PageHeaderSlotProvider>
                  <ShellHeader schema={{ features: [schema] }} />
                  <KumikoScreen schema={schema} qn={`${FEATURE}:screen:${dashboard.id}`} />
                </PageHeaderSlotProvider>
              ) : (
                <KumikoScreen schema={schema} qn={`${FEATURE}:screen:${dashboard.id}`} />
              )}
            </DashboardBodyProvider>
          </ExtensionSectionsProvider>
        </DispatcherProvider>
      </BrowserNav>
    </AppFeaturesProvider>
  );
  const mount = options.shell === true ? renderWithSidebar : render;
  mount(
    options.locale === undefined ? (
      screenNode
    ) : (
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: options.locale })}
        fallbackBundles={[
          ...(options.translations !== undefined ? [options.translations] : []),
          kumikoDefaultTranslations,
        ]}
      >
        {screenNode}
      </LocaleProvider>
    ),
  );
  return { calls };
}

const ok = (data: unknown): QueryResult => ({ isSuccess: true, data });
const failure: QueryResult = {
  isSuccess: false,
  error: {
    code: "internal",
    httpStatus: 500,
    message: "kaputt",
    i18nKey: "errors.internal",
  },
};

const DAY = 86_400_000;
const day1 = Date.UTC(2026, 0, 1);
const day2 = day1 + DAY;
const day3 = day2 + DAY;
const windowEndMs = day3 + 12 * 3_600_000;

const dayPoints = (values: readonly number[]) =>
  values.map((value, i) => ({ atMs: day1 + i * DAY, value }));

function chartScreen(
  chart: "timeseries" | "stacked-bars" | "segment-bars" | "stacked-area",
  extra: Record<string, unknown> = {},
): DashboardScreenDefinition {
  return {
    id: "charts",
    type: "dashboard",
    panels: [
      {
        kind: "chart",
        id: "main",
        label: "demo:chart",
        chart,
        query: "demo:query:metric:chart",
        ...extra,
      },
    ],
  } as DashboardScreenDefinition;
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("dashboard chart kinds", () => {
  test("stacked-bars: bar per bucket, 'Today' label on the last bucket, legend with series totals", async () => {
    renderDashboard(chartScreen("stacked-bars", { subtitle: "demo:chart-subtitle" }), {
      "demo:query:metric:chart": () =>
        ok({
          windowStartMs: day1,
          windowEndMs,
          series: [
            { key: "ok", label: "Delivered", points: dayPoints([3, 4, 5]) },
            { key: "fail", label: "Failed", points: dayPoints([1, 0, 2]) },
          ],
        }),
    });
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    screen.getByText("Today");
    screen.getByText("demo:chart-subtitle");
    within(screen.getByTestId("chart-legend-ok")).getByText("12");
    within(screen.getByTestId("chart-legend-fail")).getByText("3");
    expect(screen.getAllByTestId("chart-bar-segment-ok")).toHaveLength(3);
    // zero-value segments draw nothing
    expect(screen.getAllByTestId("chart-bar-segment-fail")).toHaveLength(2);
  });

  test("stacked-bars: points without series render as one plain bar series", async () => {
    renderDashboard(chartScreen("stacked-bars"), {
      "demo:query:metric:chart": () =>
        ok({ windowStartMs: day1, windowEndMs, points: dayPoints([2, 6]), series: [] }),
    });
    await waitFor(() => screen.getByTestId("chart-legend-value"));
    within(screen.getByTestId("chart-legend-value")).getByText("8");
  });

  test("segment-bars: one stacked bar per row, row total and legend totals", async () => {
    renderDashboard(chartScreen("segment-bars"), {
      "demo:query:metric:chart": () =>
        ok({
          rows: [
            {
              key: "mail",
              label: "E-Mail",
              value: 10,
              segments: [
                { key: "sent", label: "Sent", value: 7 },
                { key: "bounced", label: "Bounced", value: 3 },
              ],
            },
            {
              key: "sms",
              label: "SMS",
              value: 4,
              segments: [{ key: "sent", label: "Sent", value: 4 }],
            },
          ],
        }),
    });
    await waitFor(() => screen.getByTestId("chart-row-mail"));
    within(screen.getByTestId("chart-row-mail")).getByText("10");
    within(screen.getByTestId("chart-row-sms")).getByText("4");
    within(screen.getByTestId("chart-legend-sent")).getByText("11");
    within(screen.getByTestId("chart-legend-bounced")).getByText("3");
  });

  const areaPayload = {
    windowStartMs: day1,
    windowEndMs: day3,
    series: [
      { key: "a", label: "Plan", points: dayPoints([1, 2, 3]) },
      { key: "b", label: "Extra", points: dayPoints([1, 1, 1]) },
    ],
    markers: [
      { atMs: day3, label: "Second event" },
      { atMs: day2, label: "First event" },
    ],
  };

  test("stacked-area with todayMs: forecast region, today line, numbered markers in time order", async () => {
    renderDashboard(chartScreen("stacked-area"), {
      "demo:query:metric:chart": () => ok({ ...areaPayload, todayMs: day2 }),
    });
    await waitFor(() => screen.getByTestId("chart-forecast-region"));
    screen.getByTestId("chart-today-line");
    within(screen.getByTestId("chart-today-label")).getByText("Today");
    const items = screen.getAllByTestId("chart-marker-item");
    expect(items.map((li) => li.textContent?.slice(0, 1))).toEqual(["1", "2"]);
    expect(items[0]?.textContent).toContain("First event");
    expect(screen.getAllByTestId("chart-marker-pin")).toHaveLength(2);
  });

  test("stacked-area without todayMs draws no forecast region or today line", async () => {
    renderDashboard(chartScreen("stacked-area"), {
      "demo:query:metric:chart": () => ok(areaPayload),
    });
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    expect(screen.queryByTestId("chart-forecast-region")).toBeNull();
    expect(screen.queryByTestId("chart-today-line")).toBeNull();
  });

  test("timeseries markers render pins and the numbered list", async () => {
    renderDashboard(chartScreen("timeseries"), {
      "demo:query:metric:chart": () =>
        ok({
          windowStartMs: day1,
          windowEndMs: day3,
          points: dayPoints([1, 3, 2]),
          markers: [{ atMs: day2, label: "Deploy" }],
        }),
    });
    await waitFor(() => screen.getByTestId("chart-marker-item"));
    expect(screen.getByTestId("chart-marker-item").textContent).toContain("Deploy");
    expect(screen.getAllByTestId("chart-marker-pin")).toHaveLength(1);
  });
});

describe("dashboard panel states", () => {
  const twoPanels: DashboardScreenDefinition = {
    id: "states",
    type: "dashboard",
    panels: [
      { kind: "feed", id: "broken", label: "demo:broken", query: "demo:query:feed:broken" },
      { kind: "feed", id: "healthy", label: "demo:healthy", query: "demo:query:feed:healthy" },
    ],
  };

  test("loading: header stays visible and a skeleton renders", async () => {
    renderDashboard(twoPanels, {
      "demo:query:feed:broken": () => new Promise(() => {}),
      "demo:query:feed:healthy": () => new Promise(() => {}),
    });
    screen.getByText("demo:broken");
    expect(screen.getAllByLabelText("Loading…").length).toBeGreaterThan(0);
  });

  test("segment-bars loading skeleton is horizontal rows, other charts keep vertical bars", async () => {
    renderDashboard(chartScreen("segment-bars"), {
      "demo:query:chart": () => new Promise(() => {}),
    });
    const skeleton = screen.getByLabelText("Loading…");
    expect(skeleton.className).toContain("flex-col");
  });

  test("span half puts a chart in a half-width cell, default stays full width", async () => {
    renderDashboard(
      {
        id: "spans",
        type: "dashboard",
        panels: [
          {
            kind: "feed",
            id: "left",
            label: "demo:left",
            query: "demo:query:feed:left",
            span: "full",
          },
          {
            kind: "list",
            id: "right",
            label: "demo:right",
            query: "demo:query:list:right",
            columns: ["name"],
            span: "half",
          },
          {
            kind: "list",
            id: "plain",
            label: "demo:plain",
            query: "demo:query:list:plain",
            columns: ["name"],
          },
          {
            kind: "list",
            id: "third",
            label: "demo:third",
            query: "demo:query:list:third",
            columns: ["name"],
            span: "third",
          },
          {
            kind: "list",
            id: "twothirds",
            label: "demo:twothirds",
            query: "demo:query:list:twothirds",
            columns: ["name"],
            span: "two-thirds",
          },
        ],
      },
      {},
    );
    const cell = (id: string) =>
      screen.getByTestId(`dashboard-panel-${id}`).parentElement?.className ?? "";
    await waitFor(() => expect(cell("right")).toContain("lg:col-span-6"));
    expect(cell("left")).toContain("lg:col-span-12");
    expect(cell("plain")).toContain("lg:col-span-12");
    expect(cell("third")).toContain("lg:col-span-4");
    expect(cell("twothirds")).toContain("lg:col-span-8");
  });

  test("a raw description is not rendered", async () => {
    renderDashboard({ ...twoPanels, description: "Agent prose in English" }, {});
    expect(screen.queryByText("Agent prose in English")).toBeNull();
  });

  test("empty: custom label and hint, default label otherwise", async () => {
    renderDashboard(
      {
        id: "empty",
        type: "dashboard",
        panels: [
          {
            kind: "list",
            id: "jobs",
            label: "demo:jobs",
            query: "demo:query:jobs:list",
            columns: ["name"],
            emptyLabel: "demo:jobs-empty",
            emptyHint: "demo:jobs-empty-hint",
          },
          { kind: "progress-list", id: "goals", label: "demo:goals", query: "demo:query:goals" },
        ],
      },
      {
        "demo:query:jobs:list": () => ok({ rows: [], nextCursor: null }),
        "demo:query:goals": () => ok({ rows: [] }),
      },
    );
    await waitFor(() => screen.getByText("demo:jobs-empty"));
    screen.getByText("demo:jobs-empty-hint");
    screen.getByText("No entries.");
  });

  test("error: message, retry refetches, a failing panel does not affect its sibling", async () => {
    let brokenCalls = 0;
    const { calls } = renderDashboard(twoPanels, {
      "demo:query:feed:broken": () => {
        brokenCalls += 1;
        return brokenCalls === 1 ? failure : ok({ rows: [{ primary: "Recovered" }] });
      },
      "demo:query:feed:healthy": () => ok({ rows: [{ primary: "Still here" }] }),
    });
    await waitFor(() => screen.getByText("demo:broken could not be loaded"));
    screen.getByText("The other panels are not affected.");
    screen.getByText("Still here");

    const before = calls.filter((c) => c.type === "demo:query:feed:broken").length;
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => screen.getByText("Recovered"));
    expect(calls.filter((c) => c.type === "demo:query:feed:broken").length).toBeGreaterThan(before);
    expect(screen.queryByText("The other panels are not affected.")).toBeNull();
  });

  test("a retry that loads a panel moves the date stamp to the server day", async () => {
    const clock = spyOn(Date, "now");
    clock.mockReturnValue(Date.UTC(2026, 0, 1, 8, 0, 0));
    try {
      let brokenCalls = 0;
      renderDashboard(twoPanels, {
        "demo:query:feed:broken": () => {
          brokenCalls += 1;
          return brokenCalls === 1 ? failure : ok({ rows: [{ primary: "Recovered" }] });
        },
        "demo:query:feed:healthy": () => ok({ rows: [{ primary: "Still here" }] }),
      });
      await waitFor(() => screen.getByText("demo:broken could not be loaded"));
      const stampTestId = `dashboard-${twoPanels.id}-updated-at`;
      const stampAtRender = screen.getByTestId(stampTestId).textContent;

      clock.mockReturnValue(Date.UTC(2026, 0, 2, 14, 30, 0));
      await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => screen.getByText("Recovered"));
      await waitFor(() =>
        expect(screen.getByTestId(stampTestId).textContent).not.toBe(stampAtRender),
      );
    } finally {
      clock.mockRestore();
    }
  });
});

describe("dashboard timeRange, filter and scope", () => {
  const rangeScreen: DashboardScreenDefinition = {
    id: "ranged",
    type: "dashboard",
    scope: { badge: "demo:scope-badge", notice: "demo:scope-notice" },
    filter: {
      id: "region",
      label: "demo:filter-region",
      kind: "select",
      options: [{ value: "eu", label: "demo:region-eu" }],
    },
    timeRange: {
      id: "range",
      options: [
        { value: "7d", label: "demo:range-7d" },
        { value: "30d", label: "demo:range-30d" },
      ],
      default: "7d",
    },
    panels: [
      {
        kind: "stat",
        id: "scoped",
        label: "demo:scoped",
        query: "demo:query:kpi:scoped",
        valueField: "value",
      },
      {
        kind: "stat",
        id: "global",
        label: "demo:global",
        query: "demo:query:kpi:global",
        valueField: "value",
        ignoreScreenFilter: true,
        params: { source: "system" },
      },
    ],
  };

  const kpiHandlers = {
    "demo:query:kpi:scoped": (payload: Readonly<Record<string, unknown>>) =>
      ok({ value: `scoped-${String(payload["range"])}` }),
    "demo:query:kpi:global": (payload: Readonly<Record<string, unknown>>) =>
      ok({ value: `global-${String(payload["range"])}` }),
  };

  test("default range is merged into every panel; ignoreScreenFilter drops only the filter", async () => {
    window.history.replaceState(null, "", "/ranged?region=eu");
    const { calls } = renderDashboard(rangeScreen, kpiHandlers);
    await waitFor(() => screen.getByText("scoped-7d"));
    await waitFor(() => screen.getByText("global-7d"));
    expect(calls.find((c) => c.type === "demo:query:kpi:scoped")?.payload).toEqual({
      region: "eu",
      range: "7d",
      timeZone: expect.any(String),
    });
    expect(calls.find((c) => c.type === "demo:query:kpi:global")?.payload).toEqual({
      range: "7d",
      timeZone: expect.any(String),
      source: "system",
    });
  });

  test("switching the range updates the URL param and re-queries with the new value", async () => {
    window.history.replaceState(null, "", "/ranged");
    renderDashboard(rangeScreen, kpiHandlers);
    await waitFor(() => screen.getByText("scoped-7d"));
    const group = screen.getByTestId("dashboard-time-range-range");
    expect(group.getAttribute("role")).toBe("group");
    expect(within(group).getByText("demo:range-7d").getAttribute("aria-pressed")).toBe("true");

    await userEvent.setup().click(within(group).getByText("demo:range-30d"));
    await waitFor(() => screen.getByText("scoped-30d"));
    await waitFor(() => screen.getByText("global-30d"));
    expect(window.location.search).toContain("range=30d");
    expect(within(group).getByText("demo:range-30d").getAttribute("aria-pressed")).toBe("true");
  });

  test("an unknown range in the URL falls back to the default", async () => {
    window.history.replaceState(null, "", "/ranged?range=bogus");
    renderDashboard(rangeScreen, kpiHandlers);
    await waitFor(() => screen.getByText("scoped-7d"));
  });

  test("scope badge, notice and the 'as of' stamp render in the header", async () => {
    renderDashboard(rangeScreen, kpiHandlers);
    await waitFor(() => screen.getByTestId("dashboard-ranged-scope"));
    expect(screen.getByTestId("dashboard-ranged-scope").textContent).toContain("demo:scope-badge");
    expect(screen.getByTestId("dashboard-ranged-scope-notice").textContent).toContain(
      "demo:scope-notice",
    );
    expect(screen.getByTestId("dashboard-ranged-updated-at").textContent).toMatch(
      /^[A-Za-z]+day, /,
    );
  });
});

describe("dashboard stat panels", () => {
  const statScreen: DashboardScreenDefinition = {
    id: "stats",
    type: "dashboard",
    panels: [
      {
        kind: "stat",
        id: "volume",
        label: "demo:volume",
        query: "demo:query:kpi:volume",
        valueField: "value",
        toneField: "tone",
        sparklineField: "points",
      },
    ],
  };

  test("numbers are formatted in the user locale (de: 3140 -> 3.140), sparkline renders", async () => {
    renderDashboard(
      statScreen,
      {
        "demo:query:kpi:volume": () =>
          ok({ value: 3140, tone: "negative", points: dayPoints([1, 4, 2, 5]) }),
      },
      { locale: "de" },
    );
    await waitFor(() => screen.getByText("3.140"));
    const card = screen.getByTestId("dashboard-panel-volume");
    expect(card.querySelector("svg path")).not.toBeNull();
    expect(card.querySelector(".text-status-bad")).not.toBeNull();
  });

  test('toneField "ok" colors the value status green', async () => {
    renderDashboard(statScreen, {
      "demo:query:kpi:volume": () => ok({ value: "1.200", tone: "ok", points: dayPoints([1, 2]) }),
    });
    await waitFor(() => screen.getByText("1.200"));
    const card = screen.getByTestId("dashboard-panel-volume");
    expect(card.querySelector(".text-status-ok")).not.toBeNull();
    expect(card.querySelector(".text-primary")).toBeNull();
  });

  test("non-integers get at most one fraction digit; strings stay untouched", async () => {
    renderDashboard(
      {
        id: "fmt",
        type: "dashboard",
        panels: [
          {
            kind: "stat",
            id: "ratio",
            label: "demo:ratio",
            query: "demo:query:kpi:ratio",
            valueField: "value",
          },
          {
            kind: "stat",
            id: "text",
            label: "demo:text",
            query: "demo:query:kpi:text",
            valueField: "value",
          },
        ],
      },
      {
        "demo:query:kpi:ratio": () => ok({ value: 2.54159 }),
        "demo:query:kpi:text": () => ok({ value: "99,98 %" }),
      },
    );
    await waitFor(() => screen.getByText("2.5"));
    screen.getByText("99,98 %");
  });

  test("stat-group without label renders a flat KPI strip with sparkline, no section title", async () => {
    renderDashboard(
      {
        id: "strip",
        type: "dashboard",
        panels: [
          {
            kind: "stat-group",
            id: "kpis",
            stats: [
              {
                kind: "stat",
                id: "sent",
                label: "demo:sent",
                query: "demo:query:kpi:sent",
                valueField: "value",
                sparklineField: "points",
              },
              {
                kind: "stat",
                id: "failed",
                label: "demo:failed",
                query: "demo:query:kpi:failed",
                valueField: "value",
              },
            ],
          },
        ],
      },
      {
        "demo:query:kpi:sent": () => ok({ value: 1200, points: dayPoints([1, 2, 3]) }),
        "demo:query:kpi:failed": () => ok({ value: 7 }),
      },
    );
    await waitFor(() => screen.getByText("1,200"));
    const strip = screen.getByTestId("dashboard-panel-kpis");
    within(strip).getByText("demo:sent");
    within(strip).getByText("7");
    expect(strip.querySelector("svg path")).not.toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});

describe("dashboard list columns", () => {
  test("bar columns render bar + percent, badge columns a toned pill", async () => {
    renderDashboard(
      {
        id: "lists",
        type: "dashboard",
        panels: [
          {
            kind: "list",
            id: "jobs",
            label: "demo:jobs",
            query: "demo:query:jobs:list",
            columns: [
              { field: "name", label: "demo:col-name" },
              { field: "share", label: "demo:col-share", display: "bar" },
              {
                field: "state",
                label: "demo:col-state",
                display: "badge",
                badgeToneField: "stateTone",
              },
            ],
          },
        ],
      },
      {
        "demo:query:jobs:list": () =>
          ok({
            rows: [
              { id: "j1", name: "Nightly", share: 0.5, state: "Failed", stateTone: "negative" },
            ],
            nextCursor: null,
          }),
      },
    );
    await waitFor(() => screen.getByText("Nightly"));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
    screen.getByText("50%");
    const badge = screen.getByText("Failed");
    expect(badge.className).toContain("bg-status-bad-surface");
  });

  test("emptyPlaceholder false leaves an empty cell blank, the default draws the placeholder", async () => {
    renderDashboard(
      {
        id: "lists",
        type: "dashboard",
        panels: [
          {
            kind: "list",
            id: "notes",
            label: "demo:notes",
            query: "demo:query:notes:list",
            columns: [
              { field: "name", label: "demo:col-name" },
              { field: "note", label: "demo:col-note", emptyPlaceholder: false },
              { field: "other", label: "demo:col-other" },
            ],
          },
        ],
      },
      {
        "demo:query:notes:list": () =>
          ok({ rows: [{ id: "n1", name: "Nightly", note: "", other: "" }], nextCursor: null }),
      },
    );
    await waitFor(() => screen.getByText("Nightly"));
    const placeholders = screen.getAllByText(EMPTY_VALUE_PLACEHOLDER);
    expect(placeholders).toHaveLength(1);
  });

  test("button columns draw the cell link as a button and showHeader false drops the header row", async () => {
    renderDashboard(
      {
        id: "lists",
        type: "dashboard",
        panels: [
          {
            kind: "list",
            id: "todo",
            label: "demo:todo",
            query: "demo:query:todo:list",
            showHeader: false,
            columns: [
              { field: "name", label: "demo:col-name" },
              {
                field: "action",
                label: "demo:col-action",
                display: "button",
                linkScreenField: "actionScreen",
                linkParamsField: "actionParams",
              },
            ],
          },
        ],
      },
      {
        "demo:query:todo:list": () =>
          ok({
            rows: [
              {
                id: "t1",
                name: "Invoice 1",
                action: "Remind",
                actionScreen: "invoice-detail",
                actionParams: { entityId: "t1" },
              },
            ],
            nextCursor: null,
          }),
      },
    );
    await waitFor(() => screen.getByText("Invoice 1"));
    const link = screen.getByRole("link", { name: "Remind" });
    for (const token of LINK_BUTTON_CLASS.split(" ")) expect(link.className).toContain(token);
    expect(screen.queryByRole("columnheader")).toBeNull();
  });

  test.each([
    { showHeader: false, stacks: true },
    { showHeader: undefined, stacks: false },
  ])("showHeader $showHeader: stacking below sm is $stacks", async ({ showHeader, stacks }) => {
    renderDashboard(
      {
        id: "lists",
        type: "dashboard",
        panels: [
          {
            kind: "list",
            id: "todo",
            label: "demo:todo",
            query: "demo:query:todo:list",
            columns: [{ field: "name", label: "demo:col-name" }],
            ...(showHeader !== undefined && { showHeader }),
          },
        ],
      },
      {
        "demo:query:todo:list": () =>
          ok({ rows: [{ id: "t1", name: "Invoice 1" }], nextCursor: null }),
      },
    );
    const cell = await screen.findByText("Invoice 1");
    const row = cell.closest("tr");
    expect(row?.className.includes("max-sm:grid")).toBe(stacks);
    expect(cell.closest("td")?.className.includes("max-sm:block")).toBe(stacks);
    expect(row?.closest("table")?.querySelector("thead")?.className ?? "").not.toContain(
      "max-sm:hidden",
    );
  });

  test("datetime columns format ISO strings via the locale instead of showing them raw", async () => {
    renderDashboard(
      {
        id: "lists",
        type: "dashboard",
        panels: [
          {
            kind: "list",
            id: "when",
            label: "demo:when",
            query: "demo:query:when:list",
            columns: [
              { field: "name", label: "demo:col-name" },
              { field: "at", label: "demo:col-at", display: "datetime" },
            ],
          },
        ],
      },
      {
        "demo:query:when:list": () =>
          ok({
            rows: [
              { id: "w1", name: "Nightly", at: "2026-10-01T12:34:56.789Z" },
              { id: "w2", name: "Weekly", at: "not-a-date" },
            ],
            nextCursor: null,
          }),
      },
    );
    await waitFor(() => screen.getByText("Nightly"));
    expect(screen.queryByText("2026-10-01T12:34:56.789Z")).toBeNull();
    screen.getByText(/Oct 1, 2026/);
    expect(screen.queryByText("not-a-date")).toBeNull();
  });

  test("reference columns show the target's label instead of the stored id", async () => {
    renderDashboard(
      {
        id: "lists",
        type: "dashboard",
        panels: [
          {
            kind: "list",
            id: "deadlines",
            label: "demo:deadlines",
            query: "demo:query:deadlines:list",
            columns: [
              { field: "title", label: "demo:col-title" },
              {
                field: "plantId",
                label: "demo:col-plant",
                refEntity: "plant",
                refLabelField: "name",
              },
            ],
          },
        ],
      },
      {
        "demo:query:deadlines:list": () =>
          ok({ rows: [{ id: "d1", title: "Inspection", plantId: "p-123" }], nextCursor: null }),
        "demo:query:plant:list": () =>
          ok({ rows: [{ id: "p-123", name: "Boiler house" }], nextCursor: null }),
      },
    );
    await waitFor(() => screen.getByText("Boiler house"));
    expect(screen.queryByText("p-123")).toBeNull();
  });

  test("a reference column links the label to the target's detail screen", async () => {
    const plantDetail = {
      featureName: FEATURE,
      entities: {},
      screens: [{ id: "plant-detail", type: "projectionDetail", detailFor: "plant" }],
    } as unknown as FeatureSchema;
    renderDashboard(
      {
        id: "lists",
        type: "dashboard",
        panels: [
          {
            kind: "list",
            id: "deadlines",
            label: "demo:deadlines",
            query: "demo:query:deadlines:list",
            columns: [
              { field: "title", label: "demo:col-title" },
              {
                field: "plantId",
                label: "demo:col-plant",
                refEntity: "plant",
                refLabelField: "name",
              },
            ],
          },
        ],
      },
      {
        "demo:query:deadlines:list": () =>
          ok({ rows: [{ id: "d1", title: "Inspection", plantId: "p-123" }], nextCursor: null }),
        "demo:query:plant:list": () =>
          ok({ rows: [{ id: "p-123", name: "Boiler house" }], nextCursor: null }),
      },
      { appFeatures: [plantDetail] },
    );
    const link = await screen.findByRole("link", { name: "Boiler house" });
    expect(link.getAttribute("href")).toBe("/plant-detail/p-123");
  });

  test("text cells translate i18n keys and leave other strings untouched", async () => {
    renderDashboard(
      {
        id: "lists",
        type: "dashboard",
        panels: [
          {
            kind: "list",
            id: "keys",
            label: "demo:keys",
            query: "demo:query:keys:list",
            columns: [{ field: "name", label: "demo:col-name" }],
          },
        ],
      },
      {
        "demo:query:keys:list": () =>
          ok({
            rows: [
              { id: "a", name: "kumiko.actions.create" },
              { id: "b", name: "sessions:job:cleanup" },
              { id: "c", name: "plain text" },
            ],
            nextCursor: null,
          }),
      },
      { locale: "en" },
    );
    await waitFor(() => screen.getByText("plain text"));
    expect(screen.queryByText("kumiko.actions.create")).toBeNull();
    screen.getByText("sessions:job:cleanup");
  });
});

const I18N_TRANSLATIONS: TranslationsByLocale = {
  en: {
    "demo.deploy": "Deploy {env}",
    "demo.price": "Price {amount} since {since}",
    "demo.years": { one: "{count} year", other: "{count} years" },
    "demo.months": { one: "{count} month", other: "{count} months" },
    "demo.duration": "{years} {months}",
    "demo.stat": "{count} open",
    "demo.row": "Task {name}",
    "demo.quota": "Quota {month}",
  },
};

const duration = {
  i18nKey: "demo.duration",
  i18nParams: {
    years: { i18nKey: "demo.years", i18nParams: { count: 1 } },
    months: { i18nKey: "demo.months", i18nParams: { count: 3 } },
  },
};

describe("dashboard translatable panel texts", () => {
  const i18nOptions = { locale: "en", translations: I18N_TRANSLATIONS } as const;

  test("a plain string stays unchanged, an i18n object is translated with params", async () => {
    renderDashboard(
      {
        id: "texts",
        type: "dashboard",
        panels: [
          {
            kind: "stat",
            id: "plain",
            label: "demo:plain",
            query: "demo:query:kpi:plain",
            valueField: "value",
            subField: "sub",
          },
        ],
      },
      {
        "demo:query:kpi:plain": () =>
          ok({ value: "99 %", sub: { i18nKey: "demo.stat", i18nParams: { count: 4 } } }),
      },
      i18nOptions,
    );
    await waitFor(() => screen.getByText("99 %"));
    screen.getByText("4 open");
  });

  test("a stat value can be an i18n object", async () => {
    renderDashboard(
      {
        id: "texts",
        type: "dashboard",
        panels: [
          {
            kind: "stat",
            id: "dur",
            label: "demo:dur",
            query: "demo:query:kpi:dur",
            valueField: "value",
          },
        ],
      },
      { "demo:query:kpi:dur": () => ok({ value: duration }) },
      i18nOptions,
    );
    await waitFor(() => screen.getByText("1 year 3 months"));
  });

  test("nested plural params and money/date params resolve before translation", async () => {
    renderDashboard(
      {
        id: "texts",
        type: "dashboard",
        panels: [{ kind: "feed", id: "feed", label: "demo:feed", query: "demo:query:feed:rows" }],
      },
      {
        "demo:query:feed:rows": () =>
          ok({
            rows: [
              {
                primary: {
                  i18nKey: "demo.price",
                  i18nParams: {
                    amount: { kind: "money", amountMinor: 123456, currency: "EUR" },
                    since: { kind: "date", atMs: Date.UTC(2026, 0, 15, 12) },
                  },
                },
                trailing: duration,
              },
              { primary: "Plain row" },
            ],
          }),
      },
      i18nOptions,
    );
    await waitFor(() => screen.getByText("Price €1,234.56 since Jan 15, 2026"));
    screen.getByText("1 year 3 months");
    screen.getByText("Plain row");
  });

  test("progress-list label and value are translated", async () => {
    renderDashboard(
      {
        id: "texts",
        type: "dashboard",
        panels: [
          { kind: "progress-list", id: "prog", label: "demo:prog", query: "demo:query:prog:rows" },
        ],
      },
      {
        "demo:query:prog:rows": () =>
          ok({
            rows: [
              {
                label: { i18nKey: "demo.row", i18nParams: { name: "A" } },
                value: duration,
                fraction: 0.5,
              },
            ],
          }),
      },
      i18nOptions,
    );
    await waitFor(() => screen.getByText("Task A"));
    screen.getByText("1 year 3 months");
  });

  test("progress-list title takes its labelParams from fields of the query answer", async () => {
    renderDashboard(
      {
        id: "texts",
        type: "dashboard",
        panels: [
          {
            kind: "progress-list",
            id: "quota",
            label: "demo.quota",
            labelParams: { month: "monthName" },
            query: "demo:query:quota:rows",
          },
        ],
      },
      {
        "demo:query:quota:rows": () =>
          ok({ monthName: "November", rows: [{ label: "Offers", value: "3", fraction: 0.3 }] }),
      },
      i18nOptions,
    );
    await waitFor(() => screen.getByText("Quota November"));
  });

  test("an unknown object falls back to a placeholder instead of crashing", async () => {
    renderDashboard(
      {
        id: "texts",
        type: "dashboard",
        panels: [{ kind: "feed", id: "feed", label: "demo:feed", query: "demo:query:feed:rows" }],
      },
      { "demo:query:feed:rows": () => ok({ rows: [{ primary: { nonsense: true } }] }) },
      i18nOptions,
    );
    await waitFor(() => screen.getByText("—"));
  });

  test("marker labels are translated in stacked-area and timeseries", async () => {
    const marker = { atMs: day2, label: { i18nKey: "demo.deploy", i18nParams: { env: "prod" } } };
    renderDashboard(
      chartScreen("stacked-area"),
      {
        "demo:query:metric:chart": () =>
          ok({
            windowStartMs: day1,
            windowEndMs: day3,
            series: [{ key: "a", label: "Plan", points: dayPoints([1, 2, 3]) }],
            markers: [marker],
          }),
      },
      i18nOptions,
    );
    await waitFor(() => screen.getByTestId("chart-marker-item"));
    expect(screen.getByTestId("chart-marker-item").textContent).toContain("Deploy prod");
  });

  test("timeseries marker labels are translated", async () => {
    renderDashboard(
      chartScreen("timeseries"),
      {
        "demo:query:metric:chart": () =>
          ok({
            windowStartMs: day1,
            windowEndMs: day3,
            points: dayPoints([1, 3, 2]),
            markers: [
              { atMs: day2, label: { i18nKey: "demo.deploy", i18nParams: { env: "stage" } } },
            ],
          }),
      },
      i18nOptions,
    );
    await waitFor(() => screen.getByTestId("chart-marker-item"));
    expect(screen.getByTestId("chart-marker-item").textContent).toContain("Deploy stage");
  });
});

describe("dashboard currency valueFormat and scrollable charts", () => {
  const eur = { kind: "currency", currency: "EUR" } as const;

  test("stat values from minor units render as currency", async () => {
    renderDashboard(
      {
        id: "money",
        type: "dashboard",
        panels: [
          {
            kind: "stat",
            id: "revenue",
            label: "demo:revenue",
            query: "demo:query:kpi:revenue",
            valueField: "value",
            valueFormat: eur,
          },
        ],
      },
      { "demo:query:kpi:revenue": () => ok({ value: 123456 }) },
      { locale: "en" },
    );
    await waitFor(() => screen.getByText("€1,234.56"));
  });

  test("chart legend totals and y ticks use the currency format; fractionDigits trims decimals", async () => {
    renderDashboard(
      chartScreen("stacked-bars", { valueFormat: { ...eur, fractionDigits: 0 } }),
      {
        "demo:query:metric:chart": () =>
          ok({
            windowStartMs: day1,
            windowEndMs,
            series: [{ key: "ok", label: "Income", points: dayPoints([50000, 50000, 0]) }],
          }),
      },
      { locale: "en" },
    );
    await waitFor(() => screen.getByTestId("chart-legend-ok"));
    within(screen.getByTestId("chart-legend-ok")).getByText("€1,000");
    expect(screen.getByTestId("dashboard-chart-main").textContent).toContain("€500");
  });

  const manyBuckets = Array.from({ length: 30 }, (_, i) => ({
    atMs: day1 + i * DAY,
    value: i + 1,
  }));
  const wideArea = {
    windowStartMs: day1,
    windowEndMs: day1 + 29 * DAY,
    series: [{ key: "a", label: "Plan", points: manyBuckets }],
    todayMs: day1 + 10 * DAY,
  };

  test("scrollable stacked-area renders a scroll container wider than 100% for many buckets", async () => {
    renderDashboard(chartScreen("stacked-area", { scrollable: true }), {
      "demo:query:metric:chart": () => ok(wideArea),
    });
    await waitFor(() => screen.getByTestId("chart-scroll-container"));
    const content = screen.getByTestId("chart-scroll-content");
    expect(content.style.minWidth).toBe("100%");
    expect(Number.parseInt(content.style.width, 10)).toBeGreaterThan(300);
    screen.getByTestId("chart-today-line");
  });

  test("a stacked-area chart without scrollable has no scroll container", async () => {
    renderDashboard(chartScreen("stacked-area"), {
      "demo:query:metric:chart": () => ok(wideArea),
    });
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    expect(screen.queryByTestId("chart-scroll-container")).toBeNull();
  });
});

describe("dashboard panel gates (visibleWhen)", () => {
  const GATE = { query: "demo:query:portfolio:state", field: "state", eq: "filled" } as const;
  const gatedScreen: DashboardScreenDefinition = {
    id: "gated",
    type: "dashboard",
    filter: {
      id: "region",
      label: "demo:filter-region",
      kind: "select",
      options: [{ value: "eu", label: "demo:region-eu" }],
    },
    panels: [
      {
        kind: "stat",
        id: "always",
        label: "demo:always",
        query: "demo:query:kpi:always",
        valueField: "value",
      },
      {
        kind: "stat",
        id: "total",
        label: "demo:total",
        query: "demo:query:kpi:total",
        valueField: "value",
        visibleWhen: GATE,
      },
      {
        kind: "stat",
        id: "global",
        label: "demo:global",
        query: "demo:query:kpi:global",
        valueField: "value",
        ignoreScreenFilter: true,
        visibleWhen: GATE,
      },
      {
        kind: "stat-group",
        id: "kpis",
        visibleWhen: GATE,
        stats: [
          {
            kind: "stat",
            id: "child",
            label: "demo:child",
            query: "demo:query:kpi:child",
            valueField: "value",
            ignoreScreenFilter: true,
          },
        ],
      },
      {
        kind: "feed",
        id: "events",
        label: "demo:events",
        query: "demo:query:feed:events",
        visibleWhen: GATE,
      },
      {
        kind: "progress-list",
        id: "progress",
        label: "demo:progress",
        query: "demo:query:prog:rows",
        visibleWhen: GATE,
      },
    ],
  };
  const panelHandlers = {
    "demo:query:kpi:always": () => ok({ value: "always-value" }),
    "demo:query:kpi:total": () => ok({ value: "total-value" }),
    "demo:query:kpi:global": () => ok({ value: "global-value" }),
    "demo:query:kpi:child": () => ok({ value: "child-value" }),
    "demo:query:feed:events": () => ok({ rows: [{ primary: "event-row" }] }),
    "demo:query:prog:rows": () =>
      ok({ rows: [{ label: "progress-row", value: "1", fraction: 0.5 }] }),
  };
  const GATED_IDS = ["total", "global", "kpis", "events", "progress"] as const;

  test("an unmet gate hides the panels and their queries never run; one gate query per payload", async () => {
    window.history.replaceState(null, "", "/gated?region=eu");
    const { calls } = renderDashboard(gatedScreen, {
      ...panelHandlers,
      "demo:query:portfolio:state": () => ok({ state: "empty" }),
    });
    await waitFor(() => screen.getByText("always-value"));
    await waitFor(() =>
      expect(calls.filter((c) => c.type === "demo:query:portfolio:state").length).toBeGreaterThan(
        1,
      ),
    );
    for (const id of GATED_IDS) expect(screen.queryByTestId(`dashboard-panel-${id}`)).toBeNull();
    const panelQueries = ["total", "global", "child"].map((id) => `demo:query:kpi:${id}`);
    expect(calls.some((c) => panelQueries.includes(c.type))).toBe(false);
    expect(calls.some((c) => c.type === "demo:query:feed:events")).toBe(false);
    const gatePayloads = new Set(
      calls
        .filter((c) => c.type === "demo:query:portfolio:state")
        .map((c) => JSON.stringify(c.payload)),
    );
    expect([...gatePayloads].sort()).toEqual(
      [JSON.stringify({}), JSON.stringify({ region: "eu" })].sort(),
    );
  });

  test("a met gate renders every gated panel", async () => {
    window.history.replaceState(null, "", "/gated?region=eu");
    renderDashboard(gatedScreen, {
      ...panelHandlers,
      "demo:query:portfolio:state": () => ok({ state: "filled" }),
    });
    for (const text of [
      "total-value",
      "global-value",
      "child-value",
      "event-row",
      "progress-row",
    ]) {
      await waitFor(() => screen.getByText(text));
    }
  });

  test("retrying a failed gate query reveals the gated panel", async () => {
    let gateCalls = 0;
    renderDashboard(gatedScreen, {
      ...panelHandlers,
      "demo:query:portfolio:state": () => {
        gateCalls += 1;
        return gateCalls === 1 ? failure : ok({ state: "filled" });
      },
    });
    const cell = await waitFor(() => screen.getByTestId("dashboard-panel-events"));
    await userEvent.click(within(cell).getByRole("button"));
    await waitFor(() => screen.getByText("event-row"));
  });

  test("a failing gate query shows the error in the panel's cell instead of dropping it", async () => {
    renderDashboard(gatedScreen, {
      ...panelHandlers,
      "demo:query:portfolio:state": () => failure,
    });
    await waitFor(() => within(screen.getByTestId("dashboard-panel-events")).getByRole("alert"));
    expect(screen.queryByText("event-row")).toBeNull();
  });
});

function KpiIcon(): ReactNode {
  return <svg data-testid="kpi-icon" aria-hidden="true" />;
}

describe("dashboard stat-group subtitle, strip icons and progress sub line", () => {
  test("a labeled stat-group shows its subtitle under the title", async () => {
    renderDashboard(
      {
        id: "group",
        type: "dashboard",
        panels: [
          {
            kind: "stat-group",
            id: "net-worth",
            label: "demo:net-worth",
            subtitle: "demo:net-worth-sub",
            stats: [
              {
                kind: "stat",
                id: "assets",
                label: "demo:assets",
                query: "demo:query:kpi:assets",
                valueField: "value",
              },
            ],
          },
        ],
      },
      { "demo:query:kpi:assets": () => ok({ value: "120.000 €" }) },
    );
    await waitFor(() => screen.getByText("120.000 €"));
    within(screen.getByTestId("dashboard-panel-net-worth")).getByText("demo:net-worth-sub");
  });

  function labeledGroup(id: string, valueCount: number, span?: "half" | "full") {
    return {
      kind: "stat-group" as const,
      id,
      label: `demo:${id}`,
      ...(span !== undefined && { span }),
      stats: Array.from({ length: valueCount }, (_, index) => ({
        kind: "stat" as const,
        id: `${id}-${index}`,
        label: `demo:${id}-${index}`,
        query: "demo:query:kpi:any",
        valueField: "value",
      })),
    };
  }

  test("a stat-group takes span half, default stays the full row", async () => {
    renderDashboard(
      {
        id: "group-span",
        type: "dashboard",
        panels: [labeledGroup("narrow", 2, "half"), labeledGroup("wide", 2)],
      },
      { "demo:query:kpi:any": () => ok({ value: "1" }) },
    );
    const cell = (id: string) =>
      screen.getByTestId(`dashboard-panel-${id}`).parentElement?.className ?? "";
    await waitFor(() => expect(cell("narrow")).toContain("lg:col-span-6"));
    expect(cell("wide")).toContain("lg:col-span-12");
  });

  test("a labeled stat-group wraps its tiles by available width", async () => {
    renderDashboard(
      {
        id: "group-cols",
        type: "dashboard",
        panels: [labeledGroup("one", 1), labeledGroup("three", 3)],
      },
      { "demo:query:kpi:any": () => ok({ value: "1" }) },
    );
    const grid = (id: string) =>
      screen.getByTestId(`dashboard-panel-${id}`).querySelector("section.grid")?.className ?? "";
    await waitFor(() => expect(grid("three")).toContain("auto-fit"));
    expect(grid("one")).toContain("auto-fit");
  });

  test("an unlabeled stat-group keeps each child's icon and accent color", async () => {
    renderDashboard(
      {
        id: "strip",
        type: "dashboard",
        panels: [
          {
            kind: "stat-group",
            id: "kpis",
            stats: [
              {
                kind: "stat",
                id: "debt",
                label: "demo:debt",
                query: "demo:query:kpi:debt",
                valueField: "value",
                icon: { react: { __component: "kpi-icon" } },
                accentColor: "#123456",
              },
            ],
          },
        ],
      },
      { "demo:query:kpi:debt": () => ok({ value: "90.000 €" }) },
      { extensionSections: { "kpi-icon": KpiIcon } },
    );
    await waitFor(() => screen.getByTestId("kpi-icon"));
    const chip = screen.getByTestId("kpi-icon").parentElement;
    expect(chip?.getAttribute("style") ?? "").toContain("#123456");
    within(screen.getByTestId("dashboard-panel-debt")).getByText("demo:debt");
  });

  test("a progress row sub line is translated", async () => {
    renderDashboard(
      {
        id: "prog",
        type: "dashboard",
        panels: [
          { kind: "progress-list", id: "prog", label: "demo:prog", query: "demo:query:prog:rows" },
        ],
      },
      {
        "demo:query:prog:rows": () =>
          ok({
            rows: [
              {
                label: "Baudarlehen",
                value: "42.000 €",
                fraction: 0.4,
                sub: { i18nKey: "demo.paid", i18nParams: { pct: 40 } },
              },
            ],
          }),
      },
      { locale: "en", translations: { en: { "demo.paid": "{pct} % paid off" } } },
    );
    await waitFor(() => screen.getByText("40 % paid off"));
  });

  describe("progress-list used/limit rows", () => {
    function renderProgressRows(rows: readonly Record<string, unknown>[]): void {
      renderDashboard(
        {
          id: "prog",
          type: "dashboard",
          panels: [
            {
              kind: "progress-list",
              id: "prog",
              label: "demo:prog",
              query: "demo:query:prog:rows",
            },
          ],
        },
        { "demo:query:prog:rows": () => ok({ rows }) },
        { locale: "en" },
      );
    }

    const barFillOf = (bar: HTMLElement): Element | null => bar.firstElementChild;

    test("shows used / limit with locale number format and fills used / limit", async () => {
      renderProgressRows([{ label: "Users", used: 1234, limit: 5000 }]);
      const value = await screen.findByText("1,234 / 5,000");
      expect(value.className).not.toContain("text-status-critical");
      const fill = barFillOf(screen.getByRole("progressbar"));
      expect(fill?.getAttribute("style")).toContain("width: 24.68%");
      expect(fill?.className).not.toContain("bg-status-critical");
    });

    test("limit null shows unlimited and renders no bar", async () => {
      renderProgressRows([{ label: "Users", used: 12, limit: null }]);
      await screen.findByText("12 / unlimited");
      expect(screen.queryByRole("progressbar")).toBeNull();
    });

    test("used >= limit turns bar and value danger", async () => {
      renderProgressRows([{ label: "Users", used: 5, limit: 5 }]);
      const value = await screen.findByText("5 / 5");
      expect(value.className).toContain("text-status-critical");
      const fill = barFillOf(screen.getByRole("progressbar"));
      expect(fill?.className).toContain("bg-status-critical");
      expect(fill?.getAttribute("style")).toContain("width: 100%");
    });

    test("limit 0 fills the bar completely", async () => {
      renderProgressRows([{ label: "Users", used: 0, limit: 0 }]);
      await screen.findByText("0 / 0");
      expect(barFillOf(screen.getByRole("progressbar"))?.getAttribute("style")).toContain(
        "width: 100%",
      );
    });

    test("an explicit tone wins over the automatic one", async () => {
      renderProgressRows([
        { label: "A", used: 9, limit: 5, tone: "default" },
        { label: "B", used: 1, limit: 5, tone: "danger" },
      ]);
      const exhausted = await screen.findByText("9 / 5");
      expect(exhausted.className).not.toContain("text-status-critical");
      expect(screen.getByText("1 / 5").className).toContain("text-status-critical");
    });

    test("fraction rows keep value and fraction and never get an automatic tone", async () => {
      renderProgressRows([{ label: "Loan", value: "42.000 €", fraction: 1 }]);
      const value = await screen.findByText("42.000 €");
      expect(value.className).not.toContain("text-status-critical");
      const fill = barFillOf(screen.getByRole("progressbar"));
      expect(fill?.getAttribute("style")).toContain("width: 100%");
      expect(fill?.className).not.toContain("bg-status-critical");
    });

    test("a half-filled used/limit pair falls back to fraction mode", async () => {
      renderProgressRows([{ label: "Loan", value: "x", fraction: 0.5, used: 3 }]);
      await screen.findByText("x");
    });
  });
});

describe("dashboard stacked-area lines, marker kinds and ranges", () => {
  const MONTH_COUNT = 37;
  const jan2026 = Date.UTC(2026, 0, 1);
  const monthAt = (index: number) => Date.UTC(2026, index, 1);
  const monthly = (value: (index: number) => number) =>
    Array.from({ length: MONTH_COUNT }, (_, i) => ({ atMs: monthAt(i), value: value(i) }));
  const planPayload = {
    windowStartMs: jan2026,
    windowEndMs: monthAt(MONTH_COUNT - 1),
    todayMs: jan2026,
    series: [{ key: "remaining", label: "demo:remaining", points: monthly((i) => 1000 - i * 10) }],
    lines: [
      { key: "rent", label: "demo:rent", points: monthly(() => 400) },
      { key: "rent-min", label: "demo:rent-min", dashed: true, points: monthly(() => 300) },
    ],
    markers: [
      { atMs: monthAt(6), label: "Extra", kind: "extra" },
      { atMs: monthAt(30), label: "Payoff", kind: "payoff" },
      { atMs: monthAt(8), label: "Unknown kind", kind: "nope" },
    ],
  };

  test("lines and marker kinds render with translated labels and configured colors", async () => {
    renderDashboard(
      chartScreen("stacked-area", {
        seriesColors: { remaining: "var(--color-debt)", rent: "var(--color-rent)" },
        markerKinds: { extra: { color: "var(--color-extra)" }, payoff: { tone: "positive" } },
        legendTotals: false,
      }),
      { "demo:query:metric:chart": () => ok(planPayload) },
    );
    await waitFor(() => screen.getByTestId("chart-line-rent"));
    expect(screen.getByTestId("chart-line-rent").getAttribute("stroke")).toBe("var(--color-rent)");
    expect(screen.getByTestId("chart-line-rent-min").getAttribute("stroke-dasharray")).toBe("6 4");
    expect(screen.getByTestId("chart-legend-line-rent").textContent).toBe("demo:rent");
    expect(screen.getByTestId("chart-legend-remaining").textContent).toBe("demo:remaining");
    const guides = screen.getAllByTestId("chart-marker-guide");
    expect(guides.map((g) => g.getAttribute("stroke"))).toEqual([
      "var(--color-extra)",
      "var(--color-status-ok)",
    ]);
    expect(screen.getAllByTestId("chart-marker-pin")).toHaveLength(3);
  });

  test("the range switch windows bands, lines and markers; max shows everything", async () => {
    renderDashboard(
      chartScreen("stacked-area", {
        ranges: {
          options: [
            { value: "1y", label: "demo:range-1y", months: 12 },
            { value: "max", label: "demo:range-max" },
          ],
          default: "1y",
        },
      }),
      { "demo:query:metric:chart": () => ok(planPayload) },
    );
    await waitFor(() => screen.getByTestId("chart-line-rent"));
    const rangeSwitch = screen.getByTestId("dashboard-chart-range-main");
    expect(rangeSwitch.closest("header")).not.toBeNull();
    expect(screen.getAllByTestId("chart-marker-pin")).toHaveLength(2);
    expect(screen.getByTestId("chart-line-rent").getAttribute("d")?.match(/L /g)).toHaveLength(12);
    await userEvent.click(within(rangeSwitch).getByRole("button", { name: "demo:range-max" }));
    await waitFor(() => expect(screen.getAllByTestId("chart-marker-pin")).toHaveLength(3));
    expect(screen.getByTestId("chart-line-rent").getAttribute("d")?.match(/L /g)).toHaveLength(
      MONTH_COUNT - 1,
    );
  });

  test("a filter change that adds a gate query keeps the range selection of the chart", async () => {
    window.history.replaceState(null, "", "/charts");
    const gate = { query: "demo:query:portfolio:state", field: "state", eq: "filled" } as const;
    const base = chartScreen("stacked-area", {
      ranges: {
        options: [
          { value: "1y", label: "demo:range-1y", months: 12 },
          { value: "max", label: "demo:range-max" },
        ],
        default: "1y",
      },
    });
    const screenWithGates: DashboardScreenDefinition = {
      ...base,
      filter: {
        id: "region",
        label: "demo:filter-region",
        kind: "select",
        options: [{ value: "eu", label: "demo:region-eu" }],
      },
      panels: [
        ...base.panels,
        {
          kind: "stat",
          id: "scoped",
          label: "demo:scoped",
          query: "demo:query:kpi:scoped",
          valueField: "value",
          visibleWhen: gate,
        },
        {
          kind: "stat",
          id: "global",
          label: "demo:global",
          query: "demo:query:kpi:global",
          valueField: "value",
          ignoreScreenFilter: true,
          visibleWhen: gate,
        },
      ],
    };
    const { calls } = renderDashboard(screenWithGates, {
      "demo:query:metric:chart": () => ok(planPayload),
      "demo:query:portfolio:state": () => ok({ state: "filled" }),
      "demo:query:kpi:scoped": () => ok({ value: "scoped-value" }),
      "demo:query:kpi:global": () => ok({ value: "global-value" }),
    });
    await waitFor(() => screen.getByTestId("chart-line-rent"));
    const rangeSwitch = screen.getByTestId("dashboard-chart-range-main");
    const max = within(rangeSwitch).getByRole("button", { name: "demo:range-max" });
    await userEvent.click(max);
    await waitFor(() => expect(max.getAttribute("aria-pressed")).toBe("true"));

    act(() => {
      window.history.pushState(null, "", "/charts?region=eu");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() =>
      expect(calls.some((c) => c.type === gate.query && c.payload["region"] === "eu")).toBe(true),
    );
    await waitFor(() => screen.getByText("scoped-value"));
    expect(
      within(screen.getByTestId("dashboard-chart-range-main"))
        .getByRole("button", { name: "demo:range-max" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  test("the brush scrubs the window by keyboard and deselects the header range switch", async () => {
    renderDashboard(
      chartScreen("stacked-area", {
        brush: true,
        ranges: {
          options: [
            { value: "1y", label: "demo:range-1y", months: 12 },
            { value: "max", label: "demo:range-max" },
          ],
          default: "1y",
        },
      }),
      { "demo:query:metric:chart": () => ok(planPayload) },
    );
    await waitFor(() => screen.getByTestId("dashboard-chart-main-brush"));
    const rangeSwitch = screen.getByTestId("dashboard-chart-range-main");
    expect(rangeSwitch.closest("header")).not.toBeNull();
    expect(screen.getByTestId("dashboard-chart-main").contains(rangeSwitch)).toBe(false);
    const oneYear = within(rangeSwitch).getByRole("button", { name: "demo:range-1y" });
    expect(oneYear.getAttribute("aria-pressed")).toBe("true");
    const [startHandle] = screen.getAllByRole("slider");
    if (startHandle === undefined) throw new Error("start handle missing");
    fireEvent.keyDown(startHandle, { key: "ArrowRight" });
    await waitFor(() => expect(oneYear.getAttribute("aria-pressed")).toBe("false"));
    await userEvent.click(oneYear);
    await waitFor(() => expect(oneYear.getAttribute("aria-pressed")).toBe("true"));
  });

  test("brush alone starts at today and renders no range switch", async () => {
    renderDashboard(chartScreen("stacked-area", { brush: true }), {
      "demo:query:metric:chart": () => ok({ ...planPayload, todayMs: monthAt(12) }),
    });
    await waitFor(() => screen.getByTestId("dashboard-chart-main-brush"));
    expect(screen.queryByTestId("dashboard-chart-range-main")).toBeNull();
    expect(screen.getAllByRole("slider")[0]?.getAttribute("aria-valuenow")).toBe("12");
  });

  const yearRanges = {
    options: [
      { value: "1y", label: "demo:range-1y", months: 12 },
      { value: "max", label: "demo:range-max" },
    ],
    default: "1y",
  };

  test("initialWindow from-today overrides the default range; a range click switches", async () => {
    renderDashboard(
      chartScreen("stacked-area", { ranges: yearRanges, initialWindow: "from-today" }),
      { "demo:query:metric:chart": () => ok({ ...planPayload, todayMs: monthAt(12) }) },
    );
    await waitFor(() => screen.getByTestId("chart-line-rent"));
    const rangeSwitch = screen.getByTestId("dashboard-chart-range-main");
    for (const button of within(rangeSwitch).getAllByRole("button")) {
      expect(button.getAttribute("aria-pressed")).toBe("false");
    }
    expect(screen.getByTestId("chart-line-rent").getAttribute("d")?.match(/L /g)).toHaveLength(
      MONTH_COUNT - 1 - 12,
    );
    await userEvent.click(within(rangeSwitch).getByRole("button", { name: "demo:range-1y" }));
    await waitFor(() =>
      expect(screen.getByTestId("chart-line-rent").getAttribute("d")?.match(/L /g)).toHaveLength(
        12,
      ),
    );
  });

  test("markerLegend legend lists translated marker kinds instead of the numbered list", async () => {
    renderDashboard(
      chartScreen("stacked-area", {
        markerLegend: "legend",
        markerKinds: {
          extra: { color: "var(--color-extra)", label: "demo:kind-extra" },
          payoff: { tone: "positive", label: "demo:kind-payoff" },
        },
      }),
      { "demo:query:metric:chart": () => ok(planPayload) },
    );
    await waitFor(() => screen.getByTestId("chart-line-rent"));
    expect(screen.queryAllByTestId("chart-marker-item")).toHaveLength(0);
    const entries = screen.getAllByTestId(/^chart-legend-marker-/);
    expect(entries.map((entry) => entry.textContent)).toEqual([
      "demo:kind-extra",
      "demo:kind-payoff",
      "Unknown kind",
    ]);
    expect(screen.getAllByTestId("chart-marker-pin")[0]?.getAttribute("title")).toContain(
      "Extra · ",
    );
  });

  test("a 12 month window labels the axis with day and month only", async () => {
    renderDashboard(chartScreen("stacked-area", { ranges: yearRanges }), {
      "demo:query:metric:chart": () => ok(planPayload),
    });
    await waitFor(() => screen.getByTestId("chart-line-rent"));
    expect(screen.getByTestId("dashboard-chart-main").textContent).not.toContain("2027");
  });

  test("dateFormat month adds the year to the axis labels", async () => {
    renderDashboard(chartScreen("stacked-area", { ranges: yearRanges, dateFormat: "month" }), {
      "demo:query:metric:chart": () => ok(planPayload),
    });
    await waitFor(() => screen.getByTestId("chart-line-rent"));
    expect(screen.getByTestId("dashboard-chart-main").textContent).toContain("2027");
  });
});

describe("dashboard stacked-area panel header and axes", () => {
  const years = [2026, 2027, 2028].map((year) => Date.UTC(year, 0, 1));
  const payload = {
    windowStartMs: years[0],
    windowEndMs: years[2],
    series: [
      {
        key: "remaining",
        label: "Remaining",
        points: years.map((atMs, i) => ({ atMs, value: 150_000_000 - i * 50_000_000 })),
      },
    ],
    markers: [
      { atMs: years[1], label: "Payoff one" },
      { atMs: years[2], label: "Payoff two" },
    ],
  };
  const handlers = { "demo:query:metric:chart": () => ok(payload) };
  const ranges = {
    options: [
      { value: "y1", label: "1 Y", months: 12 },
      { value: "max", label: "Max" },
    ],
    default: "max",
  };

  test("the y axis shows compact currency, not the full amount", async () => {
    renderDashboard(
      chartScreen("stacked-area", {
        valueFormat: { kind: "currency", currency: "EUR" },
        legendTotals: false,
      }),
      handlers,
      { locale: "de-DE" },
    );
    const tick = await screen.findByText(/^1,5\sMio\.\s€$/);
    screen.getByText(/^750\.000\s€$/);
    screen.getByText(/^0\s€$/);
    expect(tick.parentElement?.textContent).not.toContain("1.500.000,00");
  });

  test("the tooltip rounds sub-million amounts to whole compact euros", async () => {
    renderDashboard(
      chartScreen("stacked-area", {
        valueFormat: { kind: "currency", currency: "EUR" },
        legendTotals: false,
      }),
      {
        "demo:query:metric:chart": () =>
          ok({
            windowStartMs: years[0],
            windowEndMs: years[2],
            series: [
              {
                key: "remaining",
                label: "Remaining",
                points: years.map((atMs) => ({ atMs, value: 29_898_990 })),
              },
            ],
          }),
      },
      { locale: "de-DE" },
    );
    const overlay = await screen.findByTestId("chart-tooltip-overlay");
    overlay.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 100, right: 400, bottom: 100 }) as DOMRect;
    fireEvent.pointerMove(overlay, { pointerType: "mouse", clientX: 200 });
    const card = screen.getByTestId("chart-tooltip");
    within(card).getByText(/^299\.000\s€$/);
  });

  test("stacked-bars and timeseries y axes use compact currency while legend totals stay exact", async () => {
    const big = { kind: "currency", currency: "EUR" } as const;
    renderDashboard(
      chartScreen("stacked-bars", { valueFormat: big }),
      {
        "demo:query:metric:chart": () =>
          ok({
            windowStartMs: day1,
            windowEndMs,
            series: [{ key: "ok", label: "Income", points: dayPoints([150000000, 0, 0]) }],
          }),
      },
      { locale: "de-DE" },
    );
    await waitFor(() => screen.getByTestId("chart-legend-ok"));
    await screen.findByText(/^2\sMio\.\s€$/);
    within(screen.getByTestId("chart-legend-ok")).getByText(/^1\.500\.000,00\s€$/);
  });

  test("timeseries y axis uses compact currency", async () => {
    renderDashboard(
      chartScreen("timeseries", { valueFormat: { kind: "currency", currency: "EUR" } }),
      {
        "demo:query:metric:chart": () =>
          ok({
            windowStartMs: day1,
            windowEndMs: day3,
            points: dayPoints([100000000, 150000000, 120000000]),
          }),
      },
      { locale: "de-DE" },
    );
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    expect(screen.getByTestId("dashboard-chart-main").textContent).toMatch(/Mio\./);
    expect(screen.getByTestId("dashboard-chart-main").textContent).not.toContain("1.500.000,00");
  });

  test("timeseries unit is shown once on the y axis without a valueFormat", async () => {
    renderDashboard(
      chartScreen("timeseries", { unit: "demo:unit-ms" }),
      {
        "demo:query:metric:chart": () =>
          ok({ windowStartMs: day1, windowEndMs: day3, points: dayPoints([120, 560, 300]) }),
      },
      { locale: "en", translations: { en: { "demo:unit-ms": "ms" } } },
    );
    const unit = await screen.findByTestId("dashboard-chart-main-y-unit");
    expect(unit.textContent).toBe("ms");
    expect(screen.getAllByTestId("dashboard-chart-main-y-unit")).toHaveLength(1);
    const tickLabels = [...document.querySelectorAll("[data-y-label]")].map((n) => n.textContent);
    expect(tickLabels.length).toBe(3);
    for (const label of tickLabels) expect(label).not.toContain("ms");
  });

  test("the subtitle sits in its own element at the right end of the header", async () => {
    renderDashboard(chartScreen("stacked-area", { subtitle: "demo:chart-subtitle" }), handlers);
    const subtitle = await screen.findByText("demo:chart-subtitle");
    const header = subtitle.closest("header");
    expect(header).not.toBeNull();
    expect(subtitle.getAttribute("data-slot")).toBe("panel-subtitle");
    expect(subtitle.parentElement?.className).toContain("ml-auto");
    expect(header?.contains(screen.getByRole("heading", { name: "demo:chart" }))).toBe(true);
  });

  test("markerLabels is passed through to the chart", async () => {
    renderDashboard(chartScreen("stacked-area", { markerLabels: true }), handlers);
    const labels = await screen.findAllByTestId("chart-marker-label");
    expect(labels.map((label) => label.textContent)).toEqual(["Payoff one", "Payoff two"]);
  });

  test("marker labels are absent without markerLabels", async () => {
    renderDashboard(chartScreen("stacked-area"), handlers);
    await screen.findByTestId("dashboard-chart-main");
    expect(screen.queryByTestId("chart-marker-label")).toBeNull();
  });

  test("the pill of ranges.default is active", async () => {
    renderDashboard(chartScreen("stacked-area", { ranges }), handlers);
    const rangeSwitch = await screen.findByTestId("dashboard-chart-range-main");
    expect(
      within(rangeSwitch).getByRole("button", { name: "Max" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(rangeSwitch).getByRole("button", { name: "1 Y" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });
});

describe("dashboard text panel", () => {
  const textDashboard = (extra: Record<string, unknown> = {}): DashboardScreenDefinition =>
    ({
      id: "help",
      type: "dashboard",
      panels: [
        {
          kind: "text",
          id: "intro",
          label: "demo.help.title",
          blocks: [
            { kind: "heading", text: "demo.help.heading" },
            { kind: "paragraph", text: "demo.help.body" },
            { kind: "paragraph", text: "demo.help.strong", emphasis: "strong" },
            { kind: "list", items: ["demo.help.item-1", "demo.help.item-2"] },
            { kind: "code", code: "curl -H 'x-demo: demo.help.heading' <url>" },
            { kind: "hint", text: "demo.help.hint" },
          ],
          ...extra,
        },
      ],
    }) as DashboardScreenDefinition;

  const translations = {
    en: {
      "demo.help.title": "Getting started",
      "demo.help.heading": "Step one",
      "demo.help.body": "Create a key.",
      "demo.help.strong": "Keep it secret.",
      "demo.help.item-1": "First item",
      "demo.help.item-2": "Second item",
      "demo.help.hint": "Takes a minute.",
    },
  };

  test("a lead paragraph renders larger than the muted default", async () => {
    renderDashboard(
      {
        id: "help",
        type: "dashboard",
        panels: [
          {
            kind: "text",
            id: "intro",
            label: "demo.help.title",
            blocks: [{ kind: "paragraph", text: "demo.help.body", emphasis: "lead" }],
          },
        ],
      },
      {},
      { locale: "en", translations },
    );
    const lead = await screen.findByText("Create a key.");
    expect(lead.className).toContain("text-[17px]");
  });

  test("identical blocks and list entries render once each without duplicate-key warnings", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      renderDashboard(
        {
          id: "help",
          type: "dashboard",
          panels: [
            {
              kind: "text",
              id: "dup",
              blocks: [
                { kind: "hint", text: "demo.help.hint" },
                { kind: "hint", text: "demo.help.hint" },
                { kind: "list", items: ["demo.help.item-1", "demo.help.item-1"] },
              ],
            },
          ],
        } as DashboardScreenDefinition,
        {},
        { locale: "en", translations },
      );
      const panel = await screen.findByTestId("dashboard-panel-dup");
      expect(panel.querySelectorAll("[data-block=hint]")).toHaveLength(2);
      expect(within(panel).getAllByRole("listitem")).toHaveLength(2);
      const keyWarnings = consoleError.mock.calls.filter((call) =>
        String(call[0]).includes("same key"),
      );
      expect(keyWarnings).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  test("renders every block kind with translated text and the code verbatim", async () => {
    renderDashboard(textDashboard(), {}, { locale: "en", translations });
    const panel = await screen.findByTestId("dashboard-panel-intro");
    within(panel).getByText("Getting started");
    within(panel).getByRole("heading", { name: "Step one" });
    const paragraphs = [...panel.querySelectorAll("[data-block=paragraph]")];
    expect(paragraphs.map((p) => p.textContent)).toEqual(["Create a key.", "Keep it secret."]);
    expect(paragraphs[0]?.className).toContain("text-muted-foreground");
    expect(paragraphs[1]?.className).toContain("font-medium");
    expect(
      within(panel)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["First item", "Second item"]);
    const code = panel.querySelector("pre > code");
    expect(code?.textContent).toBe("curl -H 'x-demo: demo.help.heading' <url>");
    expect(panel.querySelector("pre")?.className).toContain("overflow-x-auto");
    expect(panel.querySelector("[data-block=hint]")?.textContent).toBe("Takes a minute.");
  });

  test("renders without a label as a plain card", async () => {
    renderDashboard(textDashboard({ label: undefined }), {}, { locale: "en", translations });
    const panel = await screen.findByTestId("dashboard-panel-intro");
    expect(panel.querySelector("h2")).toBeNull();
    within(panel).getByText("Create a key.");
  });

  test.each([
    [false, false],
    [true, true],
  ])("visibleWhen gate result %p makes the panel visible: %p", async (gateValue, visible) => {
    const { calls } = renderDashboard(
      textDashboard({ visibleWhen: { query: "demo:query:gate", field: "ok", eq: true } }),
      { "demo:query:gate": () => ok({ ok: gateValue }) },
      { locale: "en", translations },
    );
    await waitFor(() => expect(calls.some((c) => c.type === "demo:query:gate")).toBe(true));
    if (visible) {
      await screen.findByTestId("dashboard-panel-intro");
    } else {
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByTestId("dashboard-panel-intro")).toBeNull();
    }
  });
});

describe("dashboard feed showTotal", () => {
  const feedScreen = (showTotal: true | { text: string }): DashboardScreenDefinition => ({
    id: "board",
    type: "dashboard",
    panels: [
      { kind: "feed", id: "dates", label: "demo:dates", query: "demo:query:feed:dates", showTotal },
    ],
  });
  const rows = { rows: [{ primary: "A" }, { primary: "B" }] };

  test("a custom text shows the rows count in the panel head", async () => {
    renderDashboard(
      feedScreen({ text: "demo:count" }),
      { "demo:query:feed:dates": () => ok(rows) },
      {
        locale: "en",
        translations: { en: { "demo:count": "{total}" } },
      },
    );
    const head = await screen.findByText("2");
    expect(head.getAttribute("data-slot")).toBe("panel-subtitle");
  });

  test("the query's total wins over the rows returned", async () => {
    renderDashboard(
      feedScreen({ text: "demo:count" }),
      { "demo:query:feed:dates": () => ok({ ...rows, total: 7 }) },
      { locale: "en", translations: { en: { "demo:count": "{total}" } } },
    );
    await screen.findByText("7");
  });
});

describe("dashboard list showTotal, footer link and stat-group link", () => {
  const listScreen: DashboardScreenDefinition = {
    id: "board",
    type: "dashboard",
    panels: [
      {
        kind: "list",
        id: "now",
        label: "demo:now",
        query: "demo:query:jobs:list",
        columns: ["name"],
        showTotal: true,
        footerLink: { label: "demo:all-jobs", screen: "jobs" },
      },
      {
        kind: "stat-group",
        id: "counts",
        label: "demo:counts",
        layout: "strip",
        link: { label: "demo:open-jobs", screen: "jobs" },
        stats: [
          {
            kind: "stat",
            id: "late",
            label: "demo:late",
            query: "demo:query:kpi:late",
            valueField: "value",
          },
        ],
      },
    ],
  };

  test("shows 'n of m', the remaining count and both links", async () => {
    renderDashboard(listScreen, {
      "demo:query:jobs:list": () => ok({ rows: [{ name: "A" }, { name: "B" }], total: 5 }),
      "demo:query:kpi:late": () => ok({ value: "3" }),
    });
    await waitFor(() => screen.getByTestId("dashboard-list-more"));
    expect(screen.getByTestId("dashboard-list-more").textContent).toContain("3");
    expect(screen.getByTestId("dashboard-list-footer-link").textContent).toBe("demo:all-jobs");
    expect(screen.getByTestId("dashboard-stat-group-link").textContent).toContain("demo:open-jobs");
  });

  test("without a total no remaining count is shown", async () => {
    renderDashboard(listScreen, {
      "demo:query:jobs:list": () => ok({ rows: [{ name: "A" }] }),
      "demo:query:kpi:late": () => ok({ value: "3" }),
    });
    await waitFor(() => screen.getByTestId("dashboard-list-footer-link"));
    expect(screen.queryByTestId("dashboard-list-more")).toBeNull();
  });

  test("a footerLink without label shows only the remaining count, no link", async () => {
    const [listPanel] = listScreen.panels;
    if (listPanel === undefined || listPanel.kind !== "list")
      throw new Error("list panel expected");
    renderDashboard(
      { ...listScreen, panels: [{ ...listPanel, footerLink: { screen: "jobs" } }] },
      { "demo:query:jobs:list": () => ok({ rows: [{ name: "A" }, { name: "B" }], total: 5 }) },
    );
    await waitFor(() => screen.getByTestId("dashboard-list-more"));
    expect(screen.getByTestId("dashboard-list-more").textContent).toContain("3");
    expect(screen.queryByTestId("dashboard-list-footer-link")).toBeNull();
  });
});

describe("dashboard board gaps: cards layout, subtitle fallback, gated tiles", () => {
  const kpiStats = [
    { kind: "stat" as const, id: "a", label: "demo:a", query: "demo:query:kpi:a", valueField: "v" },
  ];

  test("a stat-group with layout cards and no label renders the cards without a heading", async () => {
    renderDashboard(
      {
        id: "cards",
        type: "dashboard",
        panels: [{ kind: "stat-group", id: "plain", layout: "cards", stats: kpiStats }],
      },
      { "demo:query:kpi:a": () => ok({ v: "7" }) },
    );
    await waitFor(() => screen.getByText("7"));
    const panel = screen.getByTestId("dashboard-panel-plain");
    expect(panel.querySelector("h2")).toBeNull();
    expect(panel.querySelector("section.grid")?.className).toContain("auto-fit");
  });

  test("a list panel shows its static subtitle while the query is loading, and no footer link", async () => {
    renderDashboard(
      {
        id: "loading",
        type: "dashboard",
        panels: [
          {
            kind: "list",
            id: "now",
            label: "demo:now",
            subtitle: "demo:now-sub",
            query: "demo:query:jobs:list",
            columns: ["name"],
            footerLink: { label: "demo:all-jobs", screen: "jobs" },
          },
        ],
      },
      { "demo:query:jobs:list": () => new Promise(() => {}) },
    );
    await waitFor(() => screen.getByText("demo:now-sub"));
    expect(screen.queryByTestId("dashboard-list-footer-link")).toBeNull();
  });

  test("a stat tile whose navigate target the user may not open is hidden", async () => {
    const gated: FeatureSchema = {
      featureName: FEATURE,
      entities: {},
      screens: [
        {
          id: "demo:screen:secret",
          type: "custom",
          renderer: { react: "Secret" },
          access: { roles: ["Admin"] },
        },
      ],
    };
    renderDashboard(
      {
        id: "gate",
        type: "dashboard",
        panels: [
          {
            kind: "stat",
            id: "locked",
            label: "demo:locked",
            query: "demo:query:kpi:a",
            valueField: "v",
            navigate: { screen: "secret" },
          },
          {
            kind: "stat",
            id: "open",
            label: "demo:open",
            query: "demo:query:kpi:a",
            valueField: "v",
          },
        ],
      },
      { "demo:query:kpi:a": () => ok({ v: "7" }) },
      { appFeatures: [gated] },
    );
    await waitFor(() => screen.getByTestId("dashboard-panel-open"));
    expect(screen.queryByTestId("dashboard-panel-locked")).toBeNull();
  });
});

describe("dashboard titled stat strip with a gated tile", () => {
  test("a tile the user may not open leaves no empty cell in the strip", async () => {
    const gated: FeatureSchema = {
      featureName: FEATURE,
      entities: {},
      screens: [
        {
          id: "demo:screen:secret",
          type: "custom",
          renderer: { react: "Secret" },
          access: { roles: ["Admin"] },
        },
      ],
    };
    renderDashboard(
      {
        id: "gated-strip",
        type: "dashboard",
        panels: [
          {
            kind: "stat-group",
            id: "counts",
            label: "demo:counts",
            layout: "strip",
            stats: [
              {
                kind: "stat",
                id: "locked",
                label: "demo:locked",
                query: "demo:query:kpi:a",
                valueField: "v",
                navigate: { screen: "secret" },
              },
              {
                kind: "stat",
                id: "open",
                label: "demo:open",
                query: "demo:query:kpi:a",
                valueField: "v",
              },
            ],
          },
        ],
      },
      { "demo:query:kpi:a": () => ok({ v: "7" }) },
      { appFeatures: [gated] },
    );
    const group = await screen.findByTestId("dashboard-panel-counts");
    await waitFor(() => within(group).getByText("demo:open"));
    expect(within(group).queryByText("demo:locked")).toBeNull();
    const cells = group.querySelectorAll(".items-stretch > div");
    expect(cells).toHaveLength(1);
    expect(group.style.getPropertyValue("--stat-count")).toBe("1");
  });
});

describe("dashboard stat-group strip with a group link and a navigating tile", () => {
  test("the tile with its own navigate sits above the group link's overlay", async () => {
    renderDashboard(
      {
        id: "strip-link",
        type: "dashboard",
        panels: [
          {
            kind: "stat-group",
            id: "counts",
            label: "demo:counts",
            layout: "strip",
            link: { label: "demo:open-jobs", screen: "jobs" },
            stats: [
              {
                kind: "stat",
                id: "late",
                label: "demo:late",
                query: "demo:query:kpi:late",
                valueField: "v",
                navigate: { screen: "jobs" },
              },
              {
                kind: "stat",
                id: "open",
                label: "demo:open",
                query: "demo:query:kpi:late",
                valueField: "v",
              },
            ],
          },
        ],
      },
      { "demo:query:kpi:late": () => ok({ v: "3" }) },
    );
    const link = await screen.findByTestId("dashboard-stat-group-link");
    expect(link.className).toContain("max-sm:after:absolute");
    const group = screen.getByTestId("dashboard-panel-counts");
    const raised = group.querySelectorAll(".max-sm\\:z-10");
    expect(raised).toHaveLength(1);
    within(raised[0] as HTMLElement).getByText("demo:late");
    expect(within(raised[0] as HTMLElement).queryByText("demo:open")).toBeNull();
  });
});

describe("dashboard resultField", () => {
  const OVERVIEW_QUERY = "demo:query:overview:today";
  const overviewScreen: DashboardScreenDefinition = {
    id: "overview",
    type: "dashboard",
    panels: [
      {
        kind: "stat",
        id: "open",
        label: "demo:open",
        query: OVERVIEW_QUERY,
        resultField: "stats",
        valueField: "open",
      },
      {
        kind: "stat",
        id: "closed",
        label: "demo:closed",
        query: OVERVIEW_QUERY,
        resultField: "stats",
        valueField: "closed",
      },
      {
        kind: "list",
        id: "recent",
        label: "demo:recent",
        query: OVERVIEW_QUERY,
        resultField: "recent",
        columns: ["title"],
      },
    ],
  };

  test("panels on one query share one request and each reads its own field", async () => {
    const { calls } = renderDashboard(overviewScreen, {
      [OVERVIEW_QUERY]: () =>
        ok({
          stats: { open: 3, closed: 8 },
          recent: { rows: [{ title: "Printer broken" }], nextCursor: null, total: 1 },
        }),
    });
    await waitFor(() => screen.getByText("Printer broken"));
    expect(screen.getByTestId("dashboard-panel-open").textContent).toContain("3");
    expect(screen.getByTestId("dashboard-panel-closed").textContent).toContain("8");
    expect(calls.filter((call) => call.type === OVERVIEW_QUERY)).toHaveLength(1);
  });
});

describe("dashboard design options", () => {
  const barChart = {
    windowStartMs: day1,
    windowEndMs,
    series: [{ key: "ok", label: "Delivered", points: dayPoints([3, 4, 5]) }],
  };
  const barHandler = { "demo:query:metric:chart": () => ok(barChart) };

  test("subToneField colors the sub line, without it the line stays muted", async () => {
    const panel = (extra: Record<string, unknown>) =>
      ({
        id: "s",
        type: "dashboard",
        panels: [
          {
            kind: "stat",
            id: "kpi",
            label: "demo:kpi",
            query: "demo:query:kpi:a",
            valueField: "v",
            subField: "sub",
            ...extra,
          },
        ],
      }) as DashboardScreenDefinition;
    const handlers = { "demo:query:kpi:a": () => ok({ v: "7", sub: "+12 %", st: "negative" }) };
    renderDashboard(panel({ subToneField: "st" }), handlers);
    const sub = await screen.findByText("+12 %");
    expect(sub.className).toContain("text-status-bad");
  });

  test("subToneField absent keeps the muted sub line", async () => {
    renderDashboard(
      {
        id: "s",
        type: "dashboard",
        panels: [
          {
            kind: "stat",
            id: "kpi",
            label: "demo:kpi",
            query: "demo:query:kpi:a",
            valueField: "v",
            subField: "sub",
          },
        ],
      },
      { "demo:query:kpi:a": () => ok({ v: "7", sub: "+12 %", st: "negative" }) },
    );
    const sub = await screen.findByText("+12 %");
    expect(sub.className).toContain("text-muted-foreground");
  });

  test("stat-group framed:false renders the cards without the panel frame", async () => {
    renderDashboard(
      {
        id: "cards",
        type: "dashboard",
        panels: [
          {
            kind: "stat-group",
            id: "plain",
            layout: "cards",
            framed: false,
            stats: [
              {
                kind: "stat",
                id: "a",
                label: "demo:a",
                query: "demo:query:kpi:a",
                valueField: "v",
              },
            ],
          },
        ],
      },
      { "demo:query:kpi:a": () => ok({ v: "7" }) },
    );
    await waitFor(() => screen.getByText("7"));
    const panel = screen.getByTestId("dashboard-panel-plain");
    expect(panel.tagName).toBe("SECTION");
    expect(panel.querySelector("h2")).toBeNull();
  });

  test("barValueLabels draws the bucket total above each bar", async () => {
    renderDashboard(chartScreen("stacked-bars", { barValueLabels: true }), barHandler);
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    expect(screen.getAllByTestId("chart-bar-value").map((n) => n.textContent)).toEqual([
      "3",
      "4",
      "5",
    ]);
  });

  test("without barValueLabels no value labels are drawn", async () => {
    renderDashboard(chartScreen("stacked-bars"), barHandler);
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    expect(screen.queryAllByTestId("chart-bar-value")).toHaveLength(0);
  });

  test("highlightLast dims every bar but the last", async () => {
    renderDashboard(chartScreen("stacked-bars", { highlightLast: true }), barHandler);
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    const bars = screen
      .getAllByTestId("chart-bar-segment-ok")
      .map((n) => (n.parentElement as HTMLElement).style.opacity);
    expect(bars).toEqual(["0.4", "0.4", ""]);
  });

  test("hideLegend removes the legend line with series label and total", async () => {
    renderDashboard(chartScreen("stacked-bars"), barHandler);
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    within(screen.getByTestId("chart-legend-ok")).getByText("Delivered");
    within(screen.getByTestId("chart-legend-ok")).getByText("12");
    document.body.innerHTML = "";
    renderDashboard(chartScreen("stacked-bars", { hideLegend: true }), barHandler);
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    expect(screen.queryByTestId("chart-legend-ok")).toBeNull();
    expect(screen.queryByText("Delivered")).toBeNull();
    expect(screen.queryByText("12")).toBeNull();
  });

  test("segment-bars singleTone colors every segment alike, also in rows layout", async () => {
    const rows = {
      rows: [
        {
          key: "a",
          label: "A",
          value: 5,
          segments: [{ key: "iron", label: "Iron", value: 5 }],
        },
        {
          key: "b",
          label: "B",
          value: 3,
          segments: [{ key: "copper", label: "Copper", value: 3 }],
        },
      ],
    };
    const colors = async (extra: Record<string, unknown>) => {
      document.body.innerHTML = "";
      renderDashboard(chartScreen("segment-bars", extra), {
        "demo:query:metric:chart": () => ok(rows),
      });
      await waitFor(() => screen.getByTestId("chart-row-a"));
      return ["a", "b"].map(
        (k) =>
          (screen.getByTestId(`chart-row-${k}`).querySelector("[title]") as HTMLElement).style
            .backgroundColor,
      );
    };
    const [first, second] = await colors({ singleTone: "negative", layout: "rows" });
    expect(first).not.toBe("");
    expect(first).toBe(second);
    const [plainFirst, plainSecond] = await colors({});
    expect(plainFirst).not.toBe(plainSecond);
  });

  test("hideYAxis removes the y axis labels", async () => {
    renderDashboard(chartScreen("stacked-bars", { hideYAxis: true }), barHandler);
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    expect(screen.queryByTestId("chart-y-ticks")).toBeNull();
    document.body.innerHTML = "";
    renderDashboard(chartScreen("stacked-bars"), barHandler);
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    expect(screen.queryByTestId("chart-y-ticks")).not.toBeNull();
  });

  test("lastBucketLabel date shows the date instead of Today", async () => {
    renderDashboard(chartScreen("stacked-bars", { lastBucketLabel: "date" }), barHandler);
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    expect(screen.queryByText("Today")).toBeNull();
  });

  test("labelEveryBucket labels every bucket", async () => {
    const many = {
      windowStartMs: day1,
      windowEndMs: day1 + 30 * DAY,
      series: [
        {
          key: "ok",
          label: "Delivered",
          points: Array.from({ length: 30 }, (_, i) => ({ atMs: day1 + i * DAY, value: i + 1 })),
        },
      ],
    };
    const labels = async (extra: Record<string, unknown>) => {
      document.body.innerHTML = "";
      renderDashboard(chartScreen("stacked-bars", extra), {
        "demo:query:metric:chart": () => ok(many),
      });
      await waitFor(() => screen.getByTestId("dashboard-chart-main"));
      return screen
        .getAllByTestId("chart-bar-segment-ok")
        .map((n) => n.parentElement?.parentElement?.parentElement?.lastElementChild?.textContent)
        .filter((t) => t !== "").length;
    };
    expect(await labels({ labelEveryBucket: true })).toBe(30);
    expect(await labels({})).toBeLessThan(30);
  });

  const segmentRows = {
    rows: [
      {
        key: "mail",
        label: "E-Mail",
        value: 10,
        segments: [{ key: "sent", label: "Sent", value: 10 }],
      },
    ],
  };

  test("segment-bars layout rows and hideLegend", async () => {
    renderDashboard(chartScreen("segment-bars", { layout: "rows", hideLegend: true }), {
      "demo:query:metric:chart": () => ok(segmentRows),
    });
    await waitFor(() => screen.getByTestId("chart-row-mail"));
    expect(screen.getByTestId("chart-row-mail").getAttribute("data-layout")).toBe("rows");
    expect(screen.queryByTestId("chart-legend-sent")).toBeNull();
  });

  test("segment-bars default layout is stacked with legend", async () => {
    renderDashboard(chartScreen("segment-bars"), {
      "demo:query:metric:chart": () => ok(segmentRows),
    });
    await waitFor(() => screen.getByTestId("chart-row-mail"));
    expect(screen.getByTestId("chart-row-mail").getAttribute("data-layout")).toBe("stacked");
    screen.getByTestId("chart-legend-sent");
  });

  test("headerSubtitle loads its query and shows the field under the title", async () => {
    const { calls } = renderDashboard(
      {
        id: "hs",
        type: "dashboard",
        headerSubtitle: { query: "demo:query:header", field: "text" },
        panels: [],
      } as unknown as DashboardScreenDefinition,
      { "demo:query:header": () => ok({ text: "Accepted quotes · November 2026" }) },
    );
    const node = await screen.findByTestId("dashboard-hs-header-subtitle");
    expect(node.textContent).toBe("Accepted quotes · November 2026");
    expect(calls.some((c) => c.type === "demo:query:header")).toBe(true);
  });
});

describe("dashboard design options, round 3", () => {
  test("showTitle draws the screen title as page heading with the header subtitle below it", async () => {
    const dashboard = (showTitle: boolean) =>
      ({
        id: "ttl",
        type: "dashboard",
        ...(showTitle && { showTitle: true }),
        headerSubtitle: { query: "demo:query:header", field: "text" },
        panels: [
          {
            kind: "stat",
            id: "k",
            label: "demo:k",
            query: "demo:query:kpi:a",
            valueField: "v",
          },
        ],
      }) as DashboardScreenDefinition;
    const handlers = {
      "demo:query:header": () => ok({ text: "Subtitle text" }),
      "demo:query:kpi:a": () => ok({ v: "7" }),
    };
    const options = { locale: "en", translations: { en: { "screen:ttl.title": "Overview" } } };
    renderDashboard(dashboard(true), handlers, options);
    const heading = await screen.findByText("Overview");
    const subtitle = await screen.findByTestId("dashboard-ttl-header-subtitle");
    expect(
      heading.compareDocumentPosition(subtitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    document.body.innerHTML = "";
    renderDashboard(dashboard(false), handlers, options);
    await screen.findByTestId("dashboard-ttl-header-subtitle");
    expect(screen.queryByText("Overview")).toBeNull();
  });

  test("showTitle below the app shell draws the heading in the body, without a record", async () => {
    renderDashboard(
      {
        id: "overview",
        type: "dashboard",
        layout: "main-side",
        showTitle: true,
        headerSubtitle: { query: "demo:query:header", field: "text" },
        panels: [
          { kind: "stat", id: "k", label: "demo:k", query: "demo:query:kpi:a", valueField: "v" },
        ],
      } as DashboardScreenDefinition,
      {
        "demo:query:header": () => ok({ text: "Subtitle text" }),
        "demo:query:kpi:a": () => ok({ v: "7" }),
      },
      { locale: "en", shell: true, translations: { en: { "screen:overview.title": "Overview" } } },
    );
    const heading = await screen.findByTestId("dashboard-overview-title");
    expect(heading.textContent).toBe("Overview");
    await screen.findByTestId("dashboard-overview-header-subtitle");
  });

  test.each([
    [false, true],
    [true, false],
  ])("framed %p: the stat card sub line sits under the value: %p", async (framed, below) => {
    renderDashboard(
      {
        id: "s",
        type: "dashboard",
        panels: [
          {
            kind: "stat-group",
            id: "g",
            layout: "cards",
            ...(!framed && { framed: false as const }),
            stats: [
              {
                kind: "stat",
                id: "kpi",
                label: "demo:kpi",
                query: "demo:query:kpi:a",
                valueField: "v",
                subField: "sub",
              },
            ],
          },
        ],
      },
      { "demo:query:kpi:a": () => ok({ v: "15", sub: "3 vs. October" }) },
    );
    const sub = await screen.findByText("3 vs. October");
    const value = screen.getByText("15");
    expect(sub.parentElement === value.parentElement).toBe(!below);
  });

  const rowsPanel = (extra: Record<string, unknown> = {}) =>
    ({
      id: "rows",
      type: "dashboard",
      panels: [
        {
          kind: "chart",
          id: "main",
          label: "demo:chart",
          chart: "segment-bars",
          query: "demo:query:metric:chart",
          layout: "rows",
          ...extra,
        },
      ],
    }) as DashboardScreenDefinition;

  test("segment-bars rows: label column grows up to 40 percent, regular weight, shared across rows", async () => {
    renderDashboard(rowsPanel(), {
      "demo:query:metric:chart": () =>
        ok({
          rows: [
            {
              key: "a",
              label: "Stainless steel",
              value: 5,
              segments: [{ key: "x", label: "X", value: 5 }],
            },
          ],
        }),
    });
    const label = await screen.findByText("Stainless steel");
    const list = label.closest("ul") as HTMLElement;
    expect(list.className).toContain("fit-content(40%)");
    expect(label.className).not.toContain("font-medium");
    expect(label.className).toContain("truncate");
    expect(screen.getByTestId("chart-row-a").className).toContain("grid-cols-subgrid");
  });

  test("list panel: number and currency columns are right-aligned in header and cell, text columns are not", async () => {
    renderDashboard(
      {
        id: "lists",
        type: "dashboard",
        panels: [
          {
            kind: "list",
            id: "jobs",
            label: "demo:jobs",
            query: "demo:query:jobs:list",
            columns: [
              { field: "name", label: "Name" },
              {
                field: "amount",
                label: "Amount",
                renderer: { format: "currency", currency: "EUR", locale: "en-US" },
              },
              { field: "qty", label: "Qty", valueType: "number" },
            ],
          },
        ],
      },
      {
        "demo:query:jobs:list": () =>
          ok({ rows: [{ id: "j1", name: "Nightly", amount: 4200, qty: 3 }], nextCursor: null }),
      },
    );
    const nameCell = (await screen.findByText("Nightly")).closest("td") as HTMLElement;
    const amountCell = screen.getByText("€42.00").closest("td") as HTMLElement;
    expect(amountCell.className).toContain("text-right");
    expect(nameCell.className).not.toContain("text-right");
    for (const label of ["Amount", "Qty"]) {
      expect(screen.getByText(label).closest("th")?.className).toContain("text-right");
    }
    expect(screen.getByText("Name").closest("th")?.className).not.toContain("text-right");
    expect(amountCell.className).toContain("whitespace-nowrap");
    expect(nameCell.className).not.toContain("whitespace-nowrap");
  });

  test("barValueLabels use a compact number without currency symbol, even with a currency valueFormat", async () => {
    renderDashboard(
      chartScreen("stacked-bars", {
        barValueLabels: true,
        valueFormat: { kind: "currency", currency: "BRL" },
      }),
      {
        "demo:query:metric:chart": () =>
          ok({
            windowStartMs: day1,
            windowEndMs,
            series: [{ key: "ok", label: "Revenue", points: dayPoints([3_000_000, 4_550_000]) }],
          }),
      },
      { locale: "en" },
    );
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    expect(screen.getAllByTestId("chart-bar-value").map((n) => n.textContent)).toEqual([
      "30K",
      "45.5K",
    ]);
  });

  test("sideWidth wide gives the side column two fifths", async () => {
    const dashboard = (extra: Record<string, unknown>) =>
      ({
        id: "ms",
        type: "dashboard",
        layout: "main-side",
        ...extra,
        panels: [
          { kind: "stat", id: "a", label: "demo:a", query: "demo:query:kpi:a", valueField: "v" },
          {
            kind: "stat",
            id: "b",
            label: "demo:b",
            query: "demo:query:kpi:a",
            valueField: "v",
            column: "side",
          },
        ],
      }) as DashboardScreenDefinition;
    const handlers = { "demo:query:kpi:a": () => ok({ v: "7" }) };
    renderDashboard(dashboard({ sideWidth: "wide" }), handlers);
    await screen.findByTestId("dashboard-columns");
    expect(screen.getByTestId("dashboard-columns").className).toContain("lg:grid-cols-5");
    expect(screen.getByTestId("dashboard-column-main").className).toContain("lg:col-span-3");
    expect(screen.getByTestId("dashboard-column-side").className).toContain("lg:col-span-2");
    document.body.innerHTML = "";
    renderDashboard(dashboard({}), handlers);
    await screen.findByTestId("dashboard-columns");
    expect(screen.getByTestId("dashboard-columns").className).toContain("lg:grid-cols-3");
    expect(screen.getByTestId("dashboard-column-side").className).not.toContain("col-span");
  });
});
