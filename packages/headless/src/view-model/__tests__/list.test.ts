import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { computeListViewModel } from "../list";

// Minimal EntityDefinition-shape. ui-core's view-model only reads
// entity.fields and per-field metadata; tests stay untyped-casted via
// `as unknown as EntityDefinition` so we don't pull the entire framework
// FieldDefinition union into fixtures.
const taskEntity = {
  fields: {
    title: { type: "text", required: true, sortable: true },
    done: { type: "boolean" },
    priority: { type: "number", sortable: true },
  },
} as unknown as EntityDefinition;

function listScreen(columns: EntityListScreenDefinition["columns"]): EntityListScreenDefinition {
  return {
    id: "tasks:screen:task-list",
    type: "entityList",
    entity: "task",
    columns,
  };
}

// Fake translate passes the key through so tests can assert on the
// key-composition convention without wiring i18next.
const translate = (key: string) => key;

describe("computeListViewModel", () => {
  test("string columns expand to field-name + resolved label + type", () => {
    const vm = computeListViewModel({
      screen: listScreen(["title", "done"]),
      entity: taskEntity,
      rows: [],
      translate,
      featureName: "tasks",
    });

    expect(vm.columns).toEqual([
      {
        field: "title",
        label: "tasks:entity:task:field:title",
        type: "text",
        sortable: true,
      },
      {
        field: "done",
        label: "tasks:entity:task:field:done",
        type: "boolean",
        sortable: false,
      },
    ]);
  });

  test("object-form column carries renderer through to the view model", () => {
    const fmt = { format: "currency" as const, symbol: "€" };
    const vm = computeListViewModel({
      screen: listScreen([{ field: "title", renderer: fmt }]),
      entity: taskEntity,
      rows: [],
      translate,
      featureName: "tasks",
    });

    expect(vm.columns[0]?.renderer).toEqual(fmt);
  });

  test("rows map to { id, values } with id pulled from the row", () => {
    const vm = computeListViewModel({
      screen: listScreen(["title"]),
      entity: taskEntity,
      rows: [
        { id: "t-1", title: "first" },
        { id: "t-2", title: "second" },
      ],
      translate,
      featureName: "tasks",
    });

    expect(vm.rows).toEqual([
      { id: "t-1", values: { id: "t-1", title: "first" } },
      { id: "t-2", values: { id: "t-2", title: "second" } },
    ]);
    expect(vm.isEmpty).toBe(false);
  });

  test("empty rows list flags isEmpty for the renderer's 'no results' state", () => {
    const vm = computeListViewModel({
      screen: listScreen(["title"]),
      entity: taskEntity,
      rows: [],
      translate,
      featureName: "tasks",
    });
    expect(vm.isEmpty).toBe(true);
  });

  test("unknown field reference throws — stale rename caught at render-time, not silently", () => {
    expect(() =>
      computeListViewModel({
        screen: listScreen(["doesNotExist"]),
        entity: taskEntity,
        rows: [],
        translate,
        featureName: "tasks",
      }),
    ).toThrow(/unknown field "doesNotExist"/);
  });

  test("translate is called with the expected i18n-key per field", () => {
    const spy = mock((key: string) => `T:${key}`);
    computeListViewModel({
      screen: listScreen(["title", "priority"]),
      entity: taskEntity,
      rows: [],
      translate: spy,
      featureName: "tasks",
    });

    expect(spy).toHaveBeenCalledWith("tasks:entity:task:field:title");
    expect(spy).toHaveBeenCalledWith("tasks:entity:task:field:priority");
  });

  test("slots pass through unchanged for the renderer to mount", () => {
    const slots = { header: { react: { component: "HeaderRef" } } };
    const vm = computeListViewModel({
      screen: { ...listScreen(["title"]), slots },
      entity: taskEntity,
      rows: [],
      translate,
      featureName: "tasks",
    });
    expect(vm.slots).toBe(slots);
  });
});
