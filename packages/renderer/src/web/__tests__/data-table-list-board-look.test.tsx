import { describe, expect, mock, test } from "bun:test";
import { LIST_BADGE_TONE } from "../primitives/data-table-cell.tsx";
import { defaultPrimitives } from "../primitives/index.tsx";
import { render, screen } from "./test-utils.tsx";

const { DataTable } = defaultPrimitives;

describe("LIST_BADGE_TONE", () => {
  test("understands the SelectOptionTone words next to the list tone words", () => {
    expect(LIST_BADGE_TONE["ok"]).toBe("ok");
    expect(LIST_BADGE_TONE["positive"]).toBe("ok");
    expect(LIST_BADGE_TONE["bad"]).toBe("bad");
    expect(LIST_BADGE_TONE["critical"]).toBe("bad");
    expect(LIST_BADGE_TONE["negative"]).toBe("bad");
    expect(LIST_BADGE_TONE["warn"]).toBe("warn");
    expect(LIST_BADGE_TONE["neutral"]).toBe("muted");
    expect(LIST_BADGE_TONE["accent"]).toBe("muted");
  });
});

describe("DataTable board cells", () => {
  test("ellipsis keeps the cell on one line and emphasis sets medium foreground text", () => {
    render(
      <DataTable
        columns={[
          { field: "name", label: "Name", type: "string", sortable: false },
          { field: "msg", label: "Message", type: "string", sortable: false, ellipsis: true },
          { field: "todo", label: "To do", type: "string", sortable: false, emphasis: true },
        ]}
        rows={[{ id: "r1", values: { name: "A", msg: "long text", todo: "Reply" } }]}
      />,
    );
    expect(screen.getByTestId("cell-r1-msg").className).toContain("truncate");
    expect(screen.getByTestId("cell-r1-msg").getAttribute("title")).toBe("long text");
    expect(screen.getByTestId("cell-r1-todo").className).toContain("font-semibold");
    expect(screen.getByTestId("cell-r1-name").className).not.toContain("font-medium");
    expect(screen.getByTestId("cell-r1-todo").className).toContain("text-foreground");
  });

  test("a muted row draws its cells in the muted text colour", () => {
    render(
      <DataTable
        columns={[
          { field: "name", label: "Name", type: "string", sortable: false },
          { field: "car", label: "Car", type: "string", sortable: false },
        ]}
        rows={[
          { id: "r1", values: { name: "A", car: "none", quiet: true } },
          { id: "r2", values: { name: "B", car: "Skoda", quiet: false } },
        ]}
        rowMuted={(row) => row.values["quiet"] === true}
      />,
    );
    expect(screen.getByTestId("cell-r1-car").className).toContain("text-muted-foreground");
    expect(screen.getByTestId("cell-r2-car").className).not.toContain("text-muted-foreground");
  });

  test("dateOnlyAfterDays drops the time of an old timestamp and keeps a recent one", () => {
    const recent = new Date().toISOString();
    render(
      <DataTable
        columns={[
          {
            field: "at",
            label: "At",
            type: "string",
            sortable: false,
            renderer: { format: "timestamp" },
            dateOnlyAfterDays: 7,
          },
        ]}
        rows={[
          { id: "old", values: { at: "2020-03-12T11:00:00Z" } },
          { id: "new", values: { at: recent } },
        ]}
      />,
    );
    expect(screen.getByTestId("cell-old-at").textContent).toContain("2020");
    expect(screen.getByTestId("cell-old-at").textContent).not.toMatch(/\d:\d\d/);
    expect(screen.getByTestId("cell-new-at").textContent).toMatch(/\d:\d\d/);
  });

  test("dateOnlyAfterDays leaves an unparsable or out-of-range value as it is instead of throwing", () => {
    render(
      <DataTable
        columns={[
          {
            field: "at",
            label: "At",
            type: "string",
            sortable: false,
            dateOnlyAfterDays: 7,
          },
        ]}
        rows={[
          { id: "bad", values: { at: "not a date" } },
          { id: "huge", values: { at: 9e15 } },
        ]}
      />,
    );
    expect(screen.getByTestId("cell-bad-at").textContent).toBe("not a date");
    expect(screen.getByTestId("cell-huge-at").textContent).toBe("9000000000000000");
  });

  test("an emphasis column keeps its bold foreground text in a muted row", () => {
    render(
      <DataTable
        columns={[
          { field: "name", label: "Name", type: "string", sortable: false },
          { field: "todo", label: "To do", type: "string", sortable: false, emphasis: true },
        ]}
        rows={[{ id: "r1", values: { name: "A", todo: "Reply", quiet: true } }]}
        rowMuted={(row) => row.values["quiet"] === true}
      />,
    );
    const todo = screen.getByTestId("cell-r1-todo").className;
    expect(todo).toContain("font-semibold");
    expect(todo).toContain("text-foreground");
    expect(todo).not.toContain("text-muted-foreground");
    expect(screen.getByTestId("cell-r1-name").className).toContain("text-muted-foreground");
  });

  test("a muted row mutes the clickable title too; only an emphasis cell stays dark", () => {
    render(
      <DataTable
        columns={[
          { field: "name", label: "Name", type: "string", sortable: false },
          { field: "todo", label: "To do", type: "string", sortable: false, emphasis: true },
        ]}
        rows={[{ id: "r1", values: { name: "A", todo: "Reply", quiet: true } }]}
        rowMuted={(row) => row.values["quiet"] === true}
        onRowClick={mock()}
        rowActions={[{ id: "open", label: "Open", rowClick: true, onTrigger: mock() }]}
      />,
    );
    const title = screen.getByText("A").closest("button") as HTMLElement;
    expect(title.className).not.toContain("text-foreground");
    expect(screen.getByTestId("cell-r1-name").className).toContain("text-muted-foreground");
    expect(screen.getByTestId("cell-r1-todo").className).toContain("text-foreground");
  });

  test("an empty first cell of a clickable row shows its emptyPlaceholder", () => {
    render(
      <DataTable
        columns={[
          {
            field: "name",
            label: "Name",
            type: "string",
            sortable: false,
            emptyPlaceholder: "No name yet",
          },
        ]}
        rows={[{ id: "r1", values: { name: "" } }]}
        onRowClick={mock()}
        rowActions={[{ id: "open", label: "Open", rowClick: true, onTrigger: mock() }]}
      />,
    );
    const cell = screen.getByTestId("cell-r1-name");
    expect(cell.querySelector("button")).not.toBeNull();
    expect(cell.textContent).toContain("No name yet");
  });
});
