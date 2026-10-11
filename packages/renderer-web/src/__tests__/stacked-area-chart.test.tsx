import { describe, expect, test } from "bun:test";
import { StackedAreaChart } from "../widgets/charts.js";
import { render, screen, within } from "./test-utils.js";

const jan = (year: number): number => Date.UTC(year, 0, 1);
const points = (values: readonly number[]) =>
  values.map((value, i) => ({ atMs: jan(2026 + i), value }));

function renderChart(
  extra: Partial<Parameters<typeof StackedAreaChart>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <StackedAreaChart
      series={[{ key: "a", label: "Plan", points: points([1000, 2000, 3000, 4000, 5000]) }]}
      windowStartMs={jan(2026)}
      windowEndMs={jan(2030)}
      ariaLabel="Plan chart"
      todayLabel="Today"
      formatBucketLabel={(atMs) => `d${new Date(atMs).getUTCFullYear()}`}
      formatValue={(value) => `full:${value}`}
      testId="chart"
      {...extra}
    />,
  );
}

describe("StackedAreaChart", () => {
  test("y ticks use formatAxisValue while legend totals keep formatValue", () => {
    renderChart({ formatAxisValue: (value) => `axis:${value}` });
    expect(screen.getAllByText(/^axis:/).length).toBe(3);
    expect(screen.queryByText(/^full:0$/)).toBeNull();
    expect(within(screen.getByTestId("chart-legend-a")).getByText("full:15000")).toBeTruthy();
  });

  test("y ticks fall back to formatValue without formatAxisValue", () => {
    renderChart();
    expect(screen.getByText("full:0")).toBeTruthy();
  });

  test("draws a dashed grid line per y tick", () => {
    renderChart();
    expect(screen.getAllByTestId("chart-grid-line")).toHaveLength(3);
  });

  test("the x axis carries formatted inner ticks plus both edge labels", () => {
    renderChart({ dateFormat: "month" });
    const labels = screen.getAllByTestId("chart-axis-tick").map((tick) => tick.textContent);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => /^d20\d\d$/.test(label ?? ""))).toBe(true);
    expect(screen.getAllByText("d2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("d2030").length).toBeGreaterThan(0);
  });

  test("markerLabels groups markers sharing a timestamp into one label", () => {
    renderChart({
      markerLabels: true,
      markers: [
        { atMs: jan(2028), label: "A", color: "red" },
        { atMs: jan(2028), label: "B" },
        { atMs: jan(2029), label: "C" },
      ],
    });
    const labels = screen.getAllByTestId("chart-marker-label");
    expect(labels.map((label) => label.textContent)).toEqual(["A, B", "C"]);
    expect(labels[0]?.style.color).toBe("red");
  });

  test("no marker labels without the prop, pins stay", () => {
    renderChart({ markers: [{ atMs: jan(2028), label: "A" }] });
    expect(screen.queryByTestId("chart-marker-label")).toBeNull();
    expect(screen.getAllByTestId("chart-marker-pin")).toHaveLength(1);
  });

  test("markerLabels with markerLegend legend adds numbered pins and a list hidden from @2xl", () => {
    renderChart({
      markerLabels: true,
      markerLegend: "legend",
      markers: [
        { atMs: jan(2028), label: "Loan A paid", color: "red", legendLabel: "Payoff" },
        { atMs: jan(2029), label: "Loan B paid", color: "red", legendLabel: "Payoff" },
      ],
    });
    const items = screen.getAllByTestId("chart-marker-item");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Loan A paid"),
      expect.stringContaining("Loan B paid"),
    ]);
    expect(items[0]?.parentElement?.className).toContain("@2xl:hidden");
    expect(screen.getAllByTestId("chart-marker-pin").map((pin) => pin.textContent)).toEqual([
      "1",
      "2",
    ]);
    expect(screen.getByTestId("chart-legend-marker-Payoff-red")).toBeTruthy();
  });
});
