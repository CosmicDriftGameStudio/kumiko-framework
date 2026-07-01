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
  derivedFields: {
    // Read-time computed (value appended by the list-query handler). The
    // view-model only reads valueType; the derive body never runs here, so a
    // no-op stand-in is enough.
    statusLabel: { valueType: "text", derive: () => "" },
    ageDays: { valueType: "number", derive: () => 0 },
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

  test("labeled column with no matching field → virtual presentational column (no throw)", () => {
    const vm = computeListViewModel({
      screen: listScreen([
        "title",
        { field: "tags", label: "Tags", renderer: { react: { __component: "TagsCell" } } },
      ]),
      entity: taskEntity,
      rows: [],
      translate,
      featureName: "tasks",
    });
    // `field` becomes the column key; label is taken verbatim (translate is
    // identity here), type defaults to text, never server-sortable.
    expect(vm.columns[1]).toEqual({
      field: "tags",
      label: "Tags",
      type: "text",
      sortable: false,
      renderer: { react: { __component: "TagsCell" } },
    });
  });

  test("labeled column with no matching field AND no renderer → throws (label alone isn't enough)", () => {
    // Regression (697/1): renderer is what actually draws a virtual column —
    // a label with no renderer would otherwise push an empty, unrendered
    // column into the view model instead of catching the author typo.
    expect(() =>
      computeListViewModel({
        screen: listScreen(["title", { field: "tags", label: "Tags" }]),
        entity: taskEntity,
        rows: [],
        translate,
        featureName: "tasks",
      }),
    ).toThrow(/unknown field "tags"/);
  });

  test("label overrides the field-convention header on a real field", () => {
    const vm = computeListViewModel({
      screen: listScreen([{ field: "title", label: "custom.header" }]),
      entity: taskEntity,
      rows: [],
      translate,
      featureName: "tasks",
    });
    // label goes through translate (identity here) instead of the
    // tasks:entity:task:field:title convention key.
    expect(vm.columns[0]?.label).toBe("custom.header");
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

  test("derived-field column carries its valueType, is display-only (never sortable), no stored-field metadata", () => {
    const vm = computeListViewModel({
      screen: listScreen(["statusLabel", "ageDays"]),
      entity: taskEntity,
      rows: [],
      translate,
      featureName: "tasks",
    });

    expect(vm.columns).toEqual([
      {
        field: "statusLabel",
        label: "tasks:entity:task:field:statusLabel",
        type: "text",
        sortable: false,
      },
      {
        field: "ageDays",
        label: "tasks:entity:task:field:ageDays",
        type: "number",
        sortable: false,
      },
    ]);
  });

  test("derived column value passes through from the row (handler already appended it)", () => {
    const vm = computeListViewModel({
      screen: listScreen(["title", "statusLabel"]),
      entity: taskEntity,
      rows: [{ id: "t-1", title: "first", statusLabel: "overdue" }],
      translate,
      featureName: "tasks",
    });

    expect(vm.rows[0]?.values).toEqual({ id: "t-1", title: "first", statusLabel: "overdue" });
  });

  test("derived columns accept an object-form renderer like stored columns", () => {
    const fmt = { format: "currency" as const, symbol: "€" };
    const vm = computeListViewModel({
      screen: listScreen([{ field: "ageDays", renderer: fmt }]),
      entity: taskEntity,
      rows: [],
      translate,
      featureName: "tasks",
    });

    expect(vm.columns[0]?.renderer).toEqual(fmt);
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
