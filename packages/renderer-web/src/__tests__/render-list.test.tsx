import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { RenderList } from "@cosmicdrift/kumiko-renderer";
import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "./test-utils";

const taskEntity = {
  fields: {
    title: { type: "text", sortable: true },
    status: { type: "text" },
    isUrgent: { type: "boolean" },
    priority: { type: "number" },
  },
} as unknown as EntityDefinition;

const listScreen: EntityListScreenDefinition = {
  id: "tasks:screen:task-list",
  type: "entityList",
  entity: "task",
  columns: [
    "title",
    "status",
    "isUrgent",
    { field: "priority", renderer: (v: unknown) => `P${v}` },
  ],
};

describe("RenderList", () => {
  test("empty state when rows is empty", () => {
    render(<RenderList screen={listScreen} entity={taskEntity} rows={[]} featureName="tasks" />);
    // Default-Primitive hängt "-empty" an die testId der DataTable.
    expect(screen.getByTestId("render-list-table-empty")).toBeTruthy();
    expect(screen.queryByTestId("render-list-table")).toBeNull();
  });

  test("custom emptyState overrides the default message", () => {
    render(
      <RenderList
        screen={listScreen}
        entity={taskEntity}
        rows={[]}
        featureName="tasks"
        emptyState={<span data-testid="custom-empty">nix da</span>}
      />,
    );
    expect(screen.getByTestId("custom-empty")).toBeTruthy();
  });

  test("renders a thead with one <th> per column, labeled via translate", () => {
    render(
      <RenderList
        screen={listScreen}
        entity={taskEntity}
        rows={[]}
        featureName="tasks"
        translate={(key) => `T(${key})`}
        emptyState={<span />}
      />,
    );
    // Empty-state branch short-circuits before thead; push a row in.
    render(
      <RenderList
        screen={listScreen}
        entity={taskEntity}
        rows={[{ id: "1", title: "Foo", status: "open", isUrgent: false, priority: 3 }]}
        featureName="tasks"
        translate={(key) => `T(${key})`}
      />,
    );
    expect(screen.getByTestId("column-title").textContent).toBe("T(tasks:entity:task:field:title)");
    expect(screen.getByTestId("column-priority").textContent).toBe(
      "T(tasks:entity:task:field:priority)",
    );
  });

  test("sortable column gets data-sortable attribute; non-sortable does not", () => {
    render(
      <RenderList
        screen={listScreen}
        entity={taskEntity}
        rows={[{ id: "1", title: "Foo", status: "open", isUrgent: false, priority: 3 }]}
        featureName="tasks"
      />,
    );
    expect(screen.getByTestId("column-title").getAttribute("data-sortable")).toBe("true");
    expect(screen.getByTestId("column-status").getAttribute("data-sortable")).toBeNull();
  });

  test("renders one row per item, one cell per column, with formatted values", () => {
    render(
      <RenderList
        screen={listScreen}
        entity={taskEntity}
        rows={[
          { id: "r1", title: "Alpha", status: "open", isUrgent: true, priority: 3 },
          { id: "r2", title: "Beta", status: "done", isUrgent: false, priority: 1 },
        ]}
        featureName="tasks"
      />,
    );

    // Row 1
    expect(screen.getByTestId("cell-r1-title").textContent).toBe("Alpha");
    expect(screen.getByTestId("cell-r1-isUrgent").textContent).toBe("✓");
    expect(screen.getByTestId("cell-r1-priority").textContent).toBe("P3"); // custom renderer

    // Row 2
    expect(screen.getByTestId("cell-r2-isUrgent").textContent).toBe(""); // false → empty
    expect(screen.getByTestId("cell-r2-priority").textContent).toBe("P1");
  });

  test("onRowClick fires with the ListRowViewModel when present; no-op without", () => {
    const onClick = mock();
    render(
      <RenderList
        screen={listScreen}
        entity={taskEntity}
        rows={[{ id: "r1", title: "A", status: "open", isUrgent: false, priority: 0 }]}
        featureName="tasks"
        onRowClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId("row-r1"));
    expect(onClick).toHaveBeenCalledOnce();
    const arg = onClick.mock.lastCall?.[0] as { id: string; values: Record<string, unknown> };
    expect(arg.id).toBe("r1");
    expect(arg.values["title"]).toBe("A");
  });

  test("throws on unknown field in a column — boot-validator miss should fail loud", () => {
    const badScreen: EntityListScreenDefinition = {
      id: "tasks:screen:bad-list",
      type: "entityList",
      entity: "task",
      columns: ["ghost"],
    };
    expect(() =>
      render(
        <RenderList
          screen={badScreen}
          entity={taskEntity}
          rows={[{ id: "r1", ghost: "x" }]}
          featureName="tasks"
        />,
      ),
    ).toThrow(/unknown field "ghost"/);
  });
});
