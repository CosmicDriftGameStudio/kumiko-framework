import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../index.tsx";

const { DataTable } = defaultPrimitives;

const columns = [{ field: "title", label: "Title", type: "string", sortable: false }] as const;
const rows = [{ id: "r1", values: { title: "First" } }];

describe("DataTable compactHeader", () => {
  test("renders the header cells in 12px semibold", () => {
    render(<DataTable columns={columns} rows={rows} compactHeader />);
    const classes = screen.getByRole("columnheader", { name: "Title" }).className.split(" ");
    expect(classes).toContain("text-xs");
    expect(classes).toContain("font-semibold");
  });

  test("keeps the default header look without the option", () => {
    render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getByRole("columnheader", { name: "Title" }).className.split(" ")).not.toContain(
      "text-xs",
    );
  });
});
