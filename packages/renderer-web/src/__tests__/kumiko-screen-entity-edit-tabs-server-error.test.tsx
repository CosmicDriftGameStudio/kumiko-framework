import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import { act, createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils";

const taskEntity = {
  fields: {
    title: { type: "text", required: true },
    count: { type: "number" },
  },
} as unknown as EntityDefinition;

const tabsEditScreen: EntityEditScreenDefinition = {
  id: "task-edit",
  type: "entityEdit",
  entity: "task",
  layout: {
    mode: "tabs",
    sections: [
      { id: "basics", title: "Basics", columns: 1, fields: [{ field: "title" }] },
      { id: "details", title: "Details", columns: 1, fields: [{ field: "count" }] },
    ],
  },
};

const schema: FeatureSchema = {
  featureName: "tasks",
  entities: { task: taskEntity },
  screens: [tabsEditScreen],
};

function makeDispatcher(overrides: Partial<Dispatcher> = {}): Dispatcher {
  const base = createMockDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { id: "task-1", version: 1, title: "loaded", count: 0 },
    })) as unknown as Dispatcher["query"],
  });
  return { ...base, ...overrides };
}

describe("KumikoScreen: entityEdit tabs mode — server validation error on an unopened tab", () => {
  test("server error on a field of the details tab activates that tab and shows the inline error, no generic banner", async () => {
    const dispatcher = makeDispatcher({
      write: (async () => ({
        isSuccess: false,
        error: {
          code: "validation_error",
          httpStatus: 400,
          i18nKey: "errors.validation",
          message: "Validation failed",
          details: {
            fields: [
              { path: "changes.count", code: "too_small", i18nKey: "errors.validation.too_small" },
            ],
          },
        },
      })) as unknown as Dispatcher["write"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-edit" entityId="task-1" />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(screen.getByTestId("render-edit-form")).toBeTruthy();
    expect(screen.getByTestId("field-count").closest("[hidden]")).not.toBeNull();

    await act(async () => {
      fireEvent.submit(screen.getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    expect(screen.getByTestId("field-count").closest("[hidden]")).toBeNull();
    expect(screen.getByTestId("field-count-errors")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-form-error")).toBeNull();
  });
});
