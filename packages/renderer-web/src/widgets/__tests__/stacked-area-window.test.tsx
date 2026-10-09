import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen, within } from "../../__tests__/test-utils.js";
import { StackedAreaChart } from "../charts.js";

const monthAt = (index: number): number => Date.UTC(2026, index, 1);
const monthLabel = (atMs: number): string => new Date(atMs).toISOString().slice(0, 7);

const props = {
  series: [
    {
      key: "a",
      label: "A",
      points: Array.from({ length: 36 }, (_, i) => ({ atMs: monthAt(i), value: 10 + i })),
    },
  ],
  windowStartMs: monthAt(0),
  windowEndMs: monthAt(35),
  todayMs: monthAt(6),
  ariaLabel: "Plan",
  todayLabel: "Today",
  formatBucketLabel: monthLabel,
  testId: "area",
};

const ranges = {
  default: "1y",
  options: [
    { value: "1y", label: "1 year", months: 12 },
    { value: "max", label: "Max" },
  ],
};

describe("StackedAreaChart window", () => {
  test("without ranges, brush or selection there is no switch and no brush", () => {
    render(<StackedAreaChart {...props} />);
    expect(screen.queryByTestId("area-range")).toBeNull();
    expect(screen.queryByTestId("area-brush")).toBeNull();
    expect(screen.getByText("2026-01")).toBeTruthy();
    expect(screen.getByText("2028-12")).toBeTruthy();
  });

  test("uncontrolled ranges render their own switch that changes the visible window", () => {
    render(<StackedAreaChart {...props} ranges={ranges} />);
    expect(screen.getByText("2026-07")).toBeTruthy();
    expect(screen.getByText("2027-07")).toBeTruthy();
    const rangeSwitch = screen.getByTestId("area-range");
    fireEvent.click(within(rangeSwitch).getByRole("button", { name: "Max" }));
    expect(screen.getByText("2026-01")).toBeTruthy();
    expect(screen.getByText("2028-12")).toBeTruthy();
  });

  test("the brush moves the window by keyboard, deselects the switch and a range click resets it", () => {
    render(<StackedAreaChart {...props} ranges={ranges} brush />);
    expect(screen.getByTestId("area-brush")).toBeTruthy();
    const [startHandle, endHandle] = screen.getAllByRole("slider");
    expect(startHandle?.getAttribute("aria-label")).toBe("Window start");
    expect(endHandle?.getAttribute("aria-label")).toBe("Window end");
    expect(startHandle?.getAttribute("aria-valuenow")).toBe("6");
    if (startHandle === undefined) throw new Error("start handle missing");
    fireEvent.keyDown(startHandle, { key: "ArrowRight" });
    expect(screen.getByText("2026-08")).toBeTruthy();
    const rangeSwitch = screen.getByTestId("area-range");
    for (const button of within(rangeSwitch).getAllByRole("button")) {
      expect(button.getAttribute("aria-pressed")).toBe("false");
    }
    fireEvent.click(within(rangeSwitch).getByRole("button", { name: "1 year" }));
    expect(screen.getByText("2026-07")).toBeTruthy();
    expect(screen.getByText("2027-07")).toBeTruthy();
  });

  test("brush without ranges starts at today and uses the custom handle labels", () => {
    render(<StackedAreaChart {...props} brush brushLabels={{ start: "Von", end: "Bis" }} />);
    expect(screen.getByText("2026-07")).toBeTruthy();
    expect(screen.getByText("2028-12")).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Von" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Bis" })).toBeTruthy();
    expect(screen.queryByTestId("area-range")).toBeNull();
  });

  test("a controlled window renders no switch and only reports changes", () => {
    const changes: unknown[] = [];
    render(
      <StackedAreaChart
        {...props}
        ranges={ranges}
        brush
        windowSelection={{ kind: "range", value: "max" }}
        onWindowSelectionChange={(selection) => changes.push(selection)}
      />,
    );
    expect(screen.queryByTestId("area-range")).toBeNull();
    const [startHandle] = screen.getAllByRole("slider");
    if (startHandle === undefined) throw new Error("start handle missing");
    fireEvent.keyDown(startHandle, { key: "ArrowRight" });
    expect(changes).toEqual([{ kind: "brush", startMs: monthAt(1), endMs: monthAt(35) }]);
  });
});

