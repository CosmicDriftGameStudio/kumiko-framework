import { describe, expect, test } from "bun:test";
import { render, screen } from "../../__tests__/test-utils";
import { ComparisonTable, ResultTable } from "../result-panel";

const COLUMNS = [
  { header: "Jahr", cell: (row: { year: number; total: number }) => row.year },
  {
    header: "Summe",
    align: "right" as const,
    cell: (row: { year: number; total: number }) => row.total,
  },
];
const ROWS = [
  { year: 2026, total: 100 },
  { year: 2027, total: 200 },
];

describe("ResultTable", () => {
  test("card=true wrapt in den gerundeten Border-Container mit bg-muted-Header", () => {
    const { container } = render(
      <ResultTable columns={COLUMNS} rows={ROWS} rowKey={(r) => String(r.year)} card testId="rt" />,
    );
    expect(container.querySelector(".rounded-lg.border.bg-card")).toBeTruthy();
    expect(container.querySelector("thead.bg-muted")).toBeTruthy();
    expect(screen.getByText("2026")).toBeTruthy();
  });

  test("ohne card kein Wrapper (bare default)", () => {
    const { container } = render(
      <ResultTable columns={COLUMNS} rows={ROWS} rowKey={(r) => String(r.year)} testId="rt" />,
    );
    expect(container.querySelector(".rounded-lg.border.bg-card")).toBeNull();
    expect(container.querySelector("thead.bg-muted")).toBeNull();
  });
});

describe("ComparisonTable", () => {
  const cols = ["A", "B"];
  const metrics = [{ label: "Zins", value: (col: string) => `${col}-Zins` }];

  test("card=true wrapt in den gerundeten Border-Container mit bg-muted-Header", () => {
    const { container } = render(
      <ComparisonTable
        columns={cols}
        columnHeader={(c) => c}
        columnKey={(c) => c}
        metrics={metrics}
        metricLabel="Kennzahl"
        card
        testId="ct"
      />,
    );
    expect(container.querySelector(".rounded-lg.border.bg-card")).toBeTruthy();
    expect(container.querySelector("thead.bg-muted")).toBeTruthy();
    expect(screen.getByText("A-Zins")).toBeTruthy();
  });

  test("ohne card kein Wrapper (bare default)", () => {
    const { container } = render(
      <ComparisonTable
        columns={cols}
        columnHeader={(c) => c}
        columnKey={(c) => c}
        metrics={metrics}
        metricLabel="Kennzahl"
        testId="ct"
      />,
    );
    expect(container.querySelector(".rounded-lg.border.bg-card")).toBeNull();
    expect(container.querySelector("thead.bg-muted")).toBeNull();
  });
});
