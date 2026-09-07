import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  LIST_ROW_META_COLUMNS,
  LIST_ROW_META_REFERENCES,
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
    role: { type: "select", options: ["admin", "member"] },
    labels: { type: "multiSelect", options: ["urgent", "low-priority"] },
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

  test("select field column includes translated optionLabels", () => {
    const vm = computeListViewModel({
      screen: listScreen(["role"]),
      entity: taskEntity,
      rows: [],
      translate: (key) => (key === "tasks:entity:task:field:role:option:admin" ? "Admin" : key),
      featureName: "tasks",
    });

    expect(vm.columns[0]?.optionLabels).toEqual({
      admin: "Admin",
      member: "member",
    });
  });

  test("multiSelect field column includes translated optionLabels (fw#2491)", () => {
    const vm = computeListViewModel({
      screen: listScreen(["labels"]),
      entity: taskEntity,
      rows: [],
      translate: (key) => (key === "tasks:entity:task:field:labels:option:urgent" ? "Urgent" : key),
      featureName: "tasks",
    });

    expect(vm.columns[0]?.optionLabels).toEqual({
      urgent: "Urgent",
      "low-priority": "low-priority",
    });
  });

  // Table-driven over LIST_ROW_META_COLUMNS itself (not one-off cases) — a
  // row-meta column (id/tenantId/version/insertedAt/...) is a base-table
  // column, never a declared entity field (a SystemAdmin cross-tenant list
  // picks tenantId as a column this way). Together with boot-validator.test.ts
  // (both boot validators accept the same set) and list-row-meta-drift.test.ts
  // (LIST_ROW_META_COLUMNS key-set drift guard), this pins "whatever boot
  // accepts as a row-meta column, the renderer can actually draw" — a #2601
  // review found the two sides had drifted apart.
  test("every row-meta column resolves to its declared type, sortable, no throw", () => {
    for (const [field, expectedType] of Object.entries(LIST_ROW_META_COLUMNS)) {
      const vm = computeListViewModel({
        screen: listScreen(["title", field]),
        entity: taskEntity,
        rows: [],
        translate,
        featureName: "tasks",
      });

      const ref = LIST_ROW_META_REFERENCES[field];
      expect(vm.columns[1]).toEqual({
        field,
        label: `tasks:entity:task:field:${field}`,
        ...(ref !== undefined
          ? {
              type: "reference",
              sortable: false,
              refFeature: ref.refFeature,
              refEntity: ref.refEntity,
              refLabelField: ref.refLabelField,
            }
          : { type: expectedType, sortable: true }),
      });
    }
  });

  // tenantId carries a GUID in the DB but should render the referenced
  // tenant's display name, like a declared reference field does — not the
  // raw GUID. insertedById stays unchanged: this also pins that the map
  // switches exactly one column, not every row-meta ID column.
  test("tenantId row-meta column resolves as a reference column, insertedById unchanged", () => {
    const vm = computeListViewModel({
      screen: listScreen(["tenantId", "insertedById", "id"]),
      entity: taskEntity,
      rows: [],
      translate,
      featureName: "tasks",
    });

    expect(vm.columns[0]).toEqual({
      field: "tenantId",
      label: "tasks:entity:task:field:tenantId",
      type: "reference",
      sortable: false,
      refFeature: "tenant",
      refEntity: "tenant",
      refLabelField: "name",
    });
    expect(vm.columns[1]).toEqual({
      field: "insertedById",
      label: "tasks:entity:task:field:insertedById",
      type: "text",
      sortable: true,
    });
    expect(vm.columns[2]).toEqual({
      field: "id",
      label: "tasks:entity:task:field:id",
      type: "text",
      sortable: true,
    });
  });

  test("row-meta column: explicit label + renderer are passed through unchanged", () => {
    const fmt = { format: "currency" as const, symbol: "€" };
    const vm = computeListViewModel({
      screen: listScreen([{ field: "insertedAt", label: "custom.created", renderer: fmt }]),
      entity: taskEntity,
      rows: [],
      translate,
      featureName: "tasks",
    });

    expect(vm.columns[0]).toEqual({
      field: "insertedAt",
      label: "custom.created",
      type: "timestamp",
      sortable: true,
      renderer: fmt,
    });
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
