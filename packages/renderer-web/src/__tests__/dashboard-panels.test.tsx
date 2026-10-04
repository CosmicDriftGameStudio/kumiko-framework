import { afterEach, describe, expect, test } from "bun:test";
import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import {
  createStaticLocaleResolver,
  DashboardBodyProvider,
  DispatcherProvider,
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
import { createMockDispatcher, render, screen, waitFor, within } from "./test-utils.js";

type Handler = (payload: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;

const FEATURE = "demo";

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

function renderDashboard(
  dashboard: DashboardScreenDefinition,
  handlers: Readonly<Record<string, Handler>>,
  options: { readonly locale?: string; readonly translations?: TranslationsByLocale } = {},
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
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={schema} qn={`${FEATURE}:screen:${dashboard.id}`} />
        </DashboardBodyProvider>
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
