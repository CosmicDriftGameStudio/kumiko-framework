import { afterAll, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactElement, ReactNode } from "react";
import { type ColumnRendererProps, ColumnRenderersProvider, RenderList } from "../../index.ts";
import { render, screen } from "./test-utils.tsx";

// Tests for the JSX renderer form of ListColumn columns:
// `{ react: { __component: "Name" } }` is resolved to a real React component
// via ColumnRenderersProvider. The function and default paths are covered in
// render-list.test.tsx; these tests cover the three cases involving provider
// lookup.

const taskEntity = {
  fields: {
    title: { type: "text" },
    color: { type: "text" },
  },
} as unknown as EntityDefinition;

const baseScreen: EntityListScreenDefinition = {
  id: "tasks:screen:task-list",
  type: "entityList",
  entity: "task",
  columns: ["title", "color"],
};

function ColorSwatch({ value, row, column }: ColumnRendererProps): ReactNode {
  return (
    <span data-testid="swatch">
      <span data-testid="swatch-value">{String(value)}</span>
      <span data-testid="swatch-field">{column.field}</span>
      <span data-testid="swatch-row-title">{String(row["title"] ?? "")}</span>
    </span>
  );
}

function withRenderers(ui: ReactNode, map: Record<string, typeof ColorSwatch>): ReactElement {
  return <ColumnRenderersProvider value={map}>{ui}</ColumnRenderersProvider>;
}

describe("RenderList — column-renderer registry", () => {
  // Install the spy locally and restore the global afterward so the mock
  // implementation does not leak into other test files (a file-level console
  // spy would affect the entire Vitest worker).
  let warnSpy: Mock<typeof console.warn>;
  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterAll(() => {
    warnSpy.mockRestore();
  });

  test("FormatSpec-renderer: currency formatiert Wert + Symbol", () => {
    const screenWithFmt: EntityListScreenDefinition = {
      ...baseScreen,
      columns: ["title", { field: "color", renderer: { format: "currency", symbol: "€" } }],
    };
    render(
      <RenderList
        screen={screenWithFmt}
        entity={taskEntity}
        rows={[{ id: "r1", title: "Alpha", color: "42" }]}
        featureName="tasks"
      />,
    );
    expect(screen.getByTestId("cell-r1-color").textContent).toBe("42 €");
  });

  test("__component-renderer with Provider → Component is mounted, value+row+column are passed in", () => {
    const screenWithComp: EntityListScreenDefinition = {
      ...baseScreen,
      columns: ["title", { field: "color", renderer: { react: { __component: "ColorSwatch" } } }],
    };
    render(
      withRenderers(
        <RenderList
          screen={screenWithComp}
          entity={taskEntity}
          rows={[{ id: "r1", title: "Alpha", color: "#abcdef" }]}
          featureName="tasks"
        />,
        { ColorSwatch },
      ),
    );
    expect(screen.getByTestId("swatch")).toBeTruthy();
    expect(screen.getByTestId("swatch-value").textContent).toBe("#abcdef");
    expect(screen.getByTestId("swatch-field").textContent).toBe("color");
    expect(screen.getByTestId("swatch-row-title").textContent).toBe("Alpha");
  });

  test("__component-renderer without registry entry → console.warn + default fallback", () => {
    const screenWithUnknown: EntityListScreenDefinition = {
      ...baseScreen,
      columns: [
        "title",
        { field: "color", renderer: { react: { __component: "MissingRenderer" } } },
      ],
    };
    render(
      withRenderers(
        <RenderList
          screen={screenWithUnknown}
          entity={taskEntity}
          rows={[{ id: "r1", title: "Alpha", color: "#abc" }]}
          featureName="tasks"
        />,
        {},
      ),
    );
    // Default renderer for type=text → raw value
    expect(screen.getByTestId("cell-r1-color").textContent).toBe("#abc");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('columnRenderer "MissingRenderer" not registered'),
    );
  });
});
