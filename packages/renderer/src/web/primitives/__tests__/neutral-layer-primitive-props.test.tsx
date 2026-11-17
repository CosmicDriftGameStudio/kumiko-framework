import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../index.tsx";

const { DataTable, Card, MetricBand, Section, FillContainer } = defaultPrimitives;

const columns = [{ field: "title", label: "Title", type: "string", sortable: false }] as const;
const rows = [{ id: "r1", values: { title: "First" } }];

describe("typed props that replace selector variants in the neutral renderer layer", () => {
  test("DataTable headerTone muted paints the header muted", () => {
    render(<DataTable columns={columns} rows={rows} headerTone="muted" />);
    const header = screen.getByRole("columnheader", { name: "Title" }).closest("thead");
    expect(header?.className).toContain("bg-muted");
  });

  test("Card headerPadding flush drops the header inset", () => {
    render(
      <Card slots={{ title: "Parts" }} options={{ headerPadding: "flush" }} testId="card">
        body
      </Card>,
    );
    const header = screen.getByText("Parts").closest("[class*='px-0']");
    expect(header?.className).toContain("pt-1");
    expect(header?.className).not.toContain("px-[var(--card-padding)]");
  });

  test("MetricBand splitPart lead drops the bottom padding, tiles the top", () => {
    render(
      <>
        <MetricBand testId="lead" splitPart="lead">
          {undefined}
        </MetricBand>
        <MetricBand testId="tiles" splitPart="tiles">
          {undefined}
        </MetricBand>
      </>,
    );
    expect(screen.getByTestId("lead").classList.contains("pb-0")).toBe(true);
    expect(screen.getByTestId("tiles").classList.contains("pt-3")).toBe(true);
    expect(screen.getByTestId("tiles").classList.contains("pt-3.5")).toBe(false);
  });

  test("Section titleOnNarrow false hides the title below sm", () => {
    render(
      <Section title="Details" titleOnNarrow={false} testId="sec">
        x
      </Section>,
    );
    expect(screen.getByText("Details").closest("[data-section-title]")?.className).toContain(
      "max-sm:hidden",
    );
  });

  test("FillContainer dataAttributes land on the container", () => {
    render(
      <FillContainer testId="box" dataAttributes={{ "data-footer-align": "start" }}>
        x
      </FillContainer>,
    );
    expect(screen.getByTestId("box").getAttribute("data-footer-align")).toBe("start");
  });
});
