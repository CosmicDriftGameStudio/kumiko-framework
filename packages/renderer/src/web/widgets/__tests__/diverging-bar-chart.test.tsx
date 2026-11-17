import { describe, expect, test } from "bun:test";
import { render, screen } from "../../__tests__/test-utils.tsx";
import { DivergingBarChart } from "../diverging-bar-chart.tsx";

describe("DivergingBarChart", () => {
  test("sorts rows by absolute value, marks the sign and formats values", () => {
    render(
      <DivergingBarChart
        ariaLabel="Drivers"
        testId="drivers"
        formatValue={(value) => `${value > 0 ? "+" : ""}${value} pt`}
        rows={[
          { key: "rent", label: "Rent", value: 0.2 },
          { key: "vacancy", label: "Vacancy", value: -0.8 },
          { key: "price", label: "Price", value: 0.5 },
        ]}
      />,
    );
    const rows = screen.getAllByTestId("diverging-bar-row");
    expect(rows.map((row) => row.getAttribute("data-key"))).toEqual(["vacancy", "price", "rent"]);
    expect(rows.map((row) => row.getAttribute("data-sign"))).toEqual([
      "negative",
      "positive",
      "positive",
    ]);
    expect(rows[0]?.textContent).toContain("-0.8 pt");
    expect(rows[1]?.textContent).toContain("+0.5 pt");
    screen.getByRole("img", { name: "Drivers" });
  });
});