describe("StackedAreaChart date format, start window, y scale and marker legend", () => {
  const zoned = (atMs: number, format: "day" | "month"): string => {
    const iso = new Date(atMs).toISOString();
    return format === "month" ? `M ${iso.slice(0, 7)}` : `D ${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  };
  const formatProps = { ...props, formatBucketLabel: zoned, formatMarkerTime: zoned };
  const markers = [
    {
      atMs: monthAt(9),
      label: "Sondertilgung 2026",
      color: "var(--c-extra)",
      legendLabel: "Extra",
    },
    {
      atMs: monthAt(10),
      label: "Sondertilgung 2027",
      color: "var(--c-extra)",
      legendLabel: "Extra",
    },
    { atMs: monthAt(11), label: "Ende", color: "var(--c-end)", legendLabel: "Ende" },
  ];

  test("a window of 18 months or more shows month and year, a shorter one day and month", () => {
    render(<StackedAreaChart {...formatProps} ranges={ranges} />);
    expect(screen.getAllByText("D 01.07")).toHaveLength(2);
    fireEvent.click(within(screen.getByTestId("area-range")).getByRole("button", { name: "Max" }));
    expect(screen.getByText("M 2026-01")).toBeTruthy();
    expect(screen.getByText("M 2028-12")).toBeTruthy();
  });

  test("marker times follow the visible window and dateFormat overrides it", () => {
    const { rerender } = render(<StackedAreaChart {...formatProps} markers={markers} />);
    expect(screen.getAllByTestId("chart-marker-item")[0]?.textContent).toContain("M 2026-10");
    rerender(<StackedAreaChart {...formatProps} markers={markers} dateFormat="day" />);
    expect(screen.getAllByTestId("chart-marker-item")[0]?.textContent).toContain("D 01.10");
  });

  test("initialWindow from-today starts at today without an active pill; a range click switches", () => {
    render(<StackedAreaChart {...props} ranges={ranges} initialWindow="from-today" />);
    expect(screen.getByText("2026-07")).toBeTruthy();
    expect(screen.getByText("2028-12")).toBeTruthy();
    const rangeSwitch = screen.getByTestId("area-range");
    for (const button of within(rangeSwitch).getAllByRole("button")) {
      expect(button.getAttribute("aria-pressed")).toBe("false");
    }
    fireEvent.click(within(rangeSwitch).getByRole("button", { name: "1 year" }));
    expect(screen.getByText("2027-07")).toBeTruthy();
  });

  test("the y scale tops out at the finer step: 1.1 million gives 1.2 million", () => {
    render(
      <StackedAreaChart
        {...props}
        series={[
          {
            key: "a",
            label: "A",
            points: [
              { atMs: monthAt(0), value: 1_100_000 },
              { atMs: monthAt(1), value: 900_000 },
            ],
          },
        ]}
        windowEndMs={monthAt(1)}
        todayMs={undefined}
        showLegendTotals={false}
      />,
    );
    expect(screen.getByText("1200000")).toBeTruthy();
    expect(screen.getByText("600000")).toBeTruthy();
    expect(screen.queryByText("2000000")).toBeNull();
  });

  test("a window with smaller values lowers the y ticks", () => {
    render(<StackedAreaChart {...props} brush />);
    expect(screen.getByText("50")).toBeTruthy();
    expect(screen.getByText("25")).toBeTruthy();
  });

  test("markerLegend legend replaces the numbered list by unnumbered pins and legend entries", () => {
    render(<StackedAreaChart {...formatProps} markers={markers} markerLegend="legend" />);
    expect(screen.queryAllByTestId("chart-marker-item")).toHaveLength(0);
    const pins = screen.getAllByTestId("chart-marker-pin");
    expect(pins).toHaveLength(3);
    expect(pins[0]?.textContent).toBe("");
    expect(pins[0]?.getAttribute("title")).toBe("Sondertilgung 2026 · M 2026-10");
    expect(screen.getByTestId("chart-legend-marker-Extra-var(--c-extra)").textContent).toBe(
      "Extra",
    );
    expect(screen.getByTestId("chart-legend-marker-Ende-var(--c-end)")).toBeTruthy();
    expect(screen.getAllByTestId(/^chart-legend-marker-/)).toHaveLength(2);
  });
});
