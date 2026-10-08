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
