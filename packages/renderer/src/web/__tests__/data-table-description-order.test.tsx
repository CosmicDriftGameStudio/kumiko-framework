import { describe, expect, test } from "bun:test";
import { DataTable } from "./_primitives-helpers.tsx";
import { render, screen } from "./test-utils.tsx";

const columns = [{ field: "name", label: "Name", type: "string" as const, sortable: false }];
const rows = [{ id: "r1", values: { name: "Ada" } }];

describe("DataTable description placement", () => {
  function precedes(first: Element, second: Element): boolean {
    return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }

  test("an embedded table shows its description above the toolbar", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        toolbarDescription="Explains the section"
        toolbarEnd={<button type="button">Act</button>}
      />,
    );
    expect(
      precedes(
        screen.getByTestId("render-list-description"),
        screen.getByTestId("render-list-toolbar"),
      ),
    ).toBe(true);
  });

  test("a full-height list keeps the description below the toolbar", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        scrollBody
        toolbarDescription="Explains the list"
        toolbarEnd={<button type="button">Act</button>}
      />,
    );
    expect(
      precedes(
        screen.getByTestId("render-list-toolbar"),
        screen.getByTestId("render-list-description"),
      ),
    ).toBe(true);
  });
});
