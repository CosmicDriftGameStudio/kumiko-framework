import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  ProjectionDetailScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { clickSubmitOnceEnabled } from "./_kumiko-screen-helpers.tsx";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils.tsx";

const DETAIL_QUERY = "apps:query:app:detail";

function schemaWith(appIdField: ActionFormScreenDefinition["layout"]["sections"]): FeatureSchema {
  const noteForm: ActionFormScreenDefinition = {
    id: "app-note",
    type: "actionForm",
    handler: "apps:write:app:note",
    fields: { appId: { type: "text" }, note: { type: "text", required: true } },
    layout: { sections: appIdField },
  };
  const detail: ProjectionDetailScreenDefinition = {
    id: "app-detail",
    type: "projectionDetail",
    query: DETAIL_QUERY,
    layout: {
      sections: [
        { title: "App", fields: ["name"] },
        {
          kind: "relatedList",
          title: "Notes",
          query: "apps:query:app:notes",
          columns: [{ field: "text", label: "Text" }],
          toolbarActions: [
            {
              kind: "drawer",
              id: "add-note",
              label: "actions.addNote",
              screen: "app-note",
              params: { map: { appId: "id" } },
            },
          ],
        },
      ],
    },
  };
  return { featureName: "apps", entities: {}, screens: [detail, noteForm] };
}

async function openDrawerAndSubmit(schema: FeatureSchema) {
  const writes: { type: string; payload: unknown }[] = [];
  const dispatcher: Dispatcher = createMockDispatcher({
    query: (async (type: string) =>
      type === DETAIL_QUERY
        ? { isSuccess: true, data: { id: "app-7", name: "My app" } }
        : {
            isSuccess: true,
            data: { rows: [], nextCursor: null },
          }) as unknown as Dispatcher["query"],
    write: (async (type: string, payload: unknown) => {
      writes.push({ type, payload });
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
  });
  const user = userEvent.setup();
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <KumikoScreen schema={schema} qn="apps:screen:app-detail" entityId="app-7" />
    </DispatcherProvider>,
  );
  await waitFor(() => screen.getByTestId("render-list-toolbar-action-add-note"));
  await user.click(screen.getByTestId("render-list-toolbar-action-add-note"));
  const noteInput = screen.getByTestId("field-note").querySelector("input");
  if (noteInput === null) throw new Error("expected an <input> inside field-note");
  fireEvent.change(noteInput, { target: { value: "hello" } });
  await clickSubmitOnceEnabled();
  await waitFor(() => expect(writes.length).toBe(1));
  return writes[0];
}

describe("relatedList toolbar drawer params (through the real screen)", () => {
  test("a layout-hidden field receives the parent id and submits it", async () => {
    const write = await openDrawerAndSubmit(
      schemaWith([{ fields: [{ field: "appId", visible: false }, "note"] }]),
    );
    expect(write?.payload).toMatchObject({ appId: "app-7", note: "hello" });
  });

  test("a field missing from the layout is not prefilled (renderable-fields gate)", async () => {
    const write = await openDrawerAndSubmit(schemaWith([{ fields: ["note"] }]));
    expect(write?.payload).not.toHaveProperty("appId", "app-7");
  });
});
