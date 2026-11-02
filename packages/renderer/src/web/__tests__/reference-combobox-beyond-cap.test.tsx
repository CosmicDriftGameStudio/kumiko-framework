import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { ReadOnlyReferenceValue } from "../../components/render-field-reference.tsx";
import type { EditFieldViewModel } from "../../headless/index.ts";
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

// An author options handler: `ids` asks for stored rows, `limit` caps the picker page.
function answerWidgetOptions(payload: unknown): Record<string, unknown> {
  const { limit, ids } = payload as { readonly limit: number; readonly ids?: readonly string[] };
  const matching =
    ids === undefined ? widgetRows : widgetRows.filter((row) => ids.includes(row.id));
  return {
    rows: matching.slice(0, limit).map((row) => ({ id: row.id, label: row.name })),
    nextCursor: matching.length > limit ? "next" : null,
  };
}

function widgetDispatcher(optionsPayloads: unknown[] = []) {
  return createMockDispatcher({
    query: (async (type: string, payload: unknown) => {
      if (type === "catalog:query:widget:list") {
        return { isSuccess: true, data: answerWidgetList(payload) };
      }
      if (type === WIDGET_OPTIONS_QUERY) {
        optionsPayloads.push(payload);
        return { isSuccess: true, data: answerWidgetOptions(payload) };
      }
      return { isSuccess: true, data: { rows: [] } };
    }) as never,
  });
}

const WIDGET_OPTIONS_QUERY = "catalog:query:widget-options";

const taskEntity = {
  fields: {
    assignee: { type: "reference", entity: "catalog:widget", labelField: "name" },
  },
} as unknown as EntityDefinition;

const optionsQueryTaskEntity = {
  fields: {
    assignee: {
      type: "reference",
      entity: "catalog:widget",
      labelField: "name",
      optionsQuery: WIDGET_OPTIONS_QUERY,
    },
  },
} as unknown as EntityDefinition;

const taskEditScreen: EntityEditScreenDefinition = {
  id: "tasks:screen:task-edit",
  type: "entityEdit",
  entity: "task",
  layout: { sections: [{ title: "Basics", fields: ["assignee"] }] },
};

// Hand-written option handlers know `{ limit, search? }` and `ids`; a strict schema would reject
// the list `filters` the entity list handler takes.
function expectNoListFilters(payloads: readonly unknown[]): void {
  expect(payloads.length).toBeGreaterThan(0);
  for (const payload of payloads) expect(payload).not.toHaveProperty("filters");
}

function renderTaskEdit(entity: EntityDefinition, optionsPayloads: unknown[] = []): void {
  render(
    <DispatcherProvider dispatcher={widgetDispatcher(optionsPayloads)}>
      <RenderEdit
        screen={taskEditScreen}
        entity={entity}
        featureName="tasks"
        initial={{ assignee: `widget-${WIDGET_COUNT}` } as never}
        writeCommand="task:update"
      />
    </DispatcherProvider>,
  );
}

describe("reference combobox", () => {
  test("a stored value beyond the first options page shows its label", async () => {
    renderTaskEdit(taskEntity);

    await waitFor(() => {
      expect(screen.getByTestId("combobox-kumiko-edit-assignee").textContent).toContain(
        `Widget ${WIDGET_COUNT}`,
      );
    });
  });

  test("an author options query is asked for the stored row by id", async () => {
    renderTaskEdit(optionsQueryTaskEntity);

    await waitFor(() => {
      expect(screen.getByTestId("combobox-kumiko-edit-assignee").textContent).toContain(
        `Widget ${WIDGET_COUNT}`,
      );
    });
  });
});

describe("reference combobox with an author options query: payload contract", () => {
  test("the picker page is asked with limit only; stored rows come by ids, never with list filters", async () => {
    const payloads: unknown[] = [];
    renderTaskEdit(optionsQueryTaskEntity, payloads);
    await waitFor(() => {
      expect(screen.getByTestId("combobox-kumiko-edit-assignee").textContent).toContain(
        `Widget ${WIDGET_COUNT}`,
      );
    });
    expectNoListFilters(payloads);
    expect(payloads).toContainEqual({ limit: REFERENCE_COMBOBOX_LIMIT });
  });
});

describe("read-only reference value", () => {
  test("an author options query never receives list filters", async () => {
    const payloads: unknown[] = [];
    const field: EditFieldViewModel = {
      field: "assignee",
      label: "Assignee",
      type: "reference",
      value: `widget-${WIDGET_COUNT}`,
      visible: true,
      readOnly: true,
      required: false,
      refEntity: "widget",
      refFeature: "catalog",
      refLabelField: "name",
      refOptionsQuery: WIDGET_OPTIONS_QUERY,
    };
    render(
      <DispatcherProvider dispatcher={widgetDispatcher(payloads)}>
        <ReadOnlyReferenceValue field={field} featureName="tasks" />
      </DispatcherProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("field-value-assignee").textContent).toBe(`Widget ${WIDGET_COUNT}`);
    });
    expectNoListFilters(payloads);
    expect(payloads).toContainEqual({ limit: REFERENCE_COMBOBOX_LIMIT });
  });

  test("an author options query resolves a stored value beyond its first page", async () => {
    const field: EditFieldViewModel = {
      field: "assignee",
      label: "Assignee",
      type: "reference",
      value: `widget-${WIDGET_COUNT}`,
      visible: true,
      readOnly: true,
      required: false,
      refEntity: "widget",
      refFeature: "catalog",
      refLabelField: "name",
      refOptionsQuery: WIDGET_OPTIONS_QUERY,
    };
    render(
      <DispatcherProvider dispatcher={widgetDispatcher()}>
        <ReadOnlyReferenceValue field={field} featureName="tasks" />
      </DispatcherProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("field-value-assignee").textContent).toBe(`Widget ${WIDGET_COUNT}`);
    });
  });
});
