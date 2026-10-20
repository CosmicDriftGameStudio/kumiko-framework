import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { buildFormSchema } from "../../app/form-schema.ts";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, RenderEdit } from "../../index.ts";
import { act, createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils.tsx";

const entity = {
  fields: { title: { type: "text", required: true }, notes: { type: "text", required: true } },
} as unknown as EntityDefinition;

const editScreen: EntityEditScreenDefinition = {
  id: "tasks:screen:task-edit",
  type: "entityEdit",
  entity: "task",
  layout: { sections: [{ title: "Basics", columns: 1, fields: ["title", "notes"] }] },
};

type Values = { title: string; notes: string };

function renderForm(dispatcher: Dispatcher, initial: Values): void {
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <RenderEdit<Values>
        screen={editScreen}
        entity={entity}
        featureName="tasks"
        initial={initial}
        schema={buildFormSchema(entity, editScreen, "create")}
        writeCommand="task:create"
      />
    </DispatcherProvider>,
  );
}

function inputOf(field: string): HTMLInputElement {
  return screen.getByTestId(`field-${field}`).querySelector("input") as HTMLInputElement;
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.submit(screen.getByTestId("render-edit-form"));
    await Promise.resolve();
  });
}

describe("focus the first invalid field after a failed submit", () => {
  test("client-side validation moves focus to the first invalid field and scrolls it into view", async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      renderForm(createMockDispatcher(), { title: "", notes: "" });
      await submit();
      await waitFor(() => expect(document.activeElement).toBe(inputOf("title")));
      expect(scrolled).toContain(inputOf("title"));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  test("server-side field errors focus the first invalid field again on the next failed submit", async () => {
    const dispatcher = createMockDispatcher({
      write: (async () => ({
        isSuccess: false,
        error: {
          code: "validation_failed",
          httpStatus: 422,
          i18nKey: "errors.validation.failed",
          message: "invalid",
          details: {
            fields: [{ path: "notes", code: "custom", i18nKey: "errors.validation.custom" }],
          },
        },
      })) as unknown as Dispatcher["write"],
    });
    renderForm(dispatcher, { title: "Ok", notes: "x" });
    await submit();
    await waitFor(() => expect(document.activeElement).toBe(inputOf("notes")));

    inputOf("title").focus();
    await submit();
    await waitFor(() => expect(document.activeElement).toBe(inputOf("notes")));
  });
});
