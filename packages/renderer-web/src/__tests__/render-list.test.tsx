import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { ExtensionSectionProps } from "@cosmicdrift/kumiko-renderer";
import { ExtensionSectionsProvider, RenderList } from "@cosmicdrift/kumiko-renderer";
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
    { field: "priority", renderer: { format: "priority" as const, prefix: "P" } },
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
    expect(onClick).toHaveBeenCalledTimes(1);
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

describe("RenderList — slots.header", () => {
  const ListHeader = (props: ExtensionSectionProps) => (
    <div data-testid="list-header-slot">
      header for {props.entityName} (id={String(props.entityId)}) (screen=
      {String(props.screenId)})
    </div>
  );
  const screenWithHeader: EntityListScreenDefinition = {
    ...listScreen,
    slots: { header: { react: { __component: "list-cap-header" } } },
  };

  test("rendert die header-Component in der Toolbar, nicht über dem Titel (#12)", () => {
    render(
      <ExtensionSectionsProvider value={{ "list-cap-header": ListHeader }}>
        <RenderList screen={screenWithHeader} entity={taskEntity} rows={[]} featureName="tasks" />
      </ExtensionSectionsProvider>,
    );
    const header = screen.getByTestId("list-header-slot");
    expect(header.textContent).toContain("header for task");
    // Listen-Kontext → keine Row → entityId null.
    expect(header.textContent).toContain("id=null");
    // Core edit: the header slot gets THIS list's screenId so a control like
    // the tags TagFilter can drive its url-filter state (useListUrlState).
    expect(header.textContent).toContain(`screen=${screenWithHeader.id}`);
    // Placement-Regression (Bug-Bash 3 #12): der Header-Slot lebt IM
    // Toolbar-Container (toolbarEnd), NICHT als loser Node über dem
    // Screen-Titel.
    const toolbar = screen.getByTestId("render-list-table-toolbar");
    expect(toolbar.contains(header)).toBe(true);
  });

  test("ohne slots.header wird nichts gerendert (kein Crash)", () => {
    render(<RenderList screen={listScreen} entity={taskEntity} rows={[]} featureName="tasks" />);
    expect(screen.queryByTestId("list-header-slot")).toBeNull();
  });

  test("slots.header gesetzt, aber Component nicht registriert → kein Crash, kein Header", () => {
    spyOn(console, "warn").mockImplementation(() => {});
    render(
      <ExtensionSectionsProvider value={{}}>
        <RenderList screen={screenWithHeader} entity={taskEntity} rows={[]} featureName="tasks" />
      </ExtensionSectionsProvider>,
    );
    expect(screen.queryByTestId("list-header-slot")).toBeNull();
  });
});

// 573/1: a mid-test assertion throw would skip the trailing warn.mockRestore()
// above, leaking the spy into every later test — this backstop restores
// unconditionally regardless of how the test exited.
afterEach(() => {
  // biome-ignore lint/suspicious/noConsole: reading the spy handle to restore it, not logging
  const warn = console.warn as unknown as { mockRestore?: () => void };
  warn.mockRestore?.();
});
