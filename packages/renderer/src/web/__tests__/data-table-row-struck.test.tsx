import { describe, expect, test } from "bun:test";
import { defaultPrimitives } from "../primitives/index.tsx";
import { atViewportWidth, render, screen } from "./test-utils.tsx";

const { DataTable } = defaultPrimitives;

describe("DataTable rowStruck", () => {
  test("a struck row draws its cells muted and line-through, other rows stay untouched", () => {
    render(
      <DataTable
        columns={[
          { field: "name", label: "Name", type: "string", sortable: false },
          { field: "car", label: "Car", type: "string", sortable: false },
        ]}
        rows={[
          { id: "r1", values: { name: "A", car: "none", status: "lost" } },
          { id: "r2", values: { name: "B", car: "Skoda", status: "open" } },
        ]}
        rowStruck={(row) => row.values["status"] === "lost"}
      />,
    );
    expect(screen.getByTestId("cell-r1-car").className).toContain("line-through");
    expect(screen.getByTestId("cell-r1-car").className).toContain("text-muted-foreground");
    expect(screen.getByTestId("cell-r2-car").className).not.toContain("line-through");
  });

  test("on cards the text of a struck row is line-through, its actions and other cards are not", () => {
    atViewportWidth(500, () => {
      render(
        <DataTable
          columns={[{ field: "name", label: "Name", type: "string", sortable: false }]}
          rows={[
            { id: "r1", values: { name: "Lost offer", status: "lost" } },
            { id: "r2", values: { name: "Open offer", status: "open" } },
          ]}
          rowActions={[{ id: "undo", label: "Undo", display: "button", onTrigger: () => {} }]}
          rowStruck={(row) => row.values["status"] === "lost"}
          testId="t"
        />,
      );
      expect(screen.getByText("Lost offer").closest(".line-through")).not.toBeNull();
      expect(screen.getByText("Open offer").closest(".line-through")).toBeNull();
      expect(screen.getByTestId("row-r1-card-buttons").closest(".line-through")).toBeNull();
    });
  });
});
