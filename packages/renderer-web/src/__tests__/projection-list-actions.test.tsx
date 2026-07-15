import { describe, expect, mock, test } from "bun:test";
import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
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
