import { describe, expect, mock, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils";

// writeHandler-Row/Toolbar-Actions auf projectionList — der entityList-
// Dispatch-Pfad gilt jetzt auch hier (vorher v1: nur navigate).

const projectionScreen: ProjectionListScreenDefinition = {
  id: "maintenance-list",
  type: "projectionList",
  query: "status:query:maintenance:upcoming",
  columns: [{ field: "name", label: "status:col:name" }],
  rowActions: [
    {
      kind: "writeHandler",
      id: "start",
      label: "status:action:start",
      handler: "status:write:maintenance:start",
    },
  ],
  toolbarActions: [
    {
      kind: "writeHandler",
      id: "sync",
      label: "status:action:sync",
      handler: "status:write:maintenance:sync",
      payload: { source: "manual" },
    },
  ],
};

const schema: FeatureSchema = {
  featureName: "status",
  entities: {},
  screens: [projectionScreen],
};

function makeDispatcher(write: Dispatcher["write"]): Dispatcher {
  return {
    ...createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [{ id: "m1", name: "DB-Upgrade" }], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    }),
    write,
  };
}

describe("projectionList writeHandler-Actions", () => {
  test("Row-Action dispatcht den Handler mit Default-Payload {id}", async () => {
    const write = mock(async (_type: string, _payload: unknown) => ({
      isSuccess: true,
      data: {},
    }));
    render(
      <DispatcherProvider dispatcher={makeDispatcher(write as unknown as Dispatcher["write"])}>
        <KumikoScreen schema={schema} qn="status:screen:maintenance-list" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByText("DB-Upgrade")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "status:action:start" }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0]?.[0]).toBe("status:write:maintenance:start");
    expect(write.mock.calls[0]?.[1]).toEqual({ id: "m1" });
  });

  test("Toolbar-Action dispatcht den Handler mit deklariertem Payload", async () => {
    const write = mock(async (_type: string, _payload: unknown) => ({
      isSuccess: true,
      data: {},
    }));
    render(
      <DispatcherProvider dispatcher={makeDispatcher(write as unknown as Dispatcher["write"])}>
        <KumikoScreen schema={schema} qn="status:screen:maintenance-list" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByText("DB-Upgrade")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "status:action:sync" }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0]?.[0]).toBe("status:write:maintenance:sync");
    expect(write.mock.calls[0]?.[1]).toEqual({ source: "manual" });
  });

  // Prod-Bug 2026-06-07 (siehe useRowActionTrigger): ein verschluckter
  // Write-Fehler sah für den User wie "nichts passiert" aus. Row- UND
  // Toolbar-Action auf projectionList müssen denselben Surfacing-Pfad wie
  // entityList nehmen (Toast statt stiller no-op).
  test("Row-Action-Fehler wird als Toast surfaced, nicht verschluckt", async () => {
    const write = mock(async (_type: string, _payload: unknown) => ({
      isSuccess: false,
      error: { code: "internal_error", httpStatus: 500, message: "maintenance start failed" },
    }));
    const { ToastProvider } = await import("../primitives/toast");
    render(
      <ToastProvider>
        <DispatcherProvider dispatcher={makeDispatcher(write as unknown as Dispatcher["write"])}>
          <KumikoScreen schema={schema} qn="status:screen:maintenance-list" />
        </DispatcherProvider>
      </ToastProvider>,
    );
    await waitFor(() => expect(screen.getByText("DB-Upgrade")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "status:action:start" }));
    expect(await screen.findByText("maintenance start failed")).toBeTruthy();
  });

  test("Toolbar-Action-Fehler wird als Toast surfaced, nicht verschluckt", async () => {
    const write = mock(async (_type: string, _payload: unknown) => ({
      isSuccess: false,
      error: { code: "internal_error", httpStatus: 500, message: "maintenance sync failed" },
    }));
    const { ToastProvider } = await import("../primitives/toast");
    render(
      <ToastProvider>
        <DispatcherProvider dispatcher={makeDispatcher(write as unknown as Dispatcher["write"])}>
          <KumikoScreen schema={schema} qn="status:screen:maintenance-list" />
        </DispatcherProvider>
      </ToastProvider>,
    );
    await waitFor(() => expect(screen.getByText("DB-Upgrade")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "status:action:sync" }));
    expect(await screen.findByText("maintenance sync failed")).toBeTruthy();
  });
});

// toolbarActions kind:"drawer" (fw#2225) — same shared ToolbarDrawerHost as
// entityList, wired into ProjectionListBody's toolbarActions builder.
describe("projectionList toolbarActions drawer-kind (fw#2225)", () => {
  const noteForm: ActionFormScreenDefinition = {
    id: "maintenance-note",
    type: "actionForm",
    handler: "status:write:maintenance:note",
    fields: { note: { type: "text", required: true } },
    layout: { sections: [{ fields: ["note"] }] },
  };
  const screenWithDrawer: ProjectionListScreenDefinition = {
    ...projectionScreen,
    toolbarActions: [
      {
        kind: "drawer",
        id: "add-note",
        label: "status:action:add-note",
        screen: "maintenance-note",
      },
    ],
  };
  const drawerSchema: FeatureSchema = {
    featureName: "status",
    entities: {},
    screens: [screenWithDrawer, noteForm],
  };

  test("Click opens the Drawer; submit dispatches the handler, closes the Drawer, and reloads the list", async () => {
    let queryCallCount = 0;
    const write = mock(async (_type: string, _payload: unknown) => ({
      isSuccess: true,
      data: {},
    }));
    const dispatcher: Dispatcher = {
      ...createMockDispatcher({
        query: (async () => {
          queryCallCount += 1;
          return {
            isSuccess: true,
            data: { rows: [{ id: "m1", name: "DB-Upgrade" }], nextCursor: null },
          };
        }) as unknown as Dispatcher["query"],
      }),
      write: write as unknown as Dispatcher["write"],
    };
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={drawerSchema} qn="status:screen:maintenance-list" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByText("DB-Upgrade")).toBeTruthy());
    expect(screen.queryByTestId("field-note")).toBeNull();

    fireEvent.click(screen.getByTestId("render-list-toolbar-action-add-note"));
    expect(screen.getByTestId("render-edit-form")).toBeTruthy();
    const queryCallsBeforeSubmit = queryCallCount;

    const noteInput = screen.getByTestId("field-note").querySelector("input");
    if (noteInput === null) throw new Error("expected an <input> inside field-note");
    fireEvent.change(noteInput, { target: { value: "hello" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0]?.[0]).toBe("status:write:maintenance:note");
    await waitFor(() => expect(screen.queryByTestId("render-edit-form")).toBeNull());
    await waitFor(() => expect(queryCallCount).toBeGreaterThan(queryCallsBeforeSubmit));
  });
});
