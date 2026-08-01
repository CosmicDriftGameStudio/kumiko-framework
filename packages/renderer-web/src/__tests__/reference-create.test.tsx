// #1681: a reference field can create a missing target record right from
// the combobox. Covers the full chain in one test — every link (screen
// resolution across features, dialog host, create dispatch, returning the
// new id, refetching the lookup list) fails the test if it breaks.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import {
  AppFeaturesProvider,
  DispatcherProvider,
  type FeatureSchema,
  KumikoScreen,
} from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils";

const taskEntity = {
  fields: {
    title: { type: "text", required: true },
    assignee: { type: "reference", entity: "catalog:widget" },
    tags: { type: "reference", entity: "catalog:widget", multiple: true },
  },
} as unknown as EntityDefinition;

const taskEditScreen: EntityEditScreenDefinition = {
  id: "task-edit",
  type: "entityEdit",
  entity: "task",
  layout: { sections: [{ title: "Basics", fields: ["title", "assignee", "tags"] }] },
};

const tasksSchema: FeatureSchema = {
  featureName: "tasks",
  entities: { task: taskEntity },
  screens: [taskEditScreen],
};

const widgetEntity = {
  fields: { name: { type: "text", required: true } },
} as unknown as EntityDefinition;

const widgetCreateScreen: EntityEditScreenDefinition = {
  id: "widget-edit",
  type: "entityEdit",
  entity: "widget",
  layout: { sections: [{ title: "Basics", fields: ["name"] }] },
};

const catalogSchema: FeatureSchema = {
  featureName: "catalog",
  entities: { widget: widgetEntity },
  screens: [widgetCreateScreen],
};

function makeDispatcher(): Dispatcher & { readonly writes: string[] } {
  const writes: string[] = [];
  // The lookup query only knows about newly created widgets AFTER the
  // create-write — pins the refetch: without it, the options list (and
  // thus the label of the newly selected value) would stay empty.
  const createdIds: string[] = [];
  const dispatcher = createMockDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { rows: createdIds.map((id) => ({ id })) },
    })) as unknown as Dispatcher["query"],
    write: (async (type: string) => {
      writes.push(type);
      const id = `widget-${createdIds.length + 1}`;
      createdIds.push(id);
      return { isSuccess: true, data: { kind: "save", id } };
    }) as unknown as Dispatcher["write"],
  });
  return { ...dispatcher, writes };
}

