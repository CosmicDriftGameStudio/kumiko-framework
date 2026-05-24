import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { ColumnRendererProps, FeatureSchema, NavApi } from "@cosmicdrift/kumiko-renderer";
import { act, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, type MockInstance, test } from "bun:test";
import type { ClientFeatureDefinition } from "../app/client-plugin";
import { type CreateKumikoAppOptions, createKumikoApp } from "../app/create-app";
import { createMockDispatcher } from "./test-utils";

const taskEntity = {
  fields: {
    title: { type: "text", required: true },
  },
} as unknown as EntityDefinition;

const editScreen: EntityEditScreenDefinition = {
  id: "task-edit",
  type: "entityEdit",
  entity: "task",
  layout: { sections: [{ title: "x", fields: ["title"] }] },
};

const listScreen: EntityListScreenDefinition = {
  id: "task-list",
  type: "entityList",
  entity: "task",
  columns: ["title"],
};

function makeDispatcher(): Dispatcher {
  return createMockDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { rows: [], nextCursor: null },
    })) as unknown as Dispatcher["query"],
  });
}

function mountRoot(id = "root"): HTMLDivElement {
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  const root = document.createElement("div");
  root.id = id;
  document.body.appendChild(root);
  return root as HTMLDivElement;
}

const baseSchema: FeatureSchema = {
  featureName: "tasks",
  entities: { task: taskEntity },
  screens: [editScreen, listScreen],
};

// createKumikoApp ruft createRoot(...).render(...) direkt auf — React 18+
// batcht das in einer concurrent-render-phase, deren State-Updates React
// im Test-Modus als "outside act()" flaggt. Produktions-Code muss nicht in
// act() wissen; der Test übernimmt das Wrapping an der einzigen
// Test-eigenen Aufrufstelle. async weil der erste useEffect-Tick in
// KumikoScreen (useQuery) ebenfalls flushed werden muss.
async function mountApp(options: CreateKumikoAppOptions): Promise<void> {
  await act(async () => {
    createKumikoApp(options);
  });
}

