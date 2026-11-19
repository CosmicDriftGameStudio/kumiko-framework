import { describe, expect, test } from "bun:test";
import { defaultPrimitives } from "../primitives/index.tsx";
import { render, screen } from "./test-utils.tsx";

const { DataTable } = defaultPrimitives;

const COLUMNS = [
  { field: "name", label: "Name", type: "string", sortable: false },
  {
    field: "act",
    label: "Action",
    type: "string",
    sortable: false,
    rowActionLink: true,
    linkFor: () => ({ href: "/x", onPress: () => {} }),
  },
] as const;

const ROWS = [{ id: "r1", values: { name: "Alpha", act: "Reply" } }];

describe("DataTable trailing row-action column", () => {
  test("header and cell pin to the right edge from md", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);
    expect(screen.getByTestId("column-act").className).toContain("md:sticky");
    expect(screen.getByTestId("column-act").className).toContain("md:right-0");
    expect(screen.getByText("Reply").closest("td")?.className).toContain("md:sticky");
    expect(screen.getByTestId("column-name").className).not.toContain("md:sticky");
  });

  test("with a table-actions column the row-action column stays in flow", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowActions={[{ id: "a", label: "Archive", onTrigger: () => {} }]}
      />,
    );
    expect(screen.getByTestId("column-act").className).not.toContain("md:sticky");
    expect(screen.getByText("Reply").closest("td")?.className).not.toContain("md:sticky");
  });
});
