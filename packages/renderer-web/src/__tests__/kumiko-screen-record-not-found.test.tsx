import { describe, expect, test } from "bun:test";
import type {
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen, NavProvider } from "@cosmicdrift/kumiko-renderer";
import { fireEvent, makeDispatcher, render, screen, taskEntity, waitFor } from "./test-utils.js";

const taskList: EntityListScreenDefinition = {
  id: "task-list",
  type: "entityList",
  entity: "task",
  columns: ["title"],
};
const taskEdit: EntityEditScreenDefinition = {
  id: "task-edit",
  type: "entityEdit",
  entity: "task",
  layout: { sections: [{ title: "Basics", fields: ["title"] }] },
};
const schema: FeatureSchema = {
  featureName: "tasks",
  entities: { task: taskEntity },
  screens: [taskList, taskEdit],
};

const translateDe = (key: string): string => localeDeBundle[key] ?? key;

const unknownRecordDispatcher = makeDispatcher({
  query: (async () => ({ isSuccess: true, data: null })) as unknown as Dispatcher["query"],
});

describe("KumikoScreen: entityEdit with an unknown record id", () => {
  test("shows the localized empty state (de) and a way back to the list", async () => {
    const navigated: unknown[] = [];
    const nav = {
      route: { screenId: "task-edit" },
      navigate: (target: unknown) => navigated.push(target),
      replace: () => undefined,
      hrefFor: () => "",
      searchParams: {},
      setSearchParams: () => undefined,
    };
    render(
      <NavProvider value={nav}>
        <DispatcherProvider dispatcher={unknownRecordDispatcher}>
          <KumikoScreen
            schema={schema}
            qn="tasks:screen:task-edit"
            entityId="gone-id"
            translate={translateDe}
          />
        </DispatcherProvider>
      </NavProvider>,
    );

    const state = await waitFor(() => screen.getByTestId("kumiko-screen-record-missing"));
    expect(state.textContent).toContain("Datensatz nicht gefunden.");
    expect(state.textContent).not.toContain("not found");
    expect(state.textContent).not.toContain("gone-id");

    fireEvent.click(screen.getByTestId("kumiko-screen-record-missing-back"));
    expect(navigated).toEqual([{ screenId: "task-list" }]);
  });

  test("falls back to the English default text without a translate override", async () => {
    render(
      <DispatcherProvider dispatcher={unknownRecordDispatcher}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-edit" entityId="gone-id" />
      </DispatcherProvider>,
    );
    const state = await waitFor(() => screen.getByTestId("kumiko-screen-record-missing"));
    expect(state.textContent).toContain("This record was not found.");
  });

  test("offers no back button when the entity has no list screen", async () => {
    render(
      <DispatcherProvider dispatcher={unknownRecordDispatcher}>
        <KumikoScreen
          schema={{ ...schema, screens: [taskEdit] }}
          qn="tasks:screen:task-edit"
          entityId="gone-id"
          translate={translateDe}
        />
      </DispatcherProvider>,
    );
    await waitFor(() => screen.getByTestId("kumiko-screen-record-missing"));
    expect(screen.queryByTestId("kumiko-screen-record-missing-back")).toBeNull();
  });
});
