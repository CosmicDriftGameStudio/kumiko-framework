import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { defaultPrimitives } from "../index.tsx";

const { Grid, GridCell } = defaultPrimitives;

describe("field flow packs fields regardless of declared columns", () => {
  test("a flow grid with two declared columns still wraps its fields in a flex row", () => {
    const { getByTestId } = render(
      <Grid columns={2} flow testId="g">
        <GridCell width="select">a</GridCell>
        <GridCell width="select">b</GridCell>
      </Grid>,
    );
    const grid = getByTestId("g");

    expect(grid.className).toContain("flex-wrap");
    expect(grid.className).not.toContain("grid-cols");
    expect(grid.style.getPropertyValue("--grid-cols")).toBe("");
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
