// A writeForm with `placement: "footer"` sits under the body (under every tab) and its writeHandler
// actions send the form values together with their own payload in one write.

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema, NavApi } from "../../index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { act, createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils.tsx";

const footerScreen: ProjectionDetailScreenDefinition = {
  id: "note-detail",
  type: "projectionDetail",
  query: "notes:query:note:detail",
  idParam: "id",
  layout: {
    mode: "tabs",
    sections: [
      { id: "first", tabLabel: "First", title: "First", fields: ["title"] },
      { id: "second", tabLabel: "Second", title: "Second", fields: ["title"] },
      {
        kind: "writeForm",
        placement: "footer",
        fieldDefs: { message: { type: "text", required: true } },
        fields: ["message"],
        actions: [
          {
            kind: "writeHandler",
            id: "send",
            label: "Send",
            handler: "notes:write:send",
            payload: { map: { noteId: "id" } },
          },
        ],
      },
    ],
  },
};

const schema: FeatureSchema = { featureName: "notes", entities: {}, screens: [footerScreen] };

function renderTab(tab: string, writes: Array<{ type: string; payload: unknown }>): void {
  const dispatcher: Dispatcher = createMockDispatcher({
    query: async () => ({ isSuccess: true, data: { id: "note-1", title: "Hello" } }),
    write: async (type: string, payload: unknown) => {
      writes.push({ type, payload });
      return { isSuccess: true, data: null };
    },
  });
  const navApi: NavApi = {
    route: undefined,
    navigate: () => {},
    replace: () => {},
    hrefFor: () => "",
    searchParams: { tab },
    setSearchParams: () => {},
  };
  render(
    <NavProvider value={navApi}>
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="notes:screen:note-detail" entityId="note-1" />
      </DispatcherProvider>
    </NavProvider>,
  );
}

async function messageInput(): Promise<HTMLInputElement> {
  return waitFor(() => {
    const input = screen.queryByTestId("field-message")?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("message input not rendered yet");
    return input;
  });
}

describe("projectionDetail footer writeForm", () => {
  test("the footer renders on every tab and is no tab of its own", async () => {
    renderTab("first", []);
    await waitFor(() => screen.getByTestId("write-form-footer"));
    expect(screen.queryByText("Second")).not.toBeNull();
    expect(screen.getAllByTestId("write-form-footer")).toHaveLength(1);
  });

  test("the footer is also there on the second tab", async () => {
    renderTab("second", []);
    await waitFor(() => screen.getByTestId("write-form-footer"));
  });

  test("an action sends its payload and the form values in one write", async () => {
    const writes: Array<{ type: string; payload: unknown }> = [];
    renderTab("first", writes);
    fireEvent.change(await messageInput(), { target: { value: "Looks good" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-action-send"));
      await Promise.resolve();
    });

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      type: "notes:write:send",
      payload: { noteId: "note-1", message: "Looks good" },
    });
  });

  test("an invalid form sends nothing", async () => {
    const writes: Array<{ type: string; payload: unknown }> = [];
    renderTab("first", writes);
    await messageInput();

    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-action-send"));
      await Promise.resolve();
    });

    expect(writes).toEqual([]);
  });
});
