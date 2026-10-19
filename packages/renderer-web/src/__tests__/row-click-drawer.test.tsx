// rowActions kind:"drawer" with rowClick:true: clicking the row body opens the
// drawer with that row's prefill, same as the row-action button does.

import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  EntityDefinition,
  EntityListScreenDefinition,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import type { Dispatcher } from "@cosmicdrift/kumiko-renderer/headless";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen, waitFor, within } from "./test-utils.tsx";

const taskEntity = {
  fields: { title: { type: "text", required: true } },
} as unknown as EntityDefinition;

const renameForm: ActionFormScreenDefinition = {
  id: "task-rename",
  type: "actionForm",
  handler: "tasks:write:task:rename",
  fields: { title: { type: "text", required: true } },
  layout: { sections: [{ fields: ["title"] }] },
};

const rowClickDrawer = {
  kind: "drawer",
  id: "rename",
  label: "actions.rename",
  screen: "task-rename",
  params: { pick: ["title"] },
  rowClick: true,
} as const;

const entityListScreen: EntityListScreenDefinition = {
  id: "task-list",
  type: "entityList",
  entity: "task",
  columns: ["title"],
  rowActions: [rowClickDrawer],
};

const projectionListScreen: ProjectionListScreenDefinition = {
  id: "task-projection",
  type: "projectionList",
  query: "tasks:query:task:overview",
  columns: ["title"],
  rowActions: [rowClickDrawer],
};

const schema: FeatureSchema = {
  featureName: "tasks",
  entities: { task: taskEntity },
  screens: [entityListScreen, projectionListScreen, renameForm],
};

function makeDispatcher(): Dispatcher {
  return createMockDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { rows: [{ id: "r1", title: "Alpha" }], nextCursor: null },
    })) as unknown as Dispatcher["query"],
  });
}

async function clickRowBody(qn: string): Promise<void> {
  const user = userEvent.setup();
  render(
    <DispatcherProvider dispatcher={makeDispatcher()}>
      <KumikoScreen schema={schema} qn={qn} />
    </DispatcherProvider>,
  );
  await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
  await user.click(screen.getByTestId("row-r1"));
}

async function expectDrawerPrefilledFromRow(): Promise<void> {
  const drawer = await screen.findByTestId("toolbar-drawer-rename");
  const input = within(drawer).getByTestId("field-title").querySelector("input");
  expect(input?.value).toBe("Alpha");
}

describe("drawer rowAction with rowClick", () => {
  test("clicking an entityList row opens the drawer with that row's params", async () => {
    await clickRowBody("tasks:screen:task-list");
    await expectDrawerPrefilledFromRow();
  });

  test("clicking a projectionList row opens the drawer with that row's params", async () => {
    await clickRowBody("tasks:screen:task-projection");
    await expectDrawerPrefilledFromRow();
  });
});
