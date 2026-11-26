// A writeForm with `placement: "footer"` sits under the body (under every tab) and its writeHandler
// actions send the form values together with their own payload in one write.

import { describe, expect, test } from "bun:test";
import type {
  ProjectionDetailScreenDefinition,
  RowAction,
} from "@cosmicdrift/kumiko-framework/ui-types";
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

const screenWithoutFooter: ProjectionDetailScreenDefinition = {
  ...footerScreen,
  layout: {
    mode: "tabs",
    sections: footerScreen.layout.sections.filter((section) => !("kind" in section)),
  },
};

function renderTab(
  tab: string,
  writes: Array<{ type: string; payload: unknown }>,
  featureSchema: FeatureSchema = schema,
): void {
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
        <KumikoScreen schema={featureSchema} qn="notes:screen:note-detail" entityId="note-1" />
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

  test("on the full page body and footer share one h-full column and the body pane does not scroll", async () => {
    renderTab("first", []);
    const footer = await waitFor(() => screen.getByTestId("write-form-footer"));
    const form = screen.getByTestId("render-edit-form");
    const column = footer.parentElement;
    expect(column?.classList.contains("h-full")).toBe(true);
    expect(footer.classList.contains("shrink-0")).toBe(true);
    const bodyPane = form.closest(".min-h-0.flex-1");
    expect(bodyPane?.parentElement).toBe(column);
    expect(form.closest(".overflow-y-auto")).toBeNull();
  });

  test("without a footer form the body gets no column wrapper", async () => {
    renderTab("first", [], {
      featureName: "notes",
      entities: {},
      screens: [screenWithoutFooter],
    });
    const form = await waitFor(() => screen.getByTestId("render-edit-form"));
    expect(screen.queryByTestId("write-form-footer")).toBeNull();
    expect(form.closest(".min-h-0.flex-1")).toBeNull();
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

type Call = { readonly type: string; readonly payload: unknown };

const failingSend = {
  isSuccess: false as const,
  error: { code: "BOOM", httpStatus: 422, i18nKey: "errors.boom", message: "Choose a reason" },
};

function renderDetail(
  detail: ProjectionDetailScreenDefinition,
  tab: string,
  calls: Call[],
  write: (type: string) => Awaited<ReturnType<Dispatcher["write"]>>,
  extraScreens: FeatureSchema["screens"] = [],
): void {
  const dispatcher: Dispatcher = createMockDispatcher({
    query: async (type: string) =>
      type === "notes:query:note:items"
        ? { isSuccess: true, data: { rows: [{ id: "p1", label: "Line 1" }], nextCursor: null } }
        : { isSuccess: true, data: { id: "note-1", title: "Hello" } },
    write: async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return write(type);
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
        <KumikoScreen
          schema={{ featureName: "notes", entities: {}, screens: [detail, ...extraScreens] }}
          qn="notes:screen:note-detail"
          entityId="note-1"
        />
      </DispatcherProvider>
    </NavProvider>,
  );
}

const sendAction = {
  kind: "writeHandler" as const,
  id: "send",
  label: "Send",
  handler: "notes:write:send",
  payload: { map: { noteId: "id" } },
};

const footerWriteForm = (actions: readonly RowAction[]) => ({
  kind: "writeForm" as const,
  placement: "footer" as const,
  fieldDefs: { message: { type: "text" as const } },
  fields: ["message"],
  actions,
});

describe("projectionDetail action error banner", () => {
  const withItems: ProjectionDetailScreenDefinition = {
    ...footerScreen,
    layout: {
      mode: "tabs",
      sections: [
        { id: "first", tabLabel: "First", title: "First", fields: ["title"] },
        {
          id: "items",
          tabLabel: "Items",
          kind: "relatedList",
          title: "Items",
          query: "notes:query:note:items",
          parentParam: "noteId",
          columns: [{ field: "label", label: "notes:col:label" }],
          rowActions: [
            { kind: "writeHandler", id: "close", label: "Close", handler: "notes:write:close" },
          ],
        },
        footerWriteForm([sendAction]),
      ],
    },
  };

  test("stays after a failed footer action and goes with the next successful related-list row action", async () => {
    const calls: Call[] = [];
    renderDetail(withItems, "items", calls, (type) =>
      type === "notes:write:send" ? failingSend : { isSuccess: true, data: {} },
    );
    await act(async () => {
      fireEvent.click(await waitFor(() => screen.getByTestId("render-edit-action-send")));
      await Promise.resolve();
    });
    await waitFor(() => screen.getByTestId("render-edit-action-error"));

    await act(async () => {
      fireEvent.click(await waitFor(() => screen.getByTestId("row-p1-action-close")));
      await Promise.resolve();
    });

    await waitFor(() => expect(calls.map((call) => call.type)).toContain("notes:write:close"));
    await waitFor(() => expect(screen.queryByTestId("render-edit-action-error")).toBeNull());
  });
});

describe("projectionDetail footer danger actions", () => {
  const noteForm: FeatureSchema["screens"][number] = {
    id: "note-form",
    type: "actionForm",
    handler: "notes:write:note",
    fields: { note: { type: "text" } },
    layout: { sections: [{ fields: ["note"] }] },
  };
  const withDanger: ProjectionDetailScreenDefinition = {
    ...footerScreen,
    layout: {
      mode: "tabs",
      sections: [
        { id: "first", tabLabel: "First", title: "First", fields: ["title"] },
        { id: "second", tabLabel: "Second", title: "Second", fields: ["title"] },
        footerWriteForm([
          { ...sendAction, style: "danger" },
          {
            kind: "drawer",
            id: "open-form",
            label: "Open form",
            screen: "note-form",
            style: "danger",
          },
        ]),
      ],
    },
  };

  test("a danger action is an outlined button with destructive text, not a filled red one", async () => {
    renderDetail(withDanger, "first", [], () => ({ isSuccess: true, data: {} }), [noteForm]);
    const button = await waitFor(() => screen.getByTestId("render-edit-action-send"));
    expect(button.className).toContain("text-destructive");
    expect(button.className).not.toContain("bg-destructive");
    expect(button.className).toContain("border");
  });

  test("a danger drawer action opens its drawer without a confirm", async () => {
    renderDetail(withDanger, "first", [], () => ({ isSuccess: true, data: {} }), [noteForm]);
    fireEvent.click(await waitFor(() => screen.getByTestId("render-edit-action-open-form")));

    await waitFor(() => screen.getByTestId("toolbar-drawer-open-form"));
    expect(screen.queryByTestId("render-edit-action-open-form-dialog")).toBeNull();
  });
});
