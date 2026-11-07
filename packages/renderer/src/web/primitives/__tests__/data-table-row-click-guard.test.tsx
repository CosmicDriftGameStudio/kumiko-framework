import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { ColumnRenderersProvider } from "../../../index.ts";
import { defaultPrimitives } from "../index.tsx";

const { DataTable } = defaultPrimitives;

const rows = [{ id: "r1", values: { name: "Spring", note: "hello" } }];

function ActionCell() {
  return (
    <span>
      <button type="button" data-testid="cell-button">
        Reply
      </button>
      {createPortal(
        <button type="button" data-testid="portal-button">
          In drawer
        </button>,
        document.body,
      )}
    </span>
  );
}

function renderTable() {
  const onRowClick = mock();
  render(
    <ColumnRenderersProvider value={{ ActionCell }}>
      <DataTable
        columns={[
          { field: "name", label: "Name", type: "string", sortable: false },
          {
            field: "note",
            label: "Note",
            type: "string",
            sortable: false,
            renderer: { react: { __component: "ActionCell" } },
          },
        ]}
        rows={rows}
        testId="t"
        onRowClick={onRowClick}
      />
    </ColumnRenderersProvider>,
  );
  return onRowClick;
}

describe("DataTable row click guard", () => {
  test("a button inside a custom cell does not open the row", () => {
    const onRowClick = renderTable();
    fireEvent.click(screen.getByTestId("cell-button"));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test("a click inside portaled content does not open the row", () => {
    const onRowClick = renderTable();
    fireEvent.click(screen.getByTestId("portal-button"));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test("a click on the row itself opens it exactly once", () => {
    const onRowClick = renderTable();
    fireEvent.click(screen.getByTestId("row-r1"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});
