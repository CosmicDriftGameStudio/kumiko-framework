// @vitest-environment jsdom
import type { EntityDefinition, EntityListScreenDefinition } from "@kumiko/framework/ui-types";
import { type ColumnRendererProps, ColumnRenderersProvider, RenderList } from "@kumiko/renderer";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "./test-utils";

// Tests für die JSX-Renderer-Form von ListColumn-Spalten:
// `{ react: { __component: "Name" } }` wird via ColumnRenderersProvider
// auf eine echte React-Component aufgelöst. Function- und Default-Pfad
// sind in render-list.test.tsx abgedeckt — hier geht es um die drei
// Cases die mit dem Provider-Lookup zusammenhängen.

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

function withRenderers(ui: ReactNode, map: Record<string, typeof ColorSwatch>): ReactNode {
  return <ColumnRenderersProvider value={map}>{ui}</ColumnRenderersProvider>;
}

describe("RenderList — column-renderer registry", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  afterEach(() => {
    warnSpy.mockClear();
  });

  test("function-renderer pfad bleibt unverändert (Bestand)", () => {
    const screenWithFn: EntityListScreenDefinition = {
      ...baseScreen,
      columns: ["title", { field: "color", renderer: (v) => `[${String(v)}]` }],
    };
    render(
      <RenderList
        screen={screenWithFn}
        entity={taskEntity}
        rows={[{ id: "r1", title: "Alpha", color: "#fff" }]}
        featureName="tasks"
      />,
    );
    expect(screen.getByTestId("cell-r1-color").textContent).toBe("[#fff]");
  });

  test("__component-renderer mit Provider → Component wird gemountet, value+row+column kommen an", () => {
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

  test("__component-renderer ohne Registry-Eintrag → console.warn + Default-Fallback", () => {
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
    // Default-Renderer für type=text → roher Wert
    expect(screen.getByTestId("cell-r1-color").textContent).toBe("#abc");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('columnRenderer "MissingRenderer" not registered'),
    );
  });
});
