import { afterEach, describe, expect, test } from "bun:test";
import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  chartScreen,
  DAY,
  day1,
  dayPoints,
  ok,
  renderDashboard,
  windowEndMs,
} from "./_dashboard-test-helpers.tsx";
import { screen, waitFor, within } from "./test-utils.tsx";

afterEach(() => {
  window.history.replaceState(null, "", "/");
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
    const panel = screen.getByText("7").closest("section");
    expect(panel).not.toBeNull();
    if (panel === null) return;
    expect(panel.querySelector("h2")).toBeNull();
  });

  test("barValueLabels draws the bucket total above each bar", async () => {
    renderDashboard(
      chartScreen("stacked-bars", { barValueLabels: true, hideYAxis: true }),
      barHandler,
    );
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    for (const total of ["3", "4", "5"]) screen.getByText(total);
  });

  test("without barValueLabels no value labels are drawn", async () => {
    renderDashboard(chartScreen("stacked-bars", { hideYAxis: true }), barHandler);
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    for (const total of ["3", "4", "5"]) expect(screen.queryByText(total)).toBeNull();
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
    expect(screen.queryByText("0")).toBeNull();
    document.body.innerHTML = "";
    renderDashboard(chartScreen("stacked-bars"), barHandler);
    await waitFor(() => screen.getByTestId("dashboard-chart-main"));
    expect(screen.queryByText("0")).not.toBeNull();
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
    screen.getByText("30K");
    screen.getByText("45.5K");
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
