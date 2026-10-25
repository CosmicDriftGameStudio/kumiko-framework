import { describe, expect, test } from "bun:test";
import { DataTable } from "./_primitives-helpers.tsx";
import { render, screen } from "./test-utils.tsx";

const columns = [{ field: "name", label: "Name", type: "string" as const, sortable: false }];
const rows = [{ id: "r1", values: { name: "Ada" } }];

describe("DataTable description placement", () => {
  function precedes(first: Element, second: Element): boolean {
    return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }

  describe.each([
    { mode: "embedded", fillsHeight: false },
    { mode: "full-height", fillsHeight: true },
  ])("with only toolbar actions ($mode)", ({ fillsHeight }) => {
    test("description and actions share one row, description first", () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          {...(fillsHeight && { scrollBody: true })}
          toolbarDescription="Explains the section"
          toolbarEnd={<button type="button">Act</button>}
        />,
      );
      const toolbar = screen.getByTestId("render-list-toolbar");
      const description = screen.getByTestId("render-list-description");
      const action = screen.getByRole("button", { name: "Act" });
      expect(toolbar.contains(description)).toBe(true);
      expect(toolbar.contains(action)).toBe(true);
      expect(precedes(description, action)).toBe(true);
      expect(toolbar.className).toContain("justify-between");
      expect(toolbar.className).toContain("flex-wrap");
      expect(description.className).toContain("flex-1");
      expect(description.className).not.toContain("pb-2");
    });
  });

  test("an embedded table with search keeps the description above the toolbar", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        toolbarStart={<div>search</div>}
        toolbarDescription="Explains the section"
        toolbarEnd={<button type="button">Act</button>}
      />,
    );
    const toolbar = screen.getByTestId("render-list-toolbar");
    const description = screen.getByTestId("render-list-description");
    expect(toolbar.contains(description)).toBe(false);
    expect(precedes(description, toolbar)).toBe(true);
  });

  test("a full-height list with search keeps the description below the toolbar", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        scrollBody
        toolbarStart={<div>search</div>}
        toolbarDescription="Explains the list"
        toolbarEnd={<button type="button">Act</button>}
      />,
    );
    const toolbar = screen.getByTestId("render-list-toolbar");
    const description = screen.getByTestId("render-list-description");
    expect(toolbar.contains(description)).toBe(false);
    expect(precedes(toolbar, description)).toBe(true);
  });
});
