// DefaultGrid's `maxRows` clips the grid to roughly N rows once the option
// count (given `columns`) actually exceeds that many rows — style-only until
// then, no extra wrapper element. Height derives from the
// `--kumiko-grid-row-h` CSS var (same var `grid-auto-rows`'s minmax floor
// uses), never a hardcoded pixel/rem constant, so a theme redefining the var
// scales both together. `grid-auto-rows` is a minmax MIN, not a fixed
// height, so a wrapped label grows its row instead of being clipped.

import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../index";

const { Grid } = defaultPrimitives;

describe("DefaultGrid — maxRows", () => {
  test("fewer options than maxRows rows can hold → no scroll container", () => {
    render(
      <Grid columns={2} maxRows={3} testId="grid">
        <div>a</div>
        <div>b</div>
      </Grid>,
    );
    const el = screen.getByTestId("grid");
    expect(el.style.overflowY).toBe("");
    expect(el.style.maxHeight).toBe("");
  });

  test("more options than maxRows rows can hold → scroll container with height derived from maxRows", () => {
    render(
      <Grid columns={2} maxRows={2} testId="grid">
        <div>a</div>
        <div>b</div>
        <div>c</div>
        <div>d</div>
        <div>e</div>
      </Grid>,
    );
    const el = screen.getByTestId("grid");
    expect(el.style.overflowY).toBe("auto");
    expect(el.style.maxHeight).toContain("var(--kumiko-grid-row-h");
    expect(el.style.maxHeight).toContain("2 *");
    // minmax(..., auto), not a fixed height — a row taller than the CSS var
    // (a wrapped label) grows instead of getting clipped mid-row.
    const gridAutoRows = el.style.getPropertyValue("grid-auto-rows");
    expect(gridAutoRows).toContain("var(--kumiko-grid-row-h");
    expect(gridAutoRows).toContain("minmax(");
    expect(gridAutoRows).toContain("auto");
  });

  test("no maxRows at all → never a scroll container regardless of option count", () => {
    render(
      <Grid columns={2} testId="grid">
        <div>a</div>
        <div>b</div>
        <div>c</div>
        <div>d</div>
        <div>e</div>
      </Grid>,
    );
    const el = screen.getByTestId("grid");
    expect(el.style.overflowY).toBe("");
    expect(el.style.maxHeight).toBe("");
  });
});
