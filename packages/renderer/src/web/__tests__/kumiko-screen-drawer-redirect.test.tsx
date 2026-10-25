import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  EntityListScreenDefinition,
  ProjectionDetailScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema, NavTarget } from "../../index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { clickSubmitOnceEnabled, schema } from "./_kumiko-screen-helpers.tsx";
import { fireEvent, makeDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const hostList: EntityListScreenDefinition = {
  id: "task-list",
  type: "entityList",
  entity: "task",
  columns: ["title"],
  toolbarActions: [
    { kind: "drawer", id: "add-note", label: "actions.addNote", screen: "task-note" },
  ],
};

const detailScreen: ProjectionDetailScreenDefinition = {
  id: "task-detail",
  type: "projectionDetail",
  query: "tasks:query:task:detail",
  fields: ["title"],
} as unknown as ProjectionDetailScreenDefinition;

function noteForm(redirect: ActionFormScreenDefinition["redirect"]): ActionFormScreenDefinition {
  return {
    id: "task-note",
    type: "actionForm",
    handler: "tasks:write:task:note",
    fields: { note: { type: "text", required: true } },
    layout: { sections: [{ fields: ["note"] }] },
    ...(redirect !== undefined && { redirect }),
  };
}

async function submitDrawer(redirect: ActionFormScreenDefinition["redirect"]): Promise<{
  navigateCalls: NavTarget[];
}> {
  const featureSchema: FeatureSchema = {
    ...schema,
    screens: [hostList, noteForm(redirect), detailScreen],
  };
  const navigateCalls: NavTarget[] = [];
  const nav = {
    route: { screenId: "task-list" },
    navigate: (target: NavTarget) => {
      navigateCalls.push(target);
    },
    replace: () => undefined,
    hrefFor: () => "",
    searchParams: {},
    setSearchParams: () => undefined,
  };
  const dispatcher = makeDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { rows: [], nextCursor: null },
    })) as unknown as Dispatcher["query"],
    write: (async () => ({
      isSuccess: true,
      data: { id: "new-1" },
    })) as unknown as Dispatcher["write"],
  });
  const user = userEvent.setup();
  render(
    <NavProvider value={nav}>
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={featureSchema} qn="tasks:screen:task-list" />
      </DispatcherProvider>
    </NavProvider>,
  );
  await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
  await user.click(screen.getByTestId("render-list-toolbar-action-add-note"));
  const noteInput = screen.getByTestId("field-note").querySelector("input");
  if (noteInput === null) throw new Error("expected an <input> inside field-note");
  fireEvent.change(noteInput, { target: { value: "hello" } });
  await clickSubmitOnceEnabled();
  await waitFor(() => expect(screen.queryByTestId("render-edit-form")).toBeNull());
  return { navigateCalls };
}

describe("drawer-hosted actionForm redirect", () => {
  test("closes the drawer, then navigates to an object redirect with the id from the result", async () => {
    const { navigateCalls } = await submitDrawer({ screen: "task-detail", idFrom: "id" });
    await waitFor(() =>
      expect(navigateCalls).toEqual([{ screenId: "task-detail", entityId: "new-1" }]),
    );
  });

  test("a redirect onto the host screen closes and refetches without navigating", async () => {
    const { navigateCalls } = await submitDrawer("task-list");
    expect(navigateCalls).toEqual([]);
  });
});
