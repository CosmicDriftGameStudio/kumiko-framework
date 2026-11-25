import { describe, expect, test } from "bun:test";
import { defaultPrimitives } from "../primitives/index.tsx";
import { atViewportWidth, fireEvent, render, screen } from "./test-utils.tsx";

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

describe("DataTable cellEditor", () => {
  const columns = [
    { field: "name", label: "Name", type: "string" as const, sortable: false },
    { field: "status", label: "Status", type: "select" as const, sortable: false },
  ];
  const editorFor = (changes: string[]) => (row: { readonly id: string }, field: string) =>
    field === "status"
      ? {
          options: [
            { value: "open", label: "Open" },
            { value: "done", label: "Done" },
          ],
          value: row.id === "r1" ? "open" : null,
          required: true,
          placeholder: "—",
          ariaLabel: "Status",
          onChange: (value: string) => changes.push(`${row.id}:${value}`),
        }
      : undefined;

  test("a select replaces the value, a choice reports the value and does not open the row", () => {
    const changes: string[] = [];
    const opened: string[] = [];
    render(
      <DataTable
        columns={columns}
        rows={[{ id: "r1", values: { name: "A", status: "open" } }]}
        cellEditor={editorFor(changes)}
        onRowClick={(row) => opened.push(row.id)}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Status" }) as HTMLSelectElement;
    expect(select.value).toBe("open");
    fireEvent.click(select);
    fireEvent.change(select, { target: { value: "done" } });
    expect(changes).toEqual(["r1:done"]);
    expect(opened).toEqual([]);
  });

  test("an empty required value shows the placeholder as an error", () => {
    render(
      <DataTable
        columns={columns}
        rows={[{ id: "r2", values: { name: "B", status: null } }]}
        cellEditor={editorFor([])}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Status" }) as HTMLSelectElement;
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(select.selectedOptions[0]?.textContent).toBe("—");
  });

  test("a struck row does not strike the edit cell through, its other cells stay struck", () => {
    render(
      <DataTable
        columns={columns}
        rows={[{ id: "r1", values: { name: "A", status: "open" } }]}
        rowStruck={() => true}
        cellEditor={editorFor([])}
      />,
    );
    expect(screen.getByTestId("cell-r1-status").className).not.toContain("line-through");
    expect(screen.getByTestId("cell-r1-name").className).toContain("line-through");
  });
});
