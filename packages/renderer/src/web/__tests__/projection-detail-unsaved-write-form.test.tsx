import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { act, createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils.tsx";

const detailScreen: ProjectionDetailScreenDefinition = {
  id: "session-detail",
  type: "projectionDetail",
  query: "sessions:query:user-session:detail",
  idParam: "id",
  layout: { sections: [{ title: "Session", fields: ["userId"] }] },
};

describe("KumikoScreen / projectionDetail actions with unsaved writeForm input", () => {
  const noteScreen: ProjectionDetailScreenDefinition = {
    ...detailScreen,
    actions: [
      { kind: "writeHandler", id: "close", label: "Close", handler: "sessions:write:close" },
      {
        kind: "writeHandler",
        id: "save-note",
        label: "Save note",
        handler: "sessions:write:save-note",
      },
    ],
    layout: {
      sections: [
        { title: "Session", fields: ["userId"] },
        {
          kind: "writeForm",
          title: "Add note",
          fieldDefs: { body: { type: "text" } },
          fields: ["body"],
          handler: "sessions:write:add-note",
        },
        {
          kind: "writeForm",
          title: "Note to send",
          fieldDefs: { message: { type: "text" } },
          fields: ["message"],
          handler: "sessions:write:save-note",
          submitWith: "save-note",
        },
      ],
    },
  };
  const noteSchema: FeatureSchema = {
    featureName: "sessions",
    entities: {},
    screens: [noteScreen],
  };

  function renderNoteScreen(writes: string[]): void {
    const dispatcher: Dispatcher = createMockDispatcher({
      query: async () => ({ isSuccess: true, data: { id: "sess-1", userId: "user-42" } }),
      write: async (type: string) => {
        writes.push(type);
        return { isSuccess: true, data: null };
      },
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={noteSchema} qn="sessions:screen:session-detail" entityId="sess-1" />
      </DispatcherProvider>,
    );
  }

  test("an action that does not submit the typed note asks before discarding it", async () => {
    const writes: string[] = [];
    renderNoteScreen(writes);
    const bodyInput = await waitFor(() => {
      const input = screen.queryByTestId("field-body")?.querySelector("input");
      if (!(input instanceof HTMLInputElement)) throw new Error("body input not rendered yet");
      return input;
    });
    fireEvent.change(bodyInput, { target: { value: "Typed, not saved" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-action-close"));
      await Promise.resolve();
    });

    const dialog = await screen.findByTestId("render-edit-action-close-dialog");
    expect(dialog.textContent).toContain("You have unsaved changes in this form.");
    expect(writes).toEqual([]);
  });

  test("without unsaved input the action runs directly", async () => {
    const writes: string[] = [];
    renderNoteScreen(writes);
    await waitFor(() => screen.getByTestId("render-edit-action-close"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-action-close"));
      await Promise.resolve();
    });

    await waitFor(() => expect(writes).toEqual(["sessions:write:close"]));
    expect(screen.queryByTestId("render-edit-action-close-dialog")).toBeNull();
  });

  test("the action that submits the typed form sends it without a discard question", async () => {
    const writes: string[] = [];
    renderNoteScreen(writes);
    const messageInput = await waitFor(() => {
      const input = screen.queryByTestId("field-message")?.querySelector("input");
      if (!(input instanceof HTMLInputElement)) throw new Error("message input not rendered yet");
      return input;
    });
    fireEvent.change(messageInput, { target: { value: "Send this" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-action-save-note"));
      await Promise.resolve();
    });

    await waitFor(() => expect(writes).toEqual(["sessions:write:save-note"]));
    expect(screen.queryByTestId("render-edit-action-save-note-dialog")).toBeNull();
  });
});

describe("KumikoScreen / projectionDetail submitWith action beside another typed form", () => {
  test("the submitting action still asks when a different form holds unsaved input", async () => {
    const writes: string[] = [];
    const dispatcher: Dispatcher = createMockDispatcher({
      query: async () => ({ isSuccess: true, data: { id: "sess-1", userId: "user-42" } }),
      write: async (type: string) => {
        writes.push(type);
        return { isSuccess: true, data: null };
      },
    });
    const twoFormScreen: ProjectionDetailScreenDefinition = {
      ...detailScreen,
      actions: [
        {
          kind: "writeHandler",
          id: "save-note",
          label: "Save note",
          handler: "sessions:write:save-note",
        },
      ],
      layout: {
        sections: [
          {
            kind: "writeForm",
            title: "Add note",
            fieldDefs: { body: { type: "text" } },
            fields: ["body"],
            handler: "sessions:write:add-note",
          },
          {
            kind: "writeForm",
            title: "Note to send",
            fieldDefs: { message: { type: "text" } },
            fields: ["message"],
            handler: "sessions:write:save-note",
            submitWith: "save-note",
          },
        ],
      },
    };
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={{ featureName: "sessions", entities: {}, screens: [twoFormScreen] }}
          qn="sessions:screen:session-detail"
          entityId="sess-1"
        />
      </DispatcherProvider>,
    );
    const inputOf = (fieldName: string): HTMLInputElement => {
      const input = screen.queryByTestId(`field-${fieldName}`)?.querySelector("input");
      if (!(input instanceof HTMLInputElement))
        throw new Error(`${fieldName} input not rendered yet`);
      return input;
    };
    fireEvent.change(await waitFor(() => inputOf("body")), { target: { value: "Typed note" } });
    fireEvent.change(inputOf("message"), { target: { value: "Send this" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-action-save-note"));
      await Promise.resolve();
    });

    await screen.findByTestId("render-edit-action-save-note-dialog");
    expect(writes).toEqual([]);
  });
});
