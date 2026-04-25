// @vitest-environment jsdom
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@kumiko/framework/ui-types";
import type { Dispatcher } from "@kumiko/headless";
import type { FeatureSchema, NavApi } from "@kumiko/renderer";
import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
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

  test("navAdapter override: eigener Router steuert den aktiven Screen", async () => {
    // Beweist den Nav-Seam: der Default-Adapter liest location.pathname,
    // dieser Memory-Adapter hardcoded die Route. Wenn swap funktioniert,
    // sehen wir den Listen-Screen statt den Form-Screen, ohne `screenQn`
    // zu setzen und ohne `window.history` zu touchen.
    mountRoot();
    const memoryNav: NavApi = {
      route: { screenId: "task-list" },
      navigate: () => {},
      hrefFor: (target) =>
        target.entityId !== undefined
          ? `/${target.screenId}/${target.entityId}`
          : `/${target.screenId}`,
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
