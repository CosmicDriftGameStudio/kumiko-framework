import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import {
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
} from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { WebDashboardBody } from "../app/dashboard-body.js";
import { useBrowserNavApi } from "../app/nav.js";
import { createMockDispatcher, fireEvent, render, screen, waitFor, within } from "./test-utils.js";

type Handler = (payload: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;

const FEATURE = "demo";

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

function renderDashboard(
  dashboard: DashboardScreenDefinition,
  handlers: Readonly<Record<string, Handler>>,
  options: {
    readonly locale?: string;
    readonly translations?: TranslationsByLocale;
    readonly extensionSections?: Readonly<
      Record<string, (props: ExtensionSectionProps) => ReactNode>
    >;
  } = {},
): { readonly calls: { readonly type: string; readonly payload: Record<string, unknown> }[] } {
  const calls: { readonly type: string; readonly payload: Record<string, unknown> }[] = [];
  const dispatcher = createMockDispatcher({
    query: (async (type: string, payload: Record<string, unknown> = {}) => {
      calls.push({ type, payload });
      const handler = handlers[type];
      if (handler === undefined) return { isSuccess: true, data: {} };
      const result = await handler(payload);
      return result;
    }) as unknown as Dispatcher["query"],
  });
  const schema: FeatureSchema = { featureName: FEATURE, entities: {}, screens: [dashboard] };
  const screenNode = (
    <BrowserNav>
      <DispatcherProvider dispatcher={dispatcher}>
        <ExtensionSectionsProvider value={options.extensionSections ?? {}}>
          <DashboardBodyProvider value={WebDashboardBody}>
            <KumikoScreen schema={schema} qn={`${FEATURE}:screen:${dashboard.id}`} />
          </DashboardBodyProvider>
        </ExtensionSectionsProvider>
      </DispatcherProvider>
    </BrowserNav>
  );
  render(
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

const ok = (data: unknown) => ({ isSuccess: true, data });
const failure = {
  isSuccess: false,
  error: { code: "internal", message: "kaputt", i18nKey: "errors.internal" },
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
    await waitFor(() => expect(screen.getByTestId("dashboard-chart-main")).toBeTruthy());
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("demo:chart-subtitle")).toBeTruthy();
    expect(within(screen.getByTestId("chart-legend-ok")).getByText("12")).toBeTruthy();
    expect(within(screen.getByTestId("chart-legend-fail")).getByText("3")).toBeTruthy();
    expect(screen.getAllByTestId("chart-bar-segment-ok")).toHaveLength(3);
    // zero-value segments draw nothing
    expect(screen.getAllByTestId("chart-bar-segment-fail")).toHaveLength(2);
  });

  test("stacked-bars: points without series render as one plain bar series", async () => {
    renderDashboard(chartScreen("stacked-bars"), {
      "demo:query:metric:chart": () =>
        ok({ windowStartMs: day1, windowEndMs, points: dayPoints([2, 6]), series: [] }),
    });
    await waitFor(() => expect(screen.getByTestId("chart-legend-value")).toBeTruthy());
    expect(within(screen.getByTestId("chart-legend-value")).getByText("8")).toBeTruthy();
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
    await waitFor(() => expect(screen.getByTestId("chart-row-mail")).toBeTruthy());
    expect(within(screen.getByTestId("chart-row-mail")).getByText("10")).toBeTruthy();
    expect(within(screen.getByTestId("chart-row-sms")).getByText("4")).toBeTruthy();
    expect(within(screen.getByTestId("chart-legend-sent")).getByText("11")).toBeTruthy();
    expect(within(screen.getByTestId("chart-legend-bounced")).getByText("3")).toBeTruthy();
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
    await waitFor(() => expect(screen.getByTestId("chart-forecast-region")).toBeTruthy());
    expect(screen.getByTestId("chart-today-line")).toBeTruthy();
    expect(within(screen.getByTestId("chart-today-label")).getByText("Today")).toBeTruthy();
    const items = screen.getAllByTestId("chart-marker-item");
    expect(items.map((li) => li.textContent?.slice(0, 1))).toEqual(["1", "2"]);
    expect(items[0]?.textContent).toContain("First event");
    expect(screen.getAllByTestId("chart-marker-pin")).toHaveLength(2);
  });

  test("stacked-area without todayMs draws no forecast region or today line", async () => {
    renderDashboard(chartScreen("stacked-area"), {
      "demo:query:metric:chart": () => ok(areaPayload),
    });
    await waitFor(() => expect(screen.getByTestId("dashboard-chart-main")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByTestId("chart-marker-item")).toBeTruthy());
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
    expect(screen.getByText("demo:broken")).toBeTruthy();
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
        ],
      },
      {},
    );
    const cell = (id: string) =>
      screen.getByTestId(`dashboard-panel-${id}`).parentElement?.className ?? "";
    await waitFor(() => expect(cell("right")).toContain("lg:col-span-2"));
    expect(cell("left")).toContain("lg:col-span-4");
    expect(cell("plain")).toContain("lg:col-span-4");
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
    await waitFor(() => expect(screen.getByText("demo:jobs-empty")).toBeTruthy());
    expect(screen.getByText("demo:jobs-empty-hint")).toBeTruthy();
    expect(screen.getByText("No entries.")).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText("demo:broken could not be loaded")).toBeTruthy());
    expect(screen.getByText("The other panels are not affected.")).toBeTruthy();
    expect(screen.getByText("Still here")).toBeTruthy();

    const before = calls.filter((c) => c.type === "demo:query:feed:broken").length;
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Recovered")).toBeTruthy());
    expect(calls.filter((c) => c.type === "demo:query:feed:broken").length).toBeGreaterThan(before);
    expect(screen.queryByText("The other panels are not affected.")).toBeNull();
  });

  test("a retry that loads a panel moves the updated-at stamp past the initial render time", async () => {
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
      await waitFor(() => expect(screen.getByText("demo:broken could not be loaded")).toBeTruthy());
      const stampTestId = `dashboard-${twoPanels.id}-updated-at`;
      const stampAtRender = screen.getByTestId(stampTestId).textContent;

      clock.mockReturnValue(Date.UTC(2026, 0, 1, 14, 30, 0));
      await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(screen.getByText("Recovered")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByText("scoped-7d")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("global-7d")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByText("scoped-7d")).toBeTruthy());
    const group = screen.getByTestId("dashboard-time-range-range");
    expect(group.getAttribute("role")).toBe("group");
    expect(within(group).getByText("demo:range-7d").getAttribute("aria-pressed")).toBe("true");

    await userEvent.setup().click(within(group).getByText("demo:range-30d"));
    await waitFor(() => expect(screen.getByText("scoped-30d")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("global-30d")).toBeTruthy());
    expect(window.location.search).toContain("range=30d");
    expect(within(group).getByText("demo:range-30d").getAttribute("aria-pressed")).toBe("true");
  });

  test("an unknown range in the URL falls back to the default", async () => {
    window.history.replaceState(null, "", "/ranged?range=bogus");
    renderDashboard(rangeScreen, kpiHandlers);
    await waitFor(() => expect(screen.getByText("scoped-7d")).toBeTruthy());
  });

  test("scope badge, notice and the 'as of' stamp render in the header", async () => {
    renderDashboard(rangeScreen, kpiHandlers);
    await waitFor(() => expect(screen.getByTestId("dashboard-ranged-scope")).toBeTruthy());
    expect(screen.getByTestId("dashboard-ranged-scope").textContent).toContain("demo:scope-badge");
    expect(screen.getByTestId("dashboard-ranged-scope-notice").textContent).toContain(
      "demo:scope-notice",
    );
    expect(screen.getByTestId("dashboard-ranged-updated-at").textContent).toMatch(/^As of /);
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
    await waitFor(() => expect(screen.getByText("3.140")).toBeTruthy());
    const card = screen.getByTestId("dashboard-panel-volume");
    expect(card.querySelector("svg path")).not.toBeNull();
    expect(card.querySelector(".text-status-bad")).not.toBeNull();
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
    await waitFor(() => expect(screen.getByText("2.5")).toBeTruthy());
    expect(screen.getByText("99,98 %")).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText("1,200")).toBeTruthy());
    const strip = screen.getByTestId("dashboard-panel-kpis");
    expect(within(strip).getByText("demo:sent")).toBeTruthy();
    expect(within(strip).getByText("7")).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText("Nightly")).toBeTruthy());
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText("50%")).toBeTruthy();
    const badge = screen.getByText("Failed");
    expect(badge.className).toContain("bg-status-bad-surface");
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
    await waitFor(() => expect(screen.getByText("Nightly")).toBeTruthy());
    expect(screen.queryByText("2026-10-01T12:34:56.789Z")).toBeNull();
    expect(screen.getByText(/Oct 1, 2026/)).toBeTruthy();
    expect(screen.queryByText("not-a-date")).toBeNull();
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
    await waitFor(() => expect(screen.getByText("plain text")).toBeTruthy());
    expect(screen.queryByText("kumiko.actions.create")).toBeNull();
    expect(screen.getByText("sessions:job:cleanup")).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText("99 %")).toBeTruthy());
    expect(screen.getByText("4 open")).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText("1 year 3 months")).toBeTruthy());
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
    await waitFor(() =>
      expect(screen.getByText("Price €1,234.56 since Jan 15, 2026")).toBeTruthy(),
    );
    expect(screen.getByText("1 year 3 months")).toBeTruthy();
    expect(screen.getByText("Plain row")).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText("Task A")).toBeTruthy());
    expect(screen.getByText("1 year 3 months")).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText("—")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByTestId("chart-marker-item")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByTestId("chart-marker-item")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByText("€1,234.56")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByTestId("chart-legend-ok")).toBeTruthy());
    expect(within(screen.getByTestId("chart-legend-ok")).getByText("€1,000")).toBeTruthy();
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
    await waitFor(() => expect(screen.getByTestId("chart-scroll-container")).toBeTruthy());
    const content = screen.getByTestId("chart-scroll-content");
    expect(content.style.minWidth).toBe("100%");
    expect(Number.parseInt(content.style.width, 10)).toBeGreaterThan(300);
    expect(screen.getByTestId("chart-today-line")).toBeTruthy();
  });

  test("a stacked-area chart without scrollable has no scroll container", async () => {
    renderDashboard(chartScreen("stacked-area"), {
      "demo:query:metric:chart": () => ok(wideArea),
    });
    await waitFor(() => expect(screen.getByTestId("dashboard-chart-main")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByText("always-value")).toBeTruthy());
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
      await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
    }
  });

  test("a failing gate query shows the error in the panel's cell instead of dropping it", async () => {
    renderDashboard(gatedScreen, {
      ...panelHandlers,
      "demo:query:portfolio:state": () => failure,
    });
    await waitFor(() =>
      expect(within(screen.getByTestId("dashboard-panel-events")).getByRole("alert")).toBeTruthy(),
    );
    expect(screen.queryByText("event-row")).toBeNull();
  });
});

