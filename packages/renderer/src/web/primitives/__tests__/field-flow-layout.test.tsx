import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { defaultPrimitives } from "../index.tsx";

const { Grid, GridCell } = defaultPrimitives;

describe("field flow keeps declared columns", () => {
  test("a flow grid with two declared columns lays out as a two-track grid", () => {
    const { getByTestId } = render(
      <Grid columns={2} flow testId="g">
        <GridCell width="select">a</GridCell>
        <GridCell width="select">b</GridCell>
      </Grid>,
    );
    const grid = getByTestId("g");

    expect(grid.className).toContain("grid");
    expect(grid.className).not.toContain("flex-wrap");
    expect(grid.style.getPropertyValue("--grid-cols")).toBe("repeat(2, minmax(0, 1fr))");
  });

  test("a flow grid with a single column keeps the wrapping flow", () => {
    const { getByTestId } = render(
      <Grid columns={1} flow testId="g">
        <GridCell width="select">a</GridCell>
      </Grid>,
    );

    expect(getByTestId("g").className).toContain("flex-wrap");
  });

  test("a select cell has the width of a text cell, independent of its content", () => {
    const { getByTestId } = render(
      <Grid columns={1} flow testId="g">
        <GridCell width="select">a</GridCell>
        <GridCell width="text">b</GridCell>
      </Grid>,
    );
    const [select, text] = Array.from(getByTestId("g").children);

    expect(select?.className).toContain("sm:w-60");
    expect(select?.className).not.toContain("sm:w-auto");
    expect(text?.className).toContain("sm:w-60");
  });
});