describe("createKumikoApp", () => {
  // createKumikoApp mounts via createRoot into document.body. Reset
  // between tests so a previous test's mount doesn't leak through
  // and fool the next one into finding stale markup.
  beforeEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  test("mounts into #root and renders the first screen by default", async () => {
    mountRoot();
    await mountApp({ schema: baseSchema, dispatcher: makeDispatcher() });
    // First screen is entityEdit → form with the title field.
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    expect(screen.getByTestId("field-title")).toBeTruthy();
  });

  test("screenQn override: mounts the named screen instead of the first", async () => {
    mountRoot();
    await mountApp({
      schema: baseSchema,
      dispatcher: makeDispatcher(),
      screenQn: "tasks:screen:task-list",
    });
    // findBy* retries for the default timeout — lets the async useQuery
    // settle without us fishing for intermediate loading state.
    expect(await screen.findByTestId("render-list-table-empty")).toBeTruthy();
  });

  test("rootId override: mounts into a different DOM id", async () => {
    mountRoot("custom-root");
    await mountApp({
      schema: baseSchema,
      rootId: "custom-root",
      dispatcher: makeDispatcher(),
    });
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    // And the default #root doesn't pick anything up.
    expect(document.getElementById("root")).toBeNull();
  });

  test("missing #root → throws with a helpful message", () => {
    // No DOM node prepped.
    expect(() => createKumikoApp({ schema: baseSchema, dispatcher: makeDispatcher() })).toThrow(
      /#root not found/,
    );
  });

  test("empty schema.screens → throws (nothing to render)", () => {
    mountRoot();
    const empty: FeatureSchema = { ...baseSchema, screens: [] };
    expect(() => createKumikoApp({ schema: empty, dispatcher: makeDispatcher() })).toThrow(
      /no screens/,
    );
  });

  test("clientFeatures.columnRenderers → bei Key-Kollision warnt + last-wins gewinnt", async () => {
    // Zwei Features liefern denselben Renderer-Key — der Merge in
    // create-app warnt und behält den späteren Eintrag (Last-Wins).
    // Beweist dass das bewusste Override-Verhalten nicht silent
    // wegrutscht falls jemand auf "first-wins" refactored.
    const warnSpy: MockInstance<typeof console.warn> = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    function FirstSwatch({ value }: ColumnRendererProps): ReactNode {
      return <span data-testid="ca-first">{String(value)}</span>;
    }
    function SecondSwatch({ value }: ColumnRendererProps): ReactNode {
      return <span data-testid="ca-second">{String(value)}</span>;
    }
    const colorEntity = {
      fields: { color: { type: "text" } },
    } as unknown as EntityDefinition;
    const conflictSchema: FeatureSchema = {
      featureName: "tasks",
      entities: { task: colorEntity },
      screens: [
        {
          id: "color-list",
          type: "entityList",
          entity: "task",
          columns: [{ field: "color", renderer: { react: { __component: "Swatch" } } }],
        },
      ],
    };

    mountRoot();
    await mountApp({
      schema: conflictSchema,
      dispatcher: createMockDispatcher({
        query: (async () => ({
          isSuccess: true,
          data: { rows: [{ id: "r1", color: "#ddd" }], nextCursor: null },
        })) as unknown as Dispatcher["query"],
      }),
      clientFeatures: [
        { name: "first", columnRenderers: { Swatch: FirstSwatch } },
        { name: "second", columnRenderers: { Swatch: SecondSwatch } },
      ],
    });

    // Last-Wins: SecondSwatch ist gemounted, FirstSwatch nicht.
    expect(await screen.findByTestId("ca-second")).toBeTruthy();
    expect(screen.queryByTestId("ca-first")).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('columnRenderer "Swatch" defined by multiple clientFeatures'),
    );

    warnSpy.mockRestore();
  });

  test("clientFeatures.columnRenderers → __component-Renderer mounten echtes Component im DOM", async () => {
    // Beweist die Verdrahtung end-to-end: ClientFeatureDefinition.columnRenderers
    // → Provider in create-app → useColumnRenderer im DataTable-Cell → JSX
    // landet im DOM. Schema deklariert die String-Form, Component lebt nur
    // client-seitig.
    function Swatch({ value, column }: ColumnRendererProps): ReactNode {
      return (
        <span data-testid="ca-swatch">
          <span data-testid="ca-swatch-value">{String(value)}</span>
          <span data-testid="ca-swatch-field">{column.field}</span>
        </span>
      );
    }
    const colorEntity = {
      fields: { title: { type: "text" }, color: { type: "text" } },
    } as unknown as EntityDefinition;
    const colorListScreen: EntityListScreenDefinition = {
      id: "color-list",
      type: "entityList",
      entity: "task",
      columns: ["title", { field: "color", renderer: { react: { __component: "Swatch" } } }],
    };
    const colorSchema: FeatureSchema = {
      featureName: "tasks",
      entities: { task: colorEntity },
      screens: [colorListScreen],
    };
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [{ id: "r1", title: "Alpha", color: "#a1b2c3" }], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });
    const clientFeature: ClientFeatureDefinition = {
      name: "tasks",
      columnRenderers: { Swatch },
    };

    mountRoot();
    await mountApp({
      schema: colorSchema,
      dispatcher,
      clientFeatures: [clientFeature],
    });

    expect(await screen.findByTestId("ca-swatch")).toBeTruthy();
    expect(screen.getByTestId("ca-swatch-value").textContent).toBe("#a1b2c3");
    expect(screen.getByTestId("ca-swatch-field").textContent).toBe("color");
  });

  test("navAdapter override: eigener Router steuert den aktiven Screen", async () => {
    // Beweist den Nav-Seam: der Default-Adapter liest location.pathname,
    // dieser Memory-Adapter hardcoded die Route. Wenn swap funktioniert,
    // sehen wir den Listen-Screen statt den Form-Screen, ohne `screenQn`
    // zu setzen und ohne `window.history` zu touchen.
    mountRoot();
    const memoryNav: NavApi = {
      route: { screenId: "task-list" },
      navigate: () => {},
      replace: () => {},
      hrefFor: (target) =>
        target.entityId !== undefined
          ? `/${target.screenId}/${target.entityId}`
          : `/${target.screenId}`,
      searchParams: {},
      setSearchParams: () => {},
    };
    await mountApp({
      schema: baseSchema,
      dispatcher: makeDispatcher(),
      navAdapter: () => memoryNav,
    });
    expect(await screen.findByTestId("render-list-table-empty")).toBeTruthy();
    // Und definitiv NICHT der Edit-Screen (der wäre die Default-Landing).
    expect(screen.queryByTestId("render-edit-form")).toBeNull();
  });
});
