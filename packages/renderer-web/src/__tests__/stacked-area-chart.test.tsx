import { describe, expect, test } from "bun:test";
import { StackedAreaChart } from "../widgets/charts.js";
import { fireEvent, render, screen, within } from "./test-utils.js";

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

  describe("tooltip", () => {
    function plotOverlay(): HTMLElement {
      const overlay = screen.getByTestId("chart-tooltip-overlay");
      overlay.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 400, height: 100, right: 400, bottom: 100 }) as DOMRect;
      return overlay;
    }
    function tap(overlay: HTMLElement, clientX: number): void {
      fireEvent.pointerDown(overlay, { pointerType: "touch", clientX, clientY: 50 });
      fireEvent.pointerUp(overlay, { pointerType: "touch", clientX, clientY: 50 });
    }
    const lineSeries = {
      key: "l",
      label: "Restschuld",
      dashed: true,
      points: points([900, 800, 700, 600, 500]),
    };

    test("mouse hover shows the nearest bucket with compact values and lines, leaving hides it", () => {
      renderChart({ lines: [lineSeries], formatAxisValue: (value) => `axis:${value}` });
      const overlay = plotOverlay();
      expect(screen.queryByTestId("chart-tooltip")).toBeNull();
      fireEvent.pointerMove(overlay, { pointerType: "mouse", clientX: 200 });
      const card = screen.getByTestId("chart-tooltip");
      expect(card.textContent).toContain("d2028");
      expect(within(card).getByText("axis:3000")).toBeTruthy();
      expect(within(card).getByText("Restschuld")).toBeTruthy();
      expect(within(card).getByText("axis:700")).toBeTruthy();
      fireEvent.pointerLeave(overlay, { pointerType: "mouse" });
      expect(screen.queryByTestId("chart-tooltip")).toBeNull();
    });

    test("the card flips to the left of the hover line past the middle", () => {
      renderChart();
      const overlay = plotOverlay();
      fireEvent.pointerMove(overlay, { pointerType: "mouse", clientX: 100 });
      expect(screen.getByTestId("chart-tooltip").dataset["side"]).toBe("right");
      fireEvent.pointerMove(overlay, { pointerType: "mouse", clientX: 380 });
      expect(screen.getByTestId("chart-tooltip").dataset["side"]).toBe("left");
    });

    test("touch taps open the card, a second tap on the same bucket closes it", () => {
      renderChart();
      const overlay = plotOverlay();
      tap(overlay, 200);
      expect(screen.getByTestId("chart-tooltip").textContent).toContain("d2028");
      tap(overlay, 205);
      expect(screen.queryByTestId("chart-tooltip")).toBeNull();
      tap(overlay, 0);
      tap(overlay, 400);
      expect(screen.getByTestId("chart-tooltip").textContent).toContain("d2030");
    });

    test("a swipe over the plot does not open the card", () => {
      renderChart();
      const overlay = plotOverlay();
      fireEvent.pointerDown(overlay, { pointerType: "touch", clientX: 200, clientY: 50 });
      fireEvent.pointerUp(overlay, { pointerType: "touch", clientX: 230, clientY: 50 });
      expect(screen.queryByTestId("chart-tooltip")).toBeNull();
      fireEvent.pointerDown(overlay, { pointerType: "touch", clientX: 200, clientY: 50 });
      fireEvent.pointerCancel(overlay, { pointerType: "touch" });
      fireEvent.pointerUp(overlay, { pointerType: "touch", clientX: 200, clientY: 50 });
      expect(screen.queryByTestId("chart-tooltip")).toBeNull();
    });

    test("a pointerdown outside the plot closes the card", () => {
      renderChart();
      tap(plotOverlay(), 200);
      expect(screen.getByTestId("chart-tooltip")).toBeTruthy();
      fireEvent.pointerDown(document.body, { pointerType: "touch" });
      expect(screen.queryByTestId("chart-tooltip")).toBeNull();
    });

    test("Escape closes the card", () => {
      renderChart();
      tap(plotOverlay(), 200);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByTestId("chart-tooltip")).toBeNull();
    });
  });

  test("bands fill with a vertical gradient and carry a top edge line", () => {
    renderChart({
      series: [
        { key: "a", label: "A", points: points([1, 2, 3, 4, 5]) },
        { key: "b", label: "B", points: points([1, 1, 1, 1, 1]) },
      ],
    });
    expect(document.querySelectorAll("linearGradient")).toHaveLength(2);
    const edge = screen.getAllByTestId("chart-band-edge-a")[0];
    expect(edge?.getAttribute("stroke-width")).toBe("1.5");
    expect(edge?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(edge?.getAttribute("d")?.startsWith("M ")).toBe(true);
    expect(edge?.getAttribute("d")).not.toContain("Z");
  });

  test("a single bucket still draws the dot, not a gradient band", () => {
    renderChart({
      series: [{ key: "a", label: "A", points: [{ atMs: jan(2028), value: 5 }] }],
    });
    expect(screen.getAllByTestId("stacked-area-single-point").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("chart-band-edge-a")).toBeNull();
  });

  test("close marker pins stagger into separate rows, distant ones share row 0", () => {
    const span = jan(2030) - jan(2026);
    renderChart({
      markerLabels: true,
      markerLegend: "legend",
      markers: [
        { atMs: jan(2026) + span * 0.5, label: "A" },
        { atMs: jan(2026) + span * 0.52, label: "B" },
        { atMs: jan(2026) + span * 0.9, label: "C" },
      ],
    });
    const tops = screen.getAllByTestId("chart-marker-pin").map((pin) => pin.style.top);
    expect(tops).toEqual(["0px", "18px", "0px"]);
    expect(screen.getAllByTestId("chart-marker-pin")[0]?.parentElement?.style.height).toBe("36px");
  });
});