describe("dashboard stat-group subtitle, strip icons and progress sub line", () => {
  function KpiIcon(): ReactNode {
    return <svg data-testid="kpi-icon" aria-hidden="true" />;
  }

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
    await waitFor(() => expect(screen.getByText("120.000 €")).toBeTruthy());
    expect(
      within(screen.getByTestId("dashboard-panel-net-worth")).getByText("demo:net-worth-sub"),
    ).toBeTruthy();
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
    await waitFor(() => expect(cell("narrow")).toContain("lg:col-span-2"));
    expect(cell("wide")).toContain("lg:col-span-4");
  });

  test("a labeled stat-group sizes its columns to its values", async () => {
    renderDashboard(
      {
        id: "group-cols",
        type: "dashboard",
        panels: [labeledGroup("one", 1), labeledGroup("two", 2), labeledGroup("three", 3)],
      },
      { "demo:query:kpi:any": () => ok({ value: "1" }) },
    );
    const grid = (id: string) =>
      screen.getByTestId(`dashboard-panel-${id}`).querySelector("section.grid")?.className ?? "";
    await waitFor(() => expect(grid("two")).toContain("sm:grid-cols-2"));
    expect(grid("two")).not.toContain("sm:grid-cols-3");
    expect(grid("three")).toContain("sm:grid-cols-3");
    expect(grid("one")).not.toContain("sm:grid-cols");
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
    await waitFor(() => expect(screen.getByTestId("kpi-icon")).toBeTruthy());
    const chip = screen.getByTestId("kpi-icon").parentElement;
    expect(chip?.getAttribute("style") ?? "").toContain("#123456");
    expect(within(screen.getByTestId("dashboard-panel-debt")).getByText("demo:debt")).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText("40 % paid off")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByTestId("chart-line-rent")).toBeTruthy());
    expect(screen.getByTestId("chart-line-rent").getAttribute("stroke")).toBe("var(--color-rent)");
    expect(screen.getByTestId("chart-line-rent-min").getAttribute("stroke-dasharray")).toBe("6 4");
    expect(screen.getByTestId("chart-legend-rent").textContent).toBe("demo:rent");
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
    await waitFor(() => expect(screen.getByTestId("chart-line-rent")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByTestId("dashboard-chart-main-brush")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByTestId("dashboard-chart-main-brush")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByTestId("chart-line-rent")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByTestId("chart-line-rent")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByTestId("chart-line-rent")).toBeTruthy());
    expect(screen.getByTestId("dashboard-chart-main").textContent).not.toContain("2027");
  });

  test("dateFormat month adds the year to the axis labels", async () => {
    renderDashboard(chartScreen("stacked-area", { ranges: yearRanges, dateFormat: "month" }), {
      "demo:query:metric:chart": () => ok(planPayload),
    });
    await waitFor(() => expect(screen.getByTestId("chart-line-rent")).toBeTruthy());
    expect(screen.getByTestId("dashboard-chart-main").textContent).toContain("2027");
  });
});
