// #1681: Reference-Feld kann aus der Combobox heraus einen fehlenden
// Zieldatensatz anlegen. Deckt die volle Kette ab, in einem Test — jedes
// Glied (Screen-Resolution über Features hinweg, Dialog-Host, Create-
// Dispatch, Rückgabe der neuen id, Refetch der Lookup-Liste) lässt den
// Test failen wenn es bricht.

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
  // Lookup-Query kennt neu angelegte widgets erst NACH dem create-write —
  // pinnt den Refetch: ohne ihn bliebe die Options-Liste (und damit das
  // Label des neu gewählten Werts) leer.
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

    // Create-Dialog für "widget" ist gemountet — sein eigenes Form-Feld
    // ("name") ist sichtbar. Zwei "render-edit-submit"-Buttons existieren
    // jetzt (Host-Form dahinter + Dialog-Form) — der Dialog-Portal
    // mountet zuletzt, also ist seiner der letzte im DOM.
    const nameInput = (await screen.findByTestId("field-name")).querySelector("input");
    if (!nameInput) throw new Error("expected name input in create dialog");
    await user.type(nameInput, "Widget A");
    const submitButtons = screen.getAllByTestId("render-edit-submit");
    await user.click(submitButtons[submitButtons.length - 1] as HTMLElement);

    // Dispatch ging an den qualifizierten Create-Handler des ZIELfeatures
    // ("catalog"), nicht des Host-Features ("tasks").
    await waitFor(() => expect(dispatcher.writes.length).toBe(1));
    expect(dispatcher.writes[0]).toBe("catalog:write:widget:create");

    // Dialog schließt, das Reference-Feld zeigt die neu angelegte id als
    // gewählten Wert — der Trigger-Text ist die id (kein labelField
    // gesetzt → Fallback-Label = id, siehe ReferenceInput.options).
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
});
