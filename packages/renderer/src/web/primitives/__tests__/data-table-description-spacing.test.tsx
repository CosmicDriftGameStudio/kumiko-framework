import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../index.tsx";

const { DataTable } = defaultPrimitives;

describe("DataTable description spacing on full-height screens", () => {
  test("without a toolbar the description keeps distance from the page header", () => {
    render(<DataTable columns={[]} rows={[]} scrollBody toolbarDescription="Explains the list" />);

    expect(screen.getByTestId("render-list-description").className).toContain("pt-4");
  });

  test("below a toolbar the description adds no extra top padding", () => {
    render(
      <DataTable
        columns={[]}
        rows={[]}
        scrollBody
        toolbarStart={<div>search</div>}
        toolbarDescription="Explains the list"
      />,
    );

    expect(screen.getByTestId("render-list-description").className).not.toContain("pt-4");
  });
});