describe("Reference-field create-in-place (#1681)", () => {
  test("+ Create öffnet den Create-Screen des Zielfeatures, Submit wählt die neue id + refetcht die Liste", async () => {
    const user = userEvent.setup();
    const dispatcher = makeDispatcher();

    render(
      <AppFeaturesProvider features={[tasksSchema, catalogSchema]}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={tasksSchema} qn="tasks:screen:task-edit" />
        </DispatcherProvider>
      </AppFeaturesProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    await user.click(screen.getByTestId("combobox-kumiko-edit-assignee"));
    const createButton = await screen.findByTestId("combobox-kumiko-edit-assignee-create");
    await user.click(createButton);

    // The "widget" create-dialog is mounted — its own form field ("name")
    // is visible. Two "render-edit-submit" buttons now exist (the host
    // form behind it + the dialog form) — the dialog portal mounts last,
    // so its button is the last one in the DOM.
    const nameInput = (await screen.findByTestId("field-name")).querySelector("input");
    if (!nameInput) throw new Error("expected name input in create dialog");
    await user.type(nameInput, "Widget A");
    const submitButtons = screen.getAllByTestId("render-edit-submit");
    await user.click(submitButtons[submitButtons.length - 1] as HTMLElement);

    // Dispatch went to the TARGET feature's ("catalog") qualified create
    // handler, not the host feature's ("tasks").
    await waitFor(() => expect(dispatcher.writes.length).toBe(1));
    expect(dispatcher.writes[0]).toBe("catalog:write:widget:create");

    // Dialog closes, the reference field shows the newly created id as
    // the selected value — the trigger text is the id (no labelField set
    // → fallback label = id, see ReferenceInput.options).
    await waitFor(() => expect(screen.queryByTestId("field-name")).toBeNull());
    expect(screen.getByTestId("combobox-kumiko-edit-assignee").textContent).toContain("widget-1");
  });

  // multi-mode's handleCreated appends to a value it reads from the
  // `field.value` closure — pins that the SECOND create doesn't drop the
  // first id (stale closure would overwrite instead of append).
  test("multi-mode: zwei Creates hintereinander behalten beide ids", async () => {
    const user = userEvent.setup();
    const dispatcher = makeDispatcher();

    render(
      <AppFeaturesProvider features={[tasksSchema, catalogSchema]}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={tasksSchema} qn="tasks:screen:task-edit" />
        </DispatcherProvider>
      </AppFeaturesProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));

    for (const expectedId of ["widget-1", "widget-2"]) {
      await user.click(screen.getByTestId("combobox-kumiko-edit-tags"));
      const createButton = await screen.findByTestId("combobox-kumiko-edit-tags-create");
      await user.click(createButton);
      const nameInput = (await screen.findByTestId("field-name")).querySelector("input");
      if (!nameInput) throw new Error("expected name input in create dialog");
      await user.type(nameInput, `Widget ${expectedId}`);
      const submitButtons = screen.getAllByTestId("render-edit-submit");
      await user.click(submitButtons[submitButtons.length - 1] as HTMLElement);
      await waitFor(() => expect(screen.queryByTestId("field-name")).toBeNull());
      await waitFor(() =>
        expect(screen.getByTestId("combobox-kumiko-edit-tags").textContent).toContain(expectedId),
      );
    }

    expect(screen.getByTestId("combobox-kumiko-edit-tags").textContent).toContain("widget-1");
    expect(screen.getByTestId("combobox-kumiko-edit-tags").textContent).toContain("widget-2");
  });

  test("Cancel im Create-Dialog schließt ohne write, Reference-Feld bleibt leer", async () => {
    const user = userEvent.setup();
    const dispatcher = makeDispatcher();

    render(
      <AppFeaturesProvider features={[tasksSchema, catalogSchema]}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={tasksSchema} qn="tasks:screen:task-edit" />
        </DispatcherProvider>
      </AppFeaturesProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    await user.click(screen.getByTestId("combobox-kumiko-edit-assignee"));
    const createButton = await screen.findByTestId("combobox-kumiko-edit-assignee-create");
    await user.click(createButton);
    await screen.findByTestId("field-name");

    const cancelButtons = screen.getAllByTestId("render-edit-cancel");
    await user.click(cancelButtons[cancelButtons.length - 1] as HTMLElement);

    await waitFor(() => expect(screen.queryByTestId("field-name")).toBeNull());
    expect(dispatcher.writes).toHaveLength(0);
    expect(screen.getByTestId("combobox-kumiko-edit-assignee").textContent).not.toContain("widget");
  });

  // The three negative gates that decide whether the "+ Create" footer
  // renders at all (render-field.tsx ReferenceInput.canCreate). A regression
  // here silently shows a create button the server would reject.
  describe("create-footer gates: no combobox-*-create in the DOM", () => {
    test("allowCreate: false on the target screen", async () => {
      const noCreateSchema: FeatureSchema = {
        ...catalogSchema,
        screens: [{ ...widgetCreateScreen, allowCreate: false }],
      };
      render(
        <AppFeaturesProvider features={[tasksSchema, noCreateSchema]}>
          <DispatcherProvider dispatcher={makeDispatcher()}>
            <KumikoScreen schema={tasksSchema} qn="tasks:screen:task-edit" />
          </DispatcherProvider>
        </AppFeaturesProvider>,
      );
      await waitFor(() => screen.getByTestId("render-edit-form"));
      await userEvent.setup().click(screen.getByTestId("combobox-kumiko-edit-assignee"));
      expect(screen.queryByTestId("combobox-kumiko-edit-assignee-create")).toBeNull();
    });

    test("target screen gated by a role the user doesn't have (no UserRolesProvider mounted)", async () => {
      const roleGatedSchema: FeatureSchema = {
        ...catalogSchema,
        screens: [{ ...widgetCreateScreen, access: { roles: ["Admin"] } }],
      };
      render(
        <AppFeaturesProvider features={[tasksSchema, roleGatedSchema]}>
          <DispatcherProvider dispatcher={makeDispatcher()}>
            <KumikoScreen schema={tasksSchema} qn="tasks:screen:task-edit" />
          </DispatcherProvider>
        </AppFeaturesProvider>,
      );
      await waitFor(() => screen.getByTestId("render-edit-form"));
      await userEvent.setup().click(screen.getByTestId("combobox-kumiko-edit-assignee"));
      expect(screen.queryByTestId("combobox-kumiko-edit-assignee-create")).toBeNull();
    });

    test("field.readOnly on the reference field itself", async () => {
      const readOnlySchema: FeatureSchema = {
        ...tasksSchema,
        screens: [
          {
            ...taskEditScreen,
            layout: {
              sections: [
                { title: "Basics", fields: ["title", { field: "assignee", readOnly: true }, "tags"] },
              ],
            },
          },
        ],
      };
      render(
        <AppFeaturesProvider features={[readOnlySchema, catalogSchema]}>
          <DispatcherProvider dispatcher={makeDispatcher()}>
            <KumikoScreen schema={readOnlySchema} qn="tasks:screen:task-edit" />
          </DispatcherProvider>
        </AppFeaturesProvider>,
      );
      await waitFor(() => screen.getByTestId("render-edit-form"));
      expect(screen.queryByTestId("combobox-kumiko-edit-assignee-create")).toBeNull();
    });
  });
});
