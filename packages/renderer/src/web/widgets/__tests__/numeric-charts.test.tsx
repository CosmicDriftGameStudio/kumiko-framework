import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "../../__tests__/test-utils.tsx";
import { HistogramChart, NumericLineChart, SignedBarChart } from "../numeric-charts.tsx";

describe("NumericLineChart", () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  beforeEach(() => {
    HTMLElement.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);
  });
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
  });

  function renderChart(): void {
    render(
      <NumericLineChart
        ariaLabel="Wealth"
        testId="wealth"
        series={[
          {
            key: "property",
            label: "Property",
            points: [
              { x: 0, y: 100 },
              { x: 10, y: 150 },
              { x: 20, y: 300 },
            ],
          },
          {
            key: "etf",
            label: "ETF",
            dashed: true,
            points: [
              { x: 0, y: 100 },
              { x: 10, y: 130 },
              { x: 20, y: 200 },
            ],
          },
        ]}
        xAxis={{ ticks: 5, format: (x) => `${x} y` }}
        yAxis={{ ticks: 4 }}
        referenceLines={[{ axis: "x", value: 10, label: "Sale", dashed: true }]}
        renderTooltip={(x) => <span>{`Year ${x}`}</span>}
      />,
    );
  }

  test("draws one path per series, formatted x ticks and the reference line with its label", () => {
    renderChart();
    screen.getByTestId("numeric-line-property");
    screen.getByTestId("numeric-line-etf");
    screen.getByText("0 y");
    screen.getByText("20 y");
    screen.getByTestId("numeric-reference-x");
    screen.getByText("Sale");
  });

  test("a pointer move shows the tooltip for the nearest x and leaving hides it", () => {
    renderChart();
    expect(screen.queryByTestId("numeric-tooltip")).toBeNull();
    const plot = screen.getByTestId("numeric-line-property").closest("div");
    if (plot === null) throw new Error("plot area not found");
    // 170 of 200px is x = 17 on the 0..20 domain, nearest data x is 20
    fireEvent.pointerMove(plot, { clientX: 170 });
    expect(screen.getByTestId("numeric-tooltip").textContent).toBe("Year 20");
    fireEvent.pointerMove(plot, { clientX: 90 });
    expect(screen.getByTestId("numeric-tooltip").textContent).toBe("Year 10");
    fireEvent.pointerLeave(plot);
    expect(screen.queryByTestId("numeric-tooltip")).toBeNull();
  });
});

describe("SignedBarChart", () => {
  test("stacks negative values below and positive above the always drawn zero line", () => {
    render(
      <SignedBarChart
        ariaLabel="Cashflow"
        buckets={[{ x: 1, values: { loss: -200, gain: 300 } }]}
        series={[
          { key: "loss", label: "Subsidy" },
          { key: "gain", label: "Surplus" },
        ]}
        xAxis={{ format: (x) => `Year ${x}` }}
        yAxis={{ ticks: 5 }}
        formatValue={(value) => `${value} EUR`}
      />,
    );
    expect(screen.getByTestId("signed-bar-loss").getAttribute("data-sign")).toBe("negative");
    expect(screen.getByTestId("signed-bar-gain").getAttribute("data-sign")).toBe("positive");
    expect(screen.getByTestId("signed-bar-loss").textContent).toContain("-200 EUR");
    screen.getByTestId("signed-bar-zero-line");
    screen.getByText("Year 1");
  });
});

describe("HistogramChart", () => {
  test("draws a bar per bin, the breakeven line with its label and y tick labels", () => {
    render(
      <HistogramChart
        ariaLabel="Net result"
        bins={[
          { id: "a", start: -100, end: 0, count: 10 },
          { id: "b", start: 0, end: 100, count: 40 },
          { id: "c", start: 100, end: 200, count: 20 },
        ]}
        xAxis={{ ticks: 4 }}
        yAxis={{ ticks: 3, format: (value) => `${value} runs` }}
        referenceLines={[{ value: 0, label: "Breakeven" }]}
      />,
    );
    expect(screen.getAllByTestId("histogram-bin")).toHaveLength(3);
    screen.getByTestId("histogram-reference-line");
    screen.getByText("Breakeven");
    screen.getByText("0 runs");
    screen.getByText("40 runs");
  });
});
