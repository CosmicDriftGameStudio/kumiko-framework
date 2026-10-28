import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { REFERENCE_COMBOBOX_LIMIT } from "../../hooks/reference-limits.ts";
import { DispatcherProvider, RenderEdit } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const WIDGET_COUNT = REFERENCE_COMBOBOX_LIMIT + 10;
const widgetRows = Array.from({ length: WIDGET_COUNT }, (_, index) => ({
  id: `widget-${index + 1}`,
  name: `Widget ${index + 1}`,
}));

// Mirrors the entity list handler: an `id in` filter narrows, `limit` caps the page.
function answerWidgetList(payload: unknown): Record<string, unknown> {
  const { limit, filters } = payload as {
    readonly limit: number;
    readonly filters?: readonly { field: string; op: string; value: readonly string[] }[];
  };
  const idFilter = filters?.find((filter) => filter.field === "id" && filter.op === "in");
  const matching =
    idFilter === undefined
      ? widgetRows
      : widgetRows.filter((row) => idFilter.value.includes(row.id));
  return { rows: matching.slice(0, limit), nextCursor: matching.length > limit ? "next" : null };
}

const taskEntity = {
  fields: {
    assignee: { type: "reference", entity: "catalog:widget", labelField: "name" },
  },
} as unknown as EntityDefinition;

const taskEditScreen: EntityEditScreenDefinition = {
  id: "tasks:screen:task-edit",
  type: "entityEdit",
  entity: "task",
  layout: { sections: [{ title: "Basics", fields: ["assignee"] }] },
};

describe("reference combobox", () => {
  test("a stored value beyond the first options page shows its label", async () => {
    const dispatcher = createMockDispatcher({
      query: (async (type: string, payload: unknown) =>
        type === "catalog:query:widget:list"
          ? { isSuccess: true, data: answerWidgetList(payload) }
          : { isSuccess: true, data: { rows: [] } }) as never,
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit
          screen={taskEditScreen}
          entity={taskEntity}
          featureName="tasks"
          initial={{ assignee: `widget-${WIDGET_COUNT}` } as never}
          writeCommand="task:update"
        />
      </DispatcherProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("combobox-kumiko-edit-assignee").textContent).toContain(
        `Widget ${WIDGET_COUNT}`,
      );
    });
  });
});
