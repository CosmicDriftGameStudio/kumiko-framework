import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import {
  type ClientActionHandler,
  ClientActionsProvider,
  DispatcherProvider,
  type FeatureSchema,
  KumikoScreen,
} from "../../index.ts";
import { ToastActionNotifier } from "../app/toast-action-notifier.tsx";
import { ToastProvider } from "../primitives/toast.tsx";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils.tsx";

type RowActionOverrides = Partial<
  Extract<
    NonNullable<ProjectionListScreenDefinition["rowActions"]>[number],
    { kind: "clientAction" }
  >
>;

function schemaWith(overrides: RowActionOverrides): FeatureSchema {
  const screenDefinition: ProjectionListScreenDefinition = {
    id: "user-list",
    type: "projectionList",
    query: "admin:query:users",
    columns: [{ field: "email", label: "admin:col:email" }],
    rowActions: [
      {
        kind: "clientAction",
        id: "send-reset",
        label: "admin:action:send-reset",
        action: "admin:send-reset",
        ...overrides,
      },
    ],
  };
  return { featureName: "admin", entities: {}, screens: [screenDefinition] };
}

let queryCalls = 0;

function makeDispatcher(): Dispatcher {
  return createMockDispatcher({
    query: (async () => {
      queryCalls += 1;
      return {
        isSuccess: true,
        data: { rows: [{ id: "u1", email: "ada@example.com" }], nextCursor: null },
      };
    }) as unknown as Dispatcher["query"],
  });
}

async function renderList(
  schema: FeatureSchema,
  handlers: Readonly<Record<string, ClientActionHandler>>,
): Promise<void> {
  render(
    <ToastProvider>
      <ToastActionNotifier>
        <ClientActionsProvider value={handlers}>
          <DispatcherProvider dispatcher={makeDispatcher()}>
            <KumikoScreen schema={schema} qn="admin:screen:user-list" />
          </DispatcherProvider>
        </ClientActionsProvider>
      </ToastActionNotifier>
    </ToastProvider>,
  );
  await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy());
}

beforeEach(() => {
  queryCalls = 0;
});

describe("clientAction row actions", () => {
  test("passes the row id by default, shows the success toast and refetches the list", async () => {
    const handler = mock(async (_payload: Readonly<Record<string, unknown>>) => ({
      ok: true as const,
    }));
    await renderList(schemaWith({ successMessage: "admin:toast:reset-sent" }), {
      "admin:send-reset": handler,
    });
    const queriesBefore = queryCalls;

    fireEvent.click(screen.getByTestId("row-u1-action-send-reset"));

    expect(await screen.findByText("admin:toast:reset-sent")).toBeTruthy();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toEqual({ id: "u1" });
    await waitFor(() => expect(queryCalls).toBeGreaterThan(queriesBefore));
  });

  test("passes the declared payload picked from the row", async () => {
    const handler = mock(async (_payload: Readonly<Record<string, unknown>>) => ({
      ok: true as const,
    }));
    await renderList(schemaWith({ payload: { pick: ["email"] } }), { "admin:send-reset": handler });

    fireEvent.click(screen.getByTestId("row-u1-action-send-reset"));

    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(handler.mock.calls[0]?.[0]).toEqual({ email: "ada@example.com" });
  });

  test("shows the handler's failure message as an error toast and does not refetch", async () => {
    await renderList(schemaWith({}), {
      "admin:send-reset": async () => ({ ok: false, message: "admin:error:no-mailbox" }),
    });
    const queriesBefore = queryCalls;

    fireEvent.click(screen.getByTestId("row-u1-action-send-reset"));

    expect(await screen.findByText("admin:error:no-mailbox")).toBeTruthy();
    expect(screen.getByText("Action failed")).toBeTruthy();
    expect(queryCalls).toBe(queriesBefore);
  });

  describe("with console.error observed", () => {
    let consoleError: ReturnType<typeof spyOn>;
    beforeEach(() => {
      consoleError = spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => {
      consoleError.mockRestore();
    });

    test("an unregistered action name shows an error toast and logs the name", async () => {
      await renderList(schemaWith({ action: "admin:not-registered" }), {});

      fireEvent.click(screen.getByTestId("row-u1-action-send-reset"));

      expect(await screen.findByText("This action is not available in this app.")).toBeTruthy();
      expect(consoleError.mock.calls.flat().join(" ")).toContain("admin:not-registered");
    });

    test("a throwing handler shows the generic error toast", async () => {
      await renderList(schemaWith({}), {
        "admin:send-reset": async () => {
          throw new Error("socket closed");
        },
      });

      fireEvent.click(screen.getByTestId("row-u1-action-send-reset"));

      expect(await screen.findByText("The action could not be completed.")).toBeTruthy();
      expect(screen.queryByText("socket closed")).toBeNull();
    });
  });

  test("a confirm dialog gates the handler until confirmed", async () => {
    const handler = mock(async (_payload: Readonly<Record<string, unknown>>) => ({
      ok: true as const,
    }));
    await renderList(schemaWith({ confirm: "admin:confirm:send-reset" }), {
      "admin:send-reset": handler,
    });

    fireEvent.click(screen.getByTestId("row-u1-action-send-reset"));
    expect(await screen.findByText("admin:confirm:send-reset")).toBeTruthy();
    expect(handler).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("row-u1-action-send-reset-dialog-confirm"));
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  });
});
