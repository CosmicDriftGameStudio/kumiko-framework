import { describe, expect, test } from "bun:test";
import { validateBoot } from "../boot-validator.ts";
import type { DashboardScreenDefinition } from "../types/screen.ts";
import { dashboardFeature, STAT_PANEL } from "./dashboard-feature-fixture.ts";

describe("dashboard design options validation", () => {
  const chart = (extra: Record<string, unknown>) =>
    ({
      kind: "chart",
      id: "trend",
      label: "demo:dashboard:panel:latest",
      chart: "stacked-bars",
      query: "demo:query:incident:latest",
      ...extra,
    }) as DashboardScreenDefinition["panels"][number];

  test("accepts bar options on stacked-bars and segment-bars options on segment-bars", () => {
    const bars = chart({
      barValueLabels: true,
      highlightLast: true,
      hideYAxis: true,
      hideLegend: true,
      labelEveryBucket: true,
      lastBucketLabel: "date",
    });
    const segments = chart({ chart: "segment-bars", layout: "rows", hideLegend: true });
    expect(() => validateBoot([dashboardFeature([bars])])).not.toThrow();
    expect(() => validateBoot([dashboardFeature([segments])])).not.toThrow();
  });

  test("rejects bar-only options on another chart kind", () => {
    expect(() =>
      validateBoot([dashboardFeature([chart({ chart: "timeseries", barValueLabels: true })])]),
    ).toThrow(/barValueLabels/);
    expect(() => validateBoot([dashboardFeature([chart({ layout: "rows" })])])).toThrow(/layout/);
  });

  test("rejects invalid bar option values", () => {
    expect(() =>
      validateBoot([dashboardFeature([chart({ lastBucketLabel: "yesterday" })])]),
    ).toThrow(/lastBucketLabel/);
    expect(() => validateBoot([dashboardFeature([chart({ hideYAxis: "yes" })])])).toThrow(
      /hideYAxis/,
    );
  });

  test("framed:false needs layout cards and no label", () => {
    const group = (extra: Record<string, unknown>) =>
      ({
        kind: "stat-group",
        id: "totals",
        framed: false,
        stats: [STAT_PANEL],
        ...extra,
      }) as DashboardScreenDefinition["panels"][number];
    expect(() => validateBoot([dashboardFeature([group({ layout: "cards" })])])).not.toThrow();
    expect(() => validateBoot([dashboardFeature([group({})])])).toThrow(/framed: false/);
    expect(() =>
      validateBoot([
        dashboardFeature([group({ layout: "cards", label: "demo:dashboard:panel:latest" })]),
      ]),
    ).toThrow(/framed: false/);
  });

  test("headerSubtitle needs query and field, and the query must exist", () => {
    const withSubtitle = (headerSubtitle: { query: string; field: string }) =>
      dashboardFeature([STAT_PANEL], undefined, { headerSubtitle });
    expect(() =>
      validateBoot([withSubtitle({ query: "demo:query:incident:open-count", field: "count" })]),
    ).not.toThrow();
    expect(() =>
      validateBoot([withSubtitle({ query: "demo:query:incident:open-count", field: "" })]),
    ).toThrow(/headerSubtitle/);
    expect(() =>
      validateBoot([withSubtitle({ query: "demo:query:incident:nope", field: "count" })]),
    ).toThrow(/headerSubtitle/);
  });
});

describe("segment-bars singleTone validation", () => {
  const segments = (extra: Record<string, unknown>) =>
    ({
      kind: "chart",
      id: "mix",
      label: "demo:dashboard:panel:latest",
      chart: "segment-bars",
      query: "demo:query:incident:latest",
      ...extra,
    }) as DashboardScreenDefinition["panels"][number];
  const boot = (extra: Record<string, unknown>) => () =>
    validateBoot([dashboardFeature([segments(extra)])]);

  test("accepts singleTone alone on segment-bars", () => {
    expect(boot({ singleTone: "active" })).not.toThrow();
  });

  test("rejects singleTone with seriesTones or seriesColors", () => {
    expect(boot({ singleTone: "active", seriesTones: { a: "negative" } })).toThrow(/singleTone/);
    expect(boot({ singleTone: "active", seriesColors: { a: "red" } })).toThrow(/singleTone/);
  });

  test("rejects singleTone on another chart kind and an unknown tone", () => {
    expect(boot({ chart: "stacked-bars", singleTone: "active" })).toThrow(/singleTone/);
    expect(boot({ singleTone: "purple" })).toThrow(/singleTone/);
  });
});

describe("dashboard sideWidth validation", () => {
  test("sideWidth wide needs layout main-side", () => {
    const withExtra = (extra: Record<string, unknown>) =>
      dashboardFeature([STAT_PANEL], undefined, extra as never);
    expect(() =>
      validateBoot([withExtra({ layout: "main-side", sideWidth: "wide" })]),
    ).not.toThrow();
    expect(() => validateBoot([withExtra({ sideWidth: "wide" })])).toThrow(/sideWidth/);
    expect(() => validateBoot([withExtra({ layout: "main-side", sideWidth: "huge" })])).toThrow(
      /sideWidth/,
    );
  });
});
